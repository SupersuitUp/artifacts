// The host-side record for gated pages: who may read each one, and what each reader did.
//
// Lives in Firestore beside the pages, never in a published file, because a person's email
// never goes into file content, and so that changing who may read needs no republish.
//
//   <base>Access/<artifactId>     { readers: { <email>: AllowEntry } }
//   <base>Sessions/<sessionId>    one visit: who, when, how long actively reading, how far
//   <base>Flags/<auto>            one attempt to save, print, copy, or open a page refused
//   <base>Acks/<page>__<email>    the reader's agreement to keep the page confidential, with the
//                                 exact wording they agreed to, before the body was shown
//
// `base` is the artifacts collection path (`tenants/<id>/artifacts`), so each tenant's record
// sits next to its own pages.
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { AllowEntry, Reader } from './reader.js'

export const FLAG_KINDS = ['save', 'print', 'copy', 'image', 'devtools', 'refused'] as const
export type FlagKind = (typeof FLAG_KINDS)[number]

export type SessionDoc = {
  artifactId: string
  session: string
  email: string
  name: string | null
  member: boolean
  startedAt: string
  lastAt: string
  activeSeconds: number
  maxScroll: number
  device?: string
  country?: string
}

export type FlagDoc = { artifactId: string; email: string; name: string | null; kind: FlagKind; detail?: string; at: string; country?: string }

export type AckDoc = { artifactId: string; email: string; name: string | null; text: string; at: string; country?: string }

export interface ReadersStore {
  acknowledged(artifactId: string, email: string): Promise<boolean>
  acknowledge(input: { artifactId: string; reader: Reader; text: string; country?: string }): Promise<void>
  acks(artifactId: string): Promise<AckDoc[]>
  allowList(artifactId: string): Promise<AllowEntry[]>
  allow(artifactId: string, add: AllowEntry[], remove: string[]): Promise<AllowEntry[]>
  touchSession(input: {
    artifactId: string
    session: string
    reader: Reader
    addSeconds: number
    scroll: number
    device?: string
    country?: string
  }): Promise<void>
  flag(input: { artifactId: string; reader: Reader; kind: FlagKind; detail?: string; country?: string }): Promise<void>
  sessions(artifactId: string): Promise<SessionDoc[]>
  flags(artifactId: string): Promise<FlagDoc[]>
}

/** An email as a map key: lowercased, and with the dots Firestore reads as a path escaped. */
const keyOf = (email: string) => email.trim().toLowerCase().replace(/\./g, ',')

export function createReadersStore(db: Firestore, base: string): ReadersStore {
  const access = () => db.collection(`${base}Access`)
  const sessions = () => db.collection(`${base}Sessions`)
  const flags = () => db.collection(`${base}Flags`)
  const acks = () => db.collection(`${base}Acks`)
  const ackId = (artifactId: string, email: string) => `${artifactId}__${keyOf(email)}`
  const listOf = (data: Record<string, unknown> | undefined): AllowEntry[] =>
    Object.values(((data?.readers as Record<string, AllowEntry>) ?? {})).sort((a, b) => a.email.localeCompare(b.email))

  return {
    async acknowledged(artifactId, email) {
      return (await acks().doc(ackId(artifactId, email)).get()).exists
    },
    async acknowledge({ artifactId, reader, text, country }) {
      const doc: AckDoc = { artifactId, email: reader.email, name: reader.name, text, at: new Date().toISOString(), ...(country ? { country } : {}) }
      await acks().doc(ackId(artifactId, reader.email)).set(doc)
    },
    async acks(artifactId) {
      const snap = await acks().where('artifactId', '==', artifactId).get()
      return snap.docs.map((d) => d.data() as AckDoc)
    },
    async allowList(artifactId) {
      const snap = await access().doc(artifactId).get()
      return snap.exists ? listOf(snap.data()) : []
    },
    async allow(artifactId, add, remove) {
      const now = new Date().toISOString()
      const update: Record<string, unknown> = {}
      for (const e of add) {
        const email = e.email.trim().toLowerCase()
        update[`readers.${keyOf(email)}`] = {
          email,
          ...(e.name?.trim() ? { name: e.name.trim() } : {}),
          ...(e.reason?.trim() ? { reason: e.reason.trim() } : {}),
          addedAt: now,
        }
      }
      for (const email of remove) update[`readers.${keyOf(email)}`] = FieldValue.delete()
      const ref = access().doc(artifactId)
      if (Object.keys(update).length) {
        // Create the document only when it is missing. `set({ readers: {} }, { merge: true })`
        // looks harmless and is not: Firestore writes an EMPTY map in a merge as a value, so it
        // replaced the whole list and every `allow` erased everyone added before it. Seen live
        // on 2026-09-24, when adding one reader to the lightpaper removed the one before.
        if (!(await ref.get()).exists) await ref.set({ readers: {} })
        await ref.update(update)
      }
      return listOf((await ref.get()).data())
    },
    async touchSession({ artifactId, session, reader, addSeconds, scroll, device, country }) {
      const ref = sessions().doc(session)
      const now = new Date().toISOString()
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) {
          const doc: SessionDoc = {
            artifactId, session, email: reader.email, name: reader.name, member: reader.member,
            startedAt: now, lastAt: now, activeSeconds: addSeconds, maxScroll: scroll,
            ...(device ? { device } : {}), ...(country ? { country } : {}),
          }
          tx.set(ref, doc)
          return
        }
        const cur = snap.data() as SessionDoc
        // A session id is the browser's; it can never be moved onto another reader or page.
        if (cur.email !== reader.email || cur.artifactId !== artifactId) return
        tx.update(ref, {
          lastAt: now,
          activeSeconds: FieldValue.increment(addSeconds),
          maxScroll: Math.max(cur.maxScroll ?? 0, scroll),
        })
      })
    },
    async flag({ artifactId, reader, kind, detail, country }) {
      const doc: FlagDoc = {
        artifactId, email: reader.email, name: reader.name, kind, at: new Date().toISOString(),
        ...(detail ? { detail } : {}), ...(country ? { country } : {}),
      }
      await flags().add(doc)
    },
    async sessions(artifactId) {
      const snap = await sessions().where('artifactId', '==', artifactId).get()
      return snap.docs.map((d) => d.data() as SessionDoc)
    },
    async flags(artifactId) {
      const snap = await flags().where('artifactId', '==', artifactId).get()
      return snap.docs.map((d) => d.data() as FlagDoc)
    },
  }
}

export type ReaderSummary = {
  email: string
  name: string | null
  member: boolean
  sessions: number
  activeSeconds: number
  maxScroll: number
  firstSeen: string
  lastSeen: string
  flags: { kind: FlagKind; at: string; detail?: string }[]
}

/** Per-reader totals for one page, most recently seen first, plus everyone refused at the door. */
export function summarize(sessionDocs: SessionDoc[], flagDocs: FlagDoc[]) {
  const by = new Map<string, ReaderSummary>()
  for (const s of sessionDocs) {
    const r = by.get(s.email) ?? {
      email: s.email, name: s.name, member: s.member, sessions: 0, activeSeconds: 0, maxScroll: 0,
      firstSeen: s.startedAt, lastSeen: s.lastAt, flags: [],
    }
    r.sessions += 1
    r.activeSeconds += s.activeSeconds ?? 0
    r.maxScroll = Math.max(r.maxScroll, s.maxScroll ?? 0)
    if (s.startedAt < r.firstSeen) r.firstSeen = s.startedAt
    if (s.lastAt > r.lastSeen) r.lastSeen = s.lastAt
    by.set(s.email, r)
  }
  const refused = new Map<string, { email: string; name: string | null; attempts: number; lastAt: string }>()
  for (const f of flagDocs.slice().sort((a, b) => a.at.localeCompare(b.at))) {
    if (f.kind === 'refused') {
      const r = refused.get(f.email) ?? { email: f.email, name: f.name, attempts: 0, lastAt: f.at }
      r.attempts += 1
      r.lastAt = f.at
      refused.set(f.email, r)
      continue
    }
    by.get(f.email)?.flags.push({ kind: f.kind, at: f.at, ...(f.detail ? { detail: f.detail } : {}) })
  }
  return {
    readers: [...by.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    refused: [...refused.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
  }
}
