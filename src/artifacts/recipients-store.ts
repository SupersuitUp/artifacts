// Who a per-reader page was sent to, and what each link did with it. Host-side only, like the
// access list: the file never names a reader. Collections under `base`:
//   <base>Recipients/<artifactId>                 { recipients: { <rid>: Recipient }, expireAt, keep }
//   <base>RecipientViews/<artifactId>__<rid>__<session>  ViewDoc
//   <base>RecipientTokens/<key>                   { expireAt } (a Firestore TTL policy may sweep it)
import type { Firestore } from 'firebase-admin/firestore'
import { newRid, ridOfReaderKey } from './recipients.js'

/** `sentAt`: when the sender says the link reached the reader (the publish key marks it). A view
 *  that began before then was not the reader's, whoever rendered it. */
export type Recipient = { rid: string; label: string; note?: string; owner?: true; group?: true; addedAt: string; revokedAt?: string; closesAt?: string | null; sentAt?: string; provenance?: Provenance }
/** Who minted a link, on whose authority, and when (a superlink, 0.53.0): `actor` is a person by
 *  hand or "<person>'s Pluma"; `authority` is the request, recurrent or approval it acted under, with
 *  `link` to the session or message where one exists; `funnel` and `stage` name the funnel step the
 *  link was sent to move someone from, so a funnel move citing its opens has provenance. */
export type Provenance = { actor: string; authority: string; at: string; link?: string; funnel?: string; stage?: string }
export type RecipientsRecord = { recipients: Record<string, Recipient>; expireAt: string | null; keep: boolean; revokedAll?: string }
export type ViewDoc = { artifactId: string; rid: string; session: string; device: string; firstAt: string; lastAt: string; activeSeconds: number; plays: Record<string, number> }
/** What rendered the link before it was sent: never counted as the reader, shown so a publisher
 *  can see it happened (usually themselves, checking the page). Null when no send was recorded. */
export type BeforeSend = { sessions: number; devices: number; activeSeconds: number; firstAt: string | null } | null
export type RecipientSummary = { rid: string; label: string; group: boolean; revoked: boolean; closesAt: string | null; sentAt: string | null; provenance: Provenance | null; beforeSend: BeforeSend; opened: boolean; firstOpenAt: string | null; cameBack: boolean; activeSeconds: number; plays: number; devices: number; comments: { id: string | null; parent: string | null; at: string; text: string }[] }
type NewRecipient = { label: string; note?: string; owner?: boolean; group?: boolean; closesAt?: string; provenance?: Provenance }
export interface RecipientsStore {
  get(artifactId: string): Promise<RecipientsRecord | null>
  add(artifactId: string, input: NewRecipient[]): Promise<Recipient[]>
  revoke(artifactId: string, rids: string[] | '*'): Promise<string[]>
  /** Set (an ISO time) or clear (null) the feedback window of the named readers, or of every reader
   *  with '*'. Never the owner's. Returns the rids changed. Optional so a host's own store keeps
   *  working; without it the recipients route answers 501 to a `closes` change. */
  setCloses?(artifactId: string, rids: string[] | '*', closesAt: string | null): Promise<string[]>
  /** Mark the named readers' links (or every non-owner's, with '*') as sent at `sentAt`. The
   *  earliest mark stands: a resend never moves it later. Returns the rids changed. Optional so a
   *  host's own store keeps working; without it the recipients route answers 501 to a `sent` mark. */
  setSent?(artifactId: string, rids: string[] | '*', sentAt: string): Promise<string[]>
  setExpiry(artifactId: string, expireAt: string | null): Promise<void>
  useToken(key: string, expiresAt: number): Promise<boolean>
  recordView(v: { artifactId: string; rid: string; session: string; device: string; at: string; addSeconds: number; play?: string }): Promise<void>
  views(artifactId: string): Promise<ViewDoc[]>
  expiring(nowIso: string): Promise<string[]>
  forget(artifactId: string): Promise<void>
}

export const CAME_BACK_MS = 3_600_000
const LABEL_MAX = 60
const NOTE_MAX = 2000

function makeRecipients(input: NewRecipient[], taken: Set<string>): Recipient[] {
  const at = new Date().toISOString()
  return input.map((i) => {
    const label = String(i.label ?? '').trim().slice(0, LABEL_MAX)
    if (!label) throw new Error('a reader needs a label')
    let rid = newRid()
    while (taken.has(rid)) rid = newRid()
    taken.add(rid)
    const note = typeof i.note === 'string' && i.note.trim() ? i.note.trim().slice(0, NOTE_MAX) : undefined
    // The owner never carries a window: setCloses skips them and the page hides the closed state
    // from them, so one stored here would offer Share on their link and then refuse it.
    return { rid, label, addedAt: at, ...(note ? { note } : {}), ...(i.owner ? { owner: true as const } : {}), ...(i.group ? { group: true as const } : {}), ...(typeof i.closesAt === 'string' && !i.owner ? { closesAt: i.closesAt } : {}), ...(i.provenance ? { provenance: { ...i.provenance } } : {}) }
  })
}

function revokeIn(rec: RecipientsRecord, rids: string[] | '*'): string[] {
  const at = new Date().toISOString()
  const hit: string[] = []
  for (const r of Object.values(rec.recipients)) {
    if (r.revokedAt || (rids !== '*' && !rids.includes(r.rid))) continue
    r.revokedAt = at
    hit.push(r.rid)
  }
  if (rids === '*') rec.revokedAll = at
  return hit
}

function closeIn(rec: RecipientsRecord, rids: string[] | '*', closesAt: string | null): string[] {
  const hit: string[] = []
  for (const r of Object.values(rec.recipients)) {
    if (r.owner || (rids !== '*' && !rids.includes(r.rid))) continue
    r.closesAt = closesAt
    hit.push(r.rid)
  }
  return hit
}

function sentIn(rec: RecipientsRecord, rids: string[] | '*', sentAt: string): string[] {
  const hit: string[] = []
  for (const r of Object.values(rec.recipients)) {
    if (r.owner || (rids !== '*' && !rids.includes(r.rid))) continue
    // Earliest wins. A later resend cannot hide opens that happened after the first send, and an
    // earlier time corrects a mark written late.
    if (r.sentAt && Date.parse(r.sentAt) <= Date.parse(sentAt)) continue
    r.sentAt = sentAt
    hit.push(r.rid)
  }
  return hit
}

function addView(prev: ViewDoc | undefined, v: Parameters<RecipientsStore['recordView']>[0]): ViewDoc {
  const doc: ViewDoc = prev ? { ...prev, plays: { ...prev.plays } } : { artifactId: v.artifactId, rid: v.rid, session: v.session, device: v.device, firstAt: v.at, lastAt: v.at, activeSeconds: 0, plays: {} }
  doc.activeSeconds += Math.max(0, Math.min(60, v.addSeconds))
  if (v.at > doc.lastAt) doc.lastAt = v.at
  if (v.play) doc.plays[v.play] = (doc.plays[v.play] ?? 0) + 1
  return doc
}

const viewId = (artifactId: string, rid: string, session: string) => `${artifactId}__${rid}__${session}`

export function memoryRecipientsStore(): RecipientsStore {
  const recs = new Map<string, RecipientsRecord>()
  const views = new Map<string, ViewDoc>()
  const tokens = new Set<string>()
  return {
    async get(id) { const r = recs.get(id); return r ? structuredClone(r) : null },
    async add(id, input) {
      const rec = recs.get(id) ?? { recipients: {}, expireAt: null, keep: false }
      const out = makeRecipients(input, new Set(Object.keys(rec.recipients)))
      for (const r of out) rec.recipients[r.rid] = r
      recs.set(id, rec)
      return structuredClone(out)
    },
    async revoke(id, rids) { const rec = recs.get(id); return rec ? revokeIn(rec, rids) : [] },
    async setCloses(id, rids, closesAt) { const rec = recs.get(id); return rec ? closeIn(rec, rids, closesAt) : [] },
    async setSent(id, rids, sentAt) { const rec = recs.get(id); return rec ? sentIn(rec, rids, sentAt) : [] },
    async setExpiry(id, expireAt) {
      const rec = recs.get(id) ?? { recipients: {}, expireAt: null, keep: false }
      rec.expireAt = expireAt
      rec.keep = expireAt === null
      recs.set(id, rec)
    },
    async useToken(key) { if (tokens.has(key)) return false; tokens.add(key); return true },
    async recordView(v) { const k = viewId(v.artifactId, v.rid, v.session); views.set(k, addView(views.get(k), v)) },
    async views(id) { return [...views.values()].filter((v) => v.artifactId === id).map((v) => structuredClone(v)) },
    async expiring(now) { return [...recs.entries()].filter(([, r]) => r.expireAt && r.expireAt <= now).map(([id]) => id) },
    async forget(id) { recs.delete(id); for (const k of [...views.keys()]) if (k.startsWith(`${id}__`)) views.delete(k) },
  }
}

export function createRecipientsStore(db: Firestore, base: string): RecipientsStore {
  const recsCol = () => db.collection(`${base}Recipients`)
  const viewsCol = () => db.collection(`${base}RecipientViews`)
  const tokensCol = () => db.collection(`${base}RecipientTokens`)
  const read = async (id: string): Promise<RecipientsRecord | null> => {
    const snap = await recsCol().doc(id).get()
    if (!snap.exists) return null
    const d = snap.data() as Partial<RecipientsRecord>
    return { recipients: d.recipients ?? {}, expireAt: d.expireAt ?? null, keep: d.keep === true, ...(d.revokedAll ? { revokedAll: d.revokedAll } : {}) }
  }
  return {
    get: read,
    async add(id, input) {
      const rec = (await read(id)) ?? { recipients: {}, expireAt: null, keep: false }
      const out = makeRecipients(input, new Set(Object.keys(rec.recipients)))
      // Write only the readers: a merge deep-merges the map and leaves expireAt/keep alone, so a
      // Keep that landed after the read above is never put back to keep:false.
      const patch: Record<string, unknown> = { recipients: Object.fromEntries(out.map((r) => [r.rid, r])) }
      await recsCol().doc(id).set(patch, { merge: true })
      return out
    },
    async revoke(id, rids) {
      const rec = await read(id)
      if (!rec) return []
      const hit = revokeIn(rec, rids)
      if (!hit.length && rids !== '*') return hit
      const patch: Record<string, unknown> = { recipients: Object.fromEntries(hit.map((rid) => [rid, { revokedAt: rec.recipients[rid].revokedAt }])) }
      if (rec.revokedAll) patch.revokedAll = rec.revokedAll
      await recsCol().doc(id).set(patch, { merge: true })
      return hit
    },
    async setCloses(id, rids, closesAt) {
      const rec = await read(id)
      if (!rec) return []
      const hit = closeIn(rec, rids, closesAt)
      if (!hit.length) return hit
      // A merge writes only this field on these readers: a revoke or an expiry that landed after the
      // read above is left alone. `null` clears the window (read back as no window).
      await recsCol().doc(id).set({ recipients: Object.fromEntries(hit.map((rid) => [rid, { closesAt }])) }, { merge: true })
      return hit
    },
    async setSent(id, rids, sentAt) {
      const rec = await read(id)
      if (!rec) return []
      const hit = sentIn(rec, rids, sentAt)
      if (!hit.length) return hit
      await recsCol().doc(id).set({ recipients: Object.fromEntries(hit.map((rid) => [rid, { sentAt }])) }, { merge: true })
      return hit
    },
    async setExpiry(id, expireAt) {
      await recsCol().doc(id).set({ expireAt, keep: expireAt === null }, { merge: true })
    },
    async useToken(key, expiresAt) {
      // A Date is a Firestore Timestamp, which is what a TTL policy on `expireAt` reads.
      try { await tokensCol().doc(key).create({ expireAt: new Date(expiresAt) }); return true }
      catch (e) { if ((e as { code?: number }).code === 6) return false; throw e }
    },
    async recordView(v) {
      const ref = viewsCol().doc(viewId(v.artifactId, v.rid, v.session))
      const snap = await ref.get()
      await ref.set(addView(snap.exists ? (snap.data() as ViewDoc) : undefined, v))
    },
    async views(id) {
      const snap = await viewsCol().where('artifactId', '==', id).get()
      return snap.docs.map((d) => d.data() as ViewDoc)
    },
    async expiring(now) {
      const snap = await recsCol().where('expireAt', '<=', now).get()
      return snap.docs.filter((d) => (d.data() as RecipientsRecord).expireAt).map((d) => d.id)
    },
    async forget(id) {
      await recsCol().doc(id).delete()
      const snap = await viewsCol().where('artifactId', '==', id).get()
      for (const d of snap.docs) await d.ref.delete()
    },
  }
}

/** One line per reader (never the owner), in the order they were added. */
export function summarizeViews(rec: RecipientsRecord, views: ViewDoc[], comments: { readerKey: string; id?: string | null; parent?: string | null; at: string; text: string }[]): RecipientSummary[] {
  return Object.values(rec.recipients).filter((r) => !r.owner).sort((a, b) => a.addedAt.localeCompare(b.addedAt)).map((r) => {
    const all = views.filter((v) => v.rid === r.rid).sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    // A RENDER BEFORE THE SEND IS NEVER THE READER (2026-10-25). The link was opened on the
    // sender's side while the text waited on approval, and the reader was reported as having
    // read a page that had not reached them. Nobody can have received a link before it was sent,
    // so a session that began earlier is someone else's, and so is every session on that same
    // device: the device had the link before the reader did. This decides by the send, not by
    // guessing at user agents, so it holds for any renderer (a person checking the page, a
    // preview that runs scripts) and costs a real reader nothing: their opens come after.
    // Kept at read time, never by refusing to record, so a send marked late reclassifies.
    const sentMs = r.sentAt ? Date.parse(r.sentAt) : NaN
    const pre = Number.isFinite(sentMs) ? all.filter((v) => Date.parse(v.firstAt) < sentMs) : []
    const preDevices = new Set(pre.map((v) => v.device))
    const early = all.filter((v) => preDevices.has(v.device))
    const mine = all.filter((v) => !preDevices.has(v.device))
    const firsts = mine.map((v) => Date.parse(v.firstAt))
    return {
      rid: r.rid, label: r.label, group: r.group === true, revoked: !!r.revokedAt, closesAt: r.closesAt ?? null,
      sentAt: r.sentAt ?? null,
      provenance: r.provenance ?? null,
      beforeSend: Number.isFinite(sentMs) ? { sessions: early.length, devices: preDevices.size, activeSeconds: early.reduce((n, v) => n + v.activeSeconds, 0), firstAt: early[0]?.firstAt ?? null } : null,
      opened: mine.length > 0,
      firstOpenAt: mine[0]?.firstAt ?? null,
      cameBack: firsts.length > 1 && firsts[firsts.length - 1] - firsts[0] >= CAME_BACK_MS,
      activeSeconds: mine.reduce((n, v) => n + v.activeSeconds, 0),
      plays: mine.reduce((n, v) => n + Object.values(v.plays).reduce((a, b) => a + b, 0), 0),
      devices: new Set(mine.map((v) => v.device)).size,
      comments: comments.filter((c) => ridOfReaderKey(c.readerKey) === r.rid).map((c) => ({ id: c.id ?? null, parent: c.parent ?? null, at: c.at, text: c.text })),
    }
  })
}
