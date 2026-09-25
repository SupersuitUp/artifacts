// Where readers' answers live. Beside the pages, per tenant:
//
//   <base>State/<page>__<slot>__<readerKey>   shape one, one document per reader per slot
//   <base>State/<auto>                        shape many, one document per entry
//   <base>StateRate/<page>__<ipHash>__<min>   anonymous write counter, one per minute
//
// One document per answer keeps every page far from Firestore's 1 MiB document cap, which the
// lightpaper hit on 2026-09-24 when history lived on the page document. Values are stored as a
// JSON STRING (`json`), because Firestore refuses nested arrays and a form answer can hold one.
//
// The Firestore implementation has no emulator test here; it is proven on the live host after
// each release that changes it. The memory implementation carries the contract tests.
import { randomUUID } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { MAX_MANY_PER_READER, type Shape } from './state.js'

export type Writer = { key: string; uid?: string; email?: string; name: string | null; anonymous: boolean }
export type StateEntry = { id: string; artifactId: string; slot: string; shape: Shape; readerKey: string; writer: Omit<Writer, 'key'>; value: unknown; at: string }

export interface StateStore {
  entries(artifactId: string): Promise<StateEntry[]>
  set(input: { artifactId: string; slot: string; writer: Writer; value: unknown }): Promise<StateEntry>
  append(input: { artifactId: string; slot: string; writer: Writer; value: unknown }): Promise<StateEntry | { full: true }>
  remove(input: { artifactId: string; slot: string; readerKey: string; entryId?: string }): Promise<number>
  removeReader(artifactId: string, readerKey: string): Promise<number>
  moveReader(artifactId: string, fromKey: string, to: Writer): Promise<number>
  countAnonWrite(artifactId: string, ipHash: string, minute: number): Promise<number>
}

export const readerKeyFor = {
  signedIn: (uid: string) => `u:${uid}`,
  anonymous: (id: string) => `a:${id}`,
}

const writerOf = (w: Writer): Omit<Writer, 'key'> => ({
  ...(w.uid ? { uid: w.uid } : {}), ...(w.email ? { email: w.email } : {}), name: w.name, anonymous: w.anonymous,
})
const oneId = (artifactId: string, slot: string, readerKey: string) => `${artifactId}__${slot}__${readerKey}`

type Stored = Omit<StateEntry, 'id' | 'value'> & { json: string }
const toEntry = (id: string, d: Stored): StateEntry => {
  const { json, ...rest } = d
  return { id, ...rest, value: JSON.parse(json) }
}
const toStored = (e: StateEntry): Stored => {
  const { id: _id, value, ...rest } = e
  return { ...rest, json: JSON.stringify(value) }
}

export function createStateStore(db: Firestore, base: string): StateStore {
  const col = () => db.collection(`${base}State`)
  const rate = () => db.collection(`${base}StateRate`)
  const load = async (q: FirebaseFirestore.Query) => (await q.get()).docs.map((d) => toEntry(d.id, d.data() as Stored))
  const store: StateStore = {
    entries: (artifactId) => load(col().where('artifactId', '==', artifactId)),
    async set({ artifactId, slot, writer, value }) {
      const e: StateEntry = { id: oneId(artifactId, slot, writer.key), artifactId, slot, shape: 'one', readerKey: writer.key, writer: writerOf(writer), value, at: new Date().toISOString() }
      await col().doc(e.id).set(toStored(e))
      return e
    },
    async append({ artifactId, slot, writer, value }) {
      const n = (await col().where('artifactId', '==', artifactId).where('slot', '==', slot).where('readerKey', '==', writer.key).count().get()).data().count
      if (n >= MAX_MANY_PER_READER) return { full: true }
      const ref = col().doc()
      const e: StateEntry = { id: ref.id, artifactId, slot, shape: 'many', readerKey: writer.key, writer: writerOf(writer), value, at: new Date().toISOString() }
      await ref.set(toStored(e))
      return e
    },
    async remove({ artifactId, slot, readerKey, entryId }) {
      const mine = (await load(col().where('artifactId', '==', artifactId).where('readerKey', '==', readerKey)))
        .filter((e) => e.slot === slot && (!entryId || e.id === entryId))
      await Promise.all(mine.map((e) => col().doc(e.id).delete()))
      return mine.length
    },
    async removeReader(artifactId, readerKey) {
      const mine = await load(col().where('artifactId', '==', artifactId).where('readerKey', '==', readerKey))
      await Promise.all(mine.map((e) => col().doc(e.id).delete()))
      return mine.length
    },
    async moveReader(artifactId, fromKey, to) {
      const from = await load(col().where('artifactId', '==', artifactId).where('readerKey', '==', fromKey))
      let moved = 0
      for (const e of from) {
        if (e.shape === 'one') {
          const target = col().doc(oneId(artifactId, e.slot, to.key))
          // The signed-in answer wins over one given anonymously on this device.
          if (!(await target.get()).exists) {
            await target.set(toStored({ ...e, id: target.id, readerKey: to.key, writer: writerOf(to) }))
            moved++
          }
          await col().doc(e.id).delete()
        } else {
          await col().doc(e.id).update({ readerKey: to.key, writer: writerOf(to) })
          moved++
        }
      }
      return moved
    },
    async countAnonWrite(artifactId, ipHash, minute) {
      const ref = rate().doc(`${artifactId}__${ipHash}__${minute}`)
      await ref.set({ count: FieldValue.increment(1), at: new Date().toISOString() }, { merge: true })
      return ((await ref.get()).data()?.count as number) ?? 1
    },
  }
  return store
}

/** The same contract in memory: for tests, and for hosts' own tests. */
export function createMemoryStateStore(): StateStore {
  const docs = new Map<string, StateEntry>()
  const counts = new Map<string, number>()
  const of = (artifactId: string, readerKey?: string) =>
    [...docs.values()].filter((e) => e.artifactId === artifactId && (!readerKey || e.readerKey === readerKey))
  return {
    entries: async (artifactId) => of(artifactId).map((e) => structuredClone(e)),
    async set({ artifactId, slot, writer, value }) {
      const e: StateEntry = { id: oneId(artifactId, slot, writer.key), artifactId, slot, shape: 'one', readerKey: writer.key, writer: writerOf(writer), value: structuredClone(value), at: new Date().toISOString() }
      docs.set(e.id, e)
      return structuredClone(e)
    },
    async append({ artifactId, slot, writer, value }) {
      if (of(artifactId, writer.key).filter((e) => e.slot === slot).length >= MAX_MANY_PER_READER) return { full: true }
      const e: StateEntry = { id: randomUUID(), artifactId, slot, shape: 'many', readerKey: writer.key, writer: writerOf(writer), value: structuredClone(value), at: new Date().toISOString() }
      docs.set(e.id, e)
      return structuredClone(e)
    },
    async remove({ artifactId, slot, readerKey, entryId }) {
      const mine = of(artifactId, readerKey).filter((e) => e.slot === slot && (!entryId || e.id === entryId))
      for (const e of mine) docs.delete(e.id)
      return mine.length
    },
    async removeReader(artifactId, readerKey) {
      const mine = of(artifactId, readerKey)
      for (const e of mine) docs.delete(e.id)
      return mine.length
    },
    async moveReader(artifactId, fromKey, to) {
      let moved = 0
      for (const e of of(artifactId, fromKey)) {
        docs.delete(e.id)
        if (e.shape === 'one') {
          const id = oneId(artifactId, e.slot, to.key)
          if (docs.has(id)) continue
          docs.set(id, { ...e, id, readerKey: to.key, writer: writerOf(to) })
        } else {
          docs.set(e.id, { ...e, readerKey: to.key, writer: writerOf(to) })
        }
        moved++
      }
      return moved
    },
    async countAnonWrite(artifactId, ipHash, minute) {
      const k = `${artifactId}__${ipHash}__${minute}`
      const n = (counts.get(k) ?? 0) + 1
      counts.set(k, n)
      return n
    },
  }
}
