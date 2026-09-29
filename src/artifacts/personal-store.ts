// Personal notes: a comment only its writer will ever read. NOT the state core.
//
// The state core's `private` visibility hides an answer from other readers and still hands it to
// the publisher through /responses. A personal note promises the page's owner never sees it, so
// it lives in a store of its own that no publisher route reads. The route factory hands this store
// to exactly one set of handlers, the reader's own (/personal, behind their grant cookie), and a
// test (routes/personal-privacy.test.ts) calls every handler the factory returns with a publish key
// and fails if the note appears in any answer. That test is what makes the warning line true.
//
//   <base>Personal/<page>__<readerUid>/notes/<noteId>
//
// `base` is the artifacts collection path (`tenants/<id>/artifacts`), the same base the readers
// store uses, so each tenant's notes sit beside its own pages. A reader who is not signed in keeps
// notes on their device instead (reader/device-notes.ts): those never reach any server at all.
import { createHash, randomUUID } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { validateComment, type CommentValue } from './comments.js'

export type PersonalNoteValue = Omit<CommentValue, 'parent'>
export type PersonalNote = { id: string; value: PersonalNoteValue; at: string; updatedAt?: string }
export const MAX_PERSONAL_PER_READER = 500

/** The directory a signed-in reader's voice-note recordings live in under a page: derived from
 *  their uid, so a path names its owner without spelling out an account id, and a route can tell
 *  in one comparison whether a recording is the asker's own. */
export const personalAudioDir = (readerUid: string) => createHash('sha256').update(`personal-audio|${readerUid}`).digest('hex').slice(0, 24)

export interface PersonalStore {
  list(artifactId: string, readerUid: string): Promise<PersonalNote[]>
  add(artifactId: string, readerUid: string, value: PersonalNoteValue): Promise<PersonalNote | { full: true }>
  replace(artifactId: string, readerUid: string, noteId: string, value: PersonalNoteValue): Promise<PersonalNote | null>
  remove(artifactId: string, readerUid: string, noteId: string): Promise<boolean>
}

/** A personal note is a comment with no thread: nobody else can see it to reply. */
export function validatePersonal(v: unknown): { ok: true; value: PersonalNoteValue } | { ok: false; error: string } {
  if (v && typeof v === 'object' && 'parent' in v) return { ok: false, error: 'a personal note is not a reply' }
  const r = validateComment(v, () => null)
  return r.ok ? { ok: true, value: r.value } : r
}

const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/
// A Firestore document id cannot hold a slash; a signed uid never should, but the path is built from it.
const readerDoc = (artifactId: string, readerUid: string) => `${artifactId}__${readerUid.replace(/\//g, '_')}`
const byAt = (a: PersonalNote, b: PersonalNote) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)

export function createPersonalStore(db: Firestore, base: string): PersonalStore {
  const notes = (artifactId: string, readerUid: string) => db.collection(`${base}Personal`).doc(readerDoc(artifactId, readerUid)).collection('notes')
  const toNote = (id: string, d: { json: string; at: string; updatedAt?: string }): PersonalNote =>
    ({ id, value: JSON.parse(d.json) as PersonalNoteValue, at: d.at, ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}) })
  return {
    async list(artifactId, readerUid) {
      const snap = await notes(artifactId, readerUid).get()
      return snap.docs.map((d) => toNote(d.id, d.data() as { json: string; at: string })).sort(byAt)
    },
    async add(artifactId, readerUid, value) {
      const col = notes(artifactId, readerUid)
      if ((await col.count().get()).data().count >= MAX_PERSONAL_PER_READER) return { full: true }
      const ref = col.doc()
      const at = new Date().toISOString()
      // Stored as a JSON string, like the state core, because Firestore refuses nested arrays.
      await ref.set({ json: JSON.stringify(value), at })
      return { id: ref.id, value, at }
    },
    async replace(artifactId, readerUid, noteId, value) {
      if (!NOTE_ID.test(noteId)) return null
      const ref = notes(artifactId, readerUid).doc(noteId)
      const snap = await ref.get()
      if (!snap.exists) return null
      const updatedAt = new Date().toISOString()
      await ref.update({ json: JSON.stringify(value), updatedAt })
      return { ...toNote(noteId, snap.data() as { json: string; at: string }), value, updatedAt }
    },
    async remove(artifactId, readerUid, noteId) {
      if (!NOTE_ID.test(noteId)) return false
      const ref = notes(artifactId, readerUid).doc(noteId)
      if (!(await ref.get()).exists) return false
      await ref.delete()
      return true
    },
  }
}

/** The same contract in memory: for tests, and for hosts' own tests. */
export function createMemoryPersonalStore(): PersonalStore {
  const docs = new Map<string, Map<string, PersonalNote>>()
  const of = (artifactId: string, readerUid: string) => {
    const k = readerDoc(artifactId, readerUid)
    let m = docs.get(k)
    if (!m) docs.set(k, (m = new Map()))
    return m
  }
  return {
    list: async (artifactId, readerUid) => [...of(artifactId, readerUid).values()].map((n) => structuredClone(n)).sort(byAt),
    async add(artifactId, readerUid, value) {
      const m = of(artifactId, readerUid)
      if (m.size >= MAX_PERSONAL_PER_READER) return { full: true }
      const n: PersonalNote = { id: randomUUID().replace(/-/g, ''), value: structuredClone(value), at: new Date().toISOString() }
      m.set(n.id, n)
      return structuredClone(n)
    },
    async replace(artifactId, readerUid, noteId, value) {
      const m = of(artifactId, readerUid)
      const n = m.get(noteId)
      if (!n) return null
      const next = { ...n, value: structuredClone(value), updatedAt: new Date().toISOString() }
      m.set(noteId, next)
      return structuredClone(next)
    },
    remove: async (artifactId, readerUid, noteId) => of(artifactId, readerUid).delete(noteId),
  }
}
