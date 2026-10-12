// Where resolution digests wait and are recorded (0.34.0). Beside the readers' state, per tenant:
//
//   <base>ResolveBursts/<page>__<emailKey>   one reader's open burst on one page; deleted when claimed
//   <base>ResolveDigests/<burstId>           a claimed burst, frozen: pending, then sent, skipped or failed
//   <base>ResolveStops/<page>__<emailKey>    the reader followed the stop link for that page
//
// Items are stored as a JSON string (`json`), as the state store does, so a quote or a body can
// never trip Firestore's rules on nested values. Every query is single-field (Firestore indexes
// those itself), so no composite index is needed.
//
// The Firestore implementation has no emulator test here; it is proven on the live host after each
// release that changes it. The memory implementation carries the contract tests.
import { randomUUID } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { burstKey, itemsOf, type Burst, type Digest, type DigestItem, type ResolveDigestStore } from './resolve-digest.js'

type StoredBurst = Omit<Burst, 'key' | 'threads'> & { json: string }
type StoredDigest = Omit<Digest, 'id' | 'items'> & { json: string }

const toBurst = (key: string, d: StoredBurst): Burst => { const { json, ...rest } = d; return { key, ...rest, threads: JSON.parse(json) } }
const toDigest = (id: string, d: StoredDigest): Digest => { const { json, ...rest } = d; return { id, ...rest, items: JSON.parse(json) } }
const isDue = (b: { lastAt: string; firstAt: string }, quietBefore: string, maxBefore: string) => b.lastAt <= quietBefore || b.firstAt <= maxBefore
const digestOf = (b: Burst, now: string): Digest => ({
  id: b.burstId, artifactId: b.artifactId, email: b.email, name: b.name, title: b.title, url: b.url,
  items: itemsOf(b.threads), status: 'pending', createdAt: now, leaseUntil: now, attempts: 0,
})
const stopId = (artifactId: string, key: string) => `${artifactId}__${key}`

export function createResolveDigestStore(db: Firestore, base: string): ResolveDigestStore {
  const bursts = () => db.collection(`${base}ResolveBursts`)
  const digests = () => db.collection(`${base}ResolveDigests`)
  const stops = () => db.collection(`${base}ResolveStops`)
  return {
    async add({ artifactId, email, name, title, url, threadId, items, at }) {
      const ref = bursts().doc(burstKey(artifactId, email))
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const cur = snap.exists ? toBurst(ref.id, snap.data() as StoredBurst) : null
        const threads: Record<string, DigestItem[]> = { ...(cur?.threads ?? {}), [threadId]: items }
        const next: StoredBurst = {
          burstId: cur?.burstId ?? randomUUID(), artifactId, email, name: name ?? cur?.name ?? null, title, url,
          firstAt: cur?.firstAt ?? at, lastAt: cur && cur.lastAt > at ? cur.lastAt : at, json: JSON.stringify(threads),
        }
        tx.set(ref, next)
      })
    },
    async dropThread(artifactId, threadId) {
      const docs = (await bursts().where('artifactId', '==', artifactId).get()).docs
      let changed = 0
      for (const d of docs) {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(d.ref)
          if (!snap.exists) return
          const b = toBurst(d.id, snap.data() as StoredBurst)
          if (!(threadId in b.threads)) return
          delete b.threads[threadId]
          changed++
          if (!Object.keys(b.threads).length) tx.delete(d.ref)
          else tx.update(d.ref, { json: JSON.stringify(b.threads) })
        })
      }
      return changed
    },
    async due(quietBefore, maxBefore, limit) {
      const [quiet, old] = await Promise.all([
        bursts().where('lastAt', '<=', quietBefore).limit(limit).get(),
        bursts().where('firstAt', '<=', maxBefore).limit(limit).get(),
      ])
      const out = new Map<string, Burst>()
      for (const d of [...quiet.docs, ...old.docs]) out.set(d.id, toBurst(d.id, d.data() as StoredBurst))
      return [...out.values()].slice(0, limit)
    },
    async claim({ key, burstId, quietBefore, maxBefore, now }) {
      const ref = bursts().doc(key)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return null
        const b = toBurst(key, snap.data() as StoredBurst)
        if (b.burstId !== burstId || !isDue(b, quietBefore, maxBefore)) return null
        const dref = digests().doc(b.burstId)
        if ((await tx.get(dref)).exists) { tx.delete(ref); return null }
        const d = digestOf(b, now)
        const { id: _id, items, ...rest } = d
        tx.create(dref, { ...rest, json: JSON.stringify(items) } satisfies StoredDigest)
        tx.delete(ref)
        return d
      })
    },
    async pending(now, limit) {
      // Equality only, so no composite index; the lease filter runs here. Pending is small.
      const docs = (await digests().where('status', '==', 'pending').limit(limit * 4).get()).docs
      return docs.map((d) => toDigest(d.id, d.data() as StoredDigest))
        .filter((d) => d.leaseUntil <= now)
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
        .slice(0, limit)
    },
    async lease(id, now, until) {
      const ref = digests().doc(id)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return null
        const d = toDigest(id, snap.data() as StoredDigest)
        if (d.status !== 'pending' || d.leaseUntil > now) return null
        tx.update(ref, { leaseUntil: until, attempts: d.attempts + 1 })
        return { ...d, leaseUntil: until, attempts: d.attempts + 1 }
      })
    },
    async finish(id, { status, at, reason, providerId }) {
      await digests().doc(id).update({
        status, ...(status === 'sent' ? { sentAt: at } : {}), ...(reason ? { reason } : {}), ...(providerId ? { providerId } : {}),
      })
    },
    async release(id, retryAt) {
      await digests().doc(id).update({ leaseUntil: retryAt })
    },
    async stop(artifactId, key, at) {
      await stops().doc(stopId(artifactId, key)).set({ artifactId, emailKey: key, at })
    },
    stopped: async (artifactId, key) => (await stops().doc(stopId(artifactId, key)).get()).exists,
  }
}

/** The same contract in memory: for tests, and for hosts' own tests. */
export function createMemoryResolveDigestStore(): ResolveDigestStore & { digests(): Digest[]; bursts(): Burst[] } {
  const bursts = new Map<string, Burst>()
  const digests = new Map<string, Digest>()
  const stopSet = new Set<string>()
  return {
    async add({ artifactId, email, name, title, url, threadId, items, at }) {
      const key = burstKey(artifactId, email)
      const cur = bursts.get(key)
      bursts.set(key, {
        key, burstId: cur?.burstId ?? randomUUID(), artifactId, email, name: name ?? cur?.name ?? null, title, url,
        firstAt: cur?.firstAt ?? at, lastAt: cur && cur.lastAt > at ? cur.lastAt : at,
        threads: { ...(cur?.threads ?? {}), [threadId]: structuredClone(items) },
      })
    },
    async dropThread(artifactId, threadId) {
      let changed = 0
      for (const b of [...bursts.values()].filter((b) => b.artifactId === artifactId && threadId in b.threads)) {
        delete b.threads[threadId]
        changed++
        if (!Object.keys(b.threads).length) bursts.delete(b.key)
      }
      return changed
    },
    due: async (quietBefore, maxBefore, limit) => [...bursts.values()].filter((b) => isDue(b, quietBefore, maxBefore)).slice(0, limit).map((b) => structuredClone(b)),
    async claim({ key, burstId, quietBefore, maxBefore, now }) {
      const b = bursts.get(key)
      if (!b || b.burstId !== burstId || !isDue(b, quietBefore, maxBefore)) return null
      bursts.delete(key)
      if (digests.has(b.burstId)) return null
      const d = digestOf(b, now)
      digests.set(d.id, d)
      return structuredClone(d)
    },
    pending: async (now, limit) => [...digests.values()].filter((d) => d.status === 'pending' && d.leaseUntil <= now)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt)).slice(0, limit).map((d) => structuredClone(d)),
    async lease(id, now, until) {
      const d = digests.get(id)
      if (!d || d.status !== 'pending' || d.leaseUntil > now) return null
      d.leaseUntil = until
      d.attempts++
      return structuredClone(d)
    },
    async finish(id, { status, at, reason, providerId }) {
      const d = digests.get(id)
      if (!d) return
      d.status = status
      if (status === 'sent') d.sentAt = at
      if (reason) d.reason = reason
      if (providerId) d.providerId = providerId
    },
    async release(id, retryAt) { const d = digests.get(id); if (d) d.leaseUntil = retryAt },
    async stop(artifactId, key) { stopSet.add(stopId(artifactId, key)) },
    stopped: async (artifactId, key) => stopSet.has(stopId(artifactId, key)),
    digests: () => [...digests.values()].map((d) => structuredClone(d)),
    bursts: () => [...bursts.values()].map((b) => structuredClone(b)),
  }
}

