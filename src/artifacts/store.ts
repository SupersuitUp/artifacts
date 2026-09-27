// Firestore store for published artifacts. One document per id; the current
// body lives on the document and every previous body is kept in its `versions`
// SUBCOLLECTION, one document per version, so a re-publish is an in-place update with
// history rather than a new URL.
//
// History used to be an array ON the page document. Firestore caps a document at 1 MiB, and
// a 55 KB paper republished about 25 times crossed it: every publish after that failed with a
// 500 and the live page silently stayed on the old version (the lightpaper, 2026-09-24). The
// first save of a page still carrying the array moves it into the subcollection.
import { randomInt } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { ArtifactMeta } from './front-matter.js'
import type { Access } from './reader.js'
import type { StateConfig } from './state.js'
import type { ThemeMode } from '../brand/theme.js'
import type { Definition } from './definitions.js'

export type ArtifactRecord = {
  id: string
  title: string
  summary: string
  template: 'document'
  subtitle?: string
  audience?: string
  cover?: string
  voice?: string
  narration?: string
  timings?: string
  narrationHash?: string
  password?: string
  access?: Access
  state?: StateConfig
  theme?: ThemeMode
  toc?: boolean
  definitions?: Definition[]
  markdown: string
  createdAt: string
  updatedAt: string
  /** The current version number. Absent on pages saved before history moved out. */
  version?: number
  /** LEGACY: history as an array on the document. Moved to the subcollection on next save. */
  versions?: { markdown: string; at: string }[]
  /** The one-line change note the current version was published with. Absent when none was
   *  given: a version is never described by anything its author did not write. */
  note?: string
  views: number
}

/** One line of a page's history. `at` is when that version went live. */
export type VersionEntry = { version: number; at: string; note?: string; current?: true }
/** One version, readable: its body and the title it carried (absent on versions filed before
 *  0.7.0, which kept only the body; the page's current title stands in). */
export type VersionRecord = VersionEntry & { markdown: string; title?: string; subtitle?: string; summary?: string }

/** A change note is one line: whitespace collapsed, capped, empty means none. */
export const MAX_CHANGE_NOTE_CHARS = 280
export function cleanNote(note: unknown): string | undefined {
  if (typeof note !== 'string') return undefined
  const one = note.replace(/\s+/g, ' ').trim()
  return one ? one.slice(0, MAX_CHANGE_NOTE_CHARS) : undefined
}

// No 0/o, 1/l/i: an id read aloud or retyped from a screenshot must survive it.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function newArtifactId(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

export type SaveResult = { id: string; version: number; created: boolean } | { notFound: true }

export type SaveInput = {
  id?: string
  meta: ArtifactMeta
  markdown: string
  /** What changed in this version, in the author's words. Falls back to the front matter's `change:`. */
  note?: string
  /** Finish the SAME publish rather than start a new version: the publisher's second and third
   *  POSTs (uploaded image URLs, then narration) amend the version its first POST created. */
  amend?: boolean
}

export interface ArtifactStore {
  get(id: string): Promise<ArtifactRecord | null>
  save(input: SaveInput): Promise<SaveResult>
  delete(id: string): Promise<boolean>
  bumpViews(id: string): Promise<void>
  /** Set who may read a page without republishing it; 'public' opens it. False if no such page. */
  setAccess?(id: string, access: Access | 'public'): Promise<boolean>
  /** Every version, newest first, current included, without bodies. Null when no such page. */
  history?(id: string): Promise<VersionEntry[] | null>
  /** One version by number, current included. Null when the page or the version does not exist. */
  version?(id: string, n: number): Promise<VersionRecord | null>
  /** Write (or, with null, clear) the change note on one version after the fact. */
  setNote?(id: string, n: number, note: string | null): Promise<boolean>
}

/** The Firestore-backed store. The instance hands in its own Firestore, so the shell
 *  never knows which project it is writing to; a hosted tenant passes a namespaced one. */
export function createArtifactStore(db: Firestore, collection = 'artifacts'): ArtifactStore {
  const col = () => db.collection(collection)
  return {
    get: (id) => getArtifact(col, id),
    save: (input) => saveArtifact(col, input),
    delete: (id) => deleteArtifact(col, id),
    bumpViews: (id) => bumpViews(col, id),
    setAccess: async (id, access) => {
      const ref = col().doc(id)
      if (!(await ref.get()).exists) return false
      await ref.update({ access: access === 'public' ? FieldValue.delete() : access })
      return true
    },
    history: (id) => historyOf(col, id),
    version: (id, n) => versionOf(col, id, n),
    setNote: (id, n, note) => setNote(col, id, n, note),
  }
}

const vid = (n: number) => String(n).padStart(6, '0')
const currentOf = (a: ArtifactRecord) => a.version ?? (a.versions?.length ?? 0) + 1

async function historyOf(col: Col, id: string): Promise<VersionEntry[] | null> {
  const a = await getArtifact(col, id)
  if (!a) return null
  const current: VersionEntry = { version: currentOf(a), at: a.updatedAt, ...(a.note ? { note: a.note } : {}), current: true }
  let past: VersionEntry[]
  if (a.versions) {
    past = a.versions.map((v, i) => ({ version: i + 1, at: v.at }))
  } else {
    // `select` keeps the bodies out: a 55 KB page republished 40 times is 2 MB of history.
    const snap = await col().doc(id).collection('versions').select('version', 'at', 'note').get()
    past = snap.docs.map((d) => {
      const v = d.data() as { version: number; at: string; note?: string }
      return { version: v.version, at: v.at, ...(v.note ? { note: v.note } : {}) }
    })
  }
  return [current, ...past.filter((v) => v.version < current.version).sort((x, y) => y.version - x.version)]
}

async function versionOf(col: Col, id: string, n: number): Promise<VersionRecord | null> {
  if (!Number.isInteger(n) || n < 1) return null
  const a = await getArtifact(col, id)
  if (!a) return null
  const cur = currentOf(a)
  if (n === cur) {
    return { version: n, at: a.updatedAt, markdown: a.markdown, title: a.title, summary: a.summary, current: true,
      ...(a.subtitle ? { subtitle: a.subtitle } : {}), ...(a.note ? { note: a.note } : {}) }
  }
  if (n > cur) return null
  if (a.versions) {
    const v = a.versions[n - 1]
    return v ? { version: n, at: v.at, markdown: v.markdown } : null
  }
  const snap = await col().doc(id).collection('versions').doc(vid(n)).get()
  if (!snap.exists) return null
  const v = snap.data() as VersionRecord
  return { ...v, version: n }
}

async function setNote(col: Col, id: string, n: number, note: string | null): Promise<boolean> {
  const a = await getArtifact(col, id)
  if (!a || !Number.isInteger(n) || n < 1) return false
  const clean = note === null ? undefined : cleanNote(note)
  const value = clean ?? FieldValue.delete()
  if (n === currentOf(a)) {
    await col().doc(id).update({ note: value })
    return true
  }
  // A legacy array is moved out on the next save; notes go on the moved docs, so move it first.
  if (a.versions) return false
  const ref = col().doc(id).collection('versions').doc(vid(n))
  if (!(await ref.get()).exists) return false
  await ref.update({ note: value })
  return true
}

type Col = () => FirebaseFirestore.CollectionReference

async function getArtifact(col: Col, id: string): Promise<ArtifactRecord | null> {
  const snap = await col().doc(id).get()
  if (!snap.exists) return null
  return snap.data() as ArtifactRecord
}

async function saveArtifact(col: Col, input: SaveInput): Promise<SaveResult> {
  const now = new Date().toISOString()
  const note = cleanNote(input.note) ?? cleanNote(input.meta.change)
  const fields = {
    title: input.meta.title,
    summary: input.meta.summary,
    template: input.meta.template,
    ...(input.meta.subtitle ? { subtitle: input.meta.subtitle } : {}),
    ...(input.meta.audience ? { audience: input.meta.audience } : {}),
    ...(input.meta.cover ? { cover: input.meta.cover } : {}),
    ...(input.meta.voice ? { voice: input.meta.voice } : {}),
    ...(input.meta.narration ? { narration: input.meta.narration } : {}),
    ...(input.meta.timings ? { timings: input.meta.timings } : {}),
    ...(input.meta.narrationHash ? { narrationHash: input.meta.narrationHash } : {}),
    ...(input.meta.password ? { password: input.meta.password } : {}),
    ...(input.meta.access && input.meta.access !== 'public' ? { access: input.meta.access } : {}),
    ...(input.meta.state ? { state: input.meta.state } : {}),
    ...(input.meta.theme ? { theme: input.meta.theme } : {}),
    ...(input.meta.toc !== undefined ? { toc: input.meta.toc } : {}),
    ...(input.meta.definitions?.length ? { definitions: input.meta.definitions } : {}),
  }
  if (input.id) {
    const existing = await getArtifact(col, input.id)
    if (!existing) return { notFound: true }
    const ref = col().doc(input.id)
    const history = ref.collection('versions')
    const legacy = existing.versions ?? []
    const current = existing.version ?? legacy.length + 1
    // Move any legacy array out first, whatever else this save does.
    for (let i = 0; i < legacy.length; i++) await history.doc(vid(i + 1)).set({ version: i + 1, ...legacy[i] })
    // Three ways a save is NOT a new version: the publisher finishing the publish it started
    // (amend), and a republish whose body is unchanged with nothing to say about it (narration
    // attached by an older publisher, a metadata-only fix). Either way the version and its note
    // stand, and only the fields move.
    const same = input.markdown === existing.markdown && !note
    const fresh = !input.amend && !same
    // A note the file still carries from the version it replaces is a stale line, not news.
    const nextNote = fresh ? (note && note !== existing.note ? note : undefined) : (note ?? existing.note)
    if (fresh) {
      await history.doc(vid(current)).set({
        version: current, markdown: existing.markdown, at: existing.updatedAt,
        title: existing.title, summary: existing.summary,
        ...(existing.subtitle ? { subtitle: existing.subtitle } : {}), ...(existing.note ? { note: existing.note } : {}),
      })
    }
    const next = fresh ? current + 1 : current
    // An update merges, so a password the file no longer carries has to be cleared on purpose:
    // otherwise removing the line from the file would leave the door up on the live page.
    const password = input.meta.password ? {} : { password: FieldValue.delete() }
    // A subtitle the file no longer carries is gone from the page, like any other content.
    const subtitle = input.meta.subtitle ? {} : { subtitle: FieldValue.delete() }
    // Access is the opposite of password on purpose: absent leaves it alone, and only an explicit
    // `access: public` opens the page. Reopening a confidential page must never be a side effect.
    const access = input.meta.access === 'public' ? { access: FieldValue.delete() } : {}
    // Content, like the body: a republish that no longer declares state removes the slots.
    const state = input.meta.state ? {} : { state: FieldValue.delete() }
    // How the page looks is content too: a line the file no longer carries goes back to the default.
    const look = {
      ...(input.meta.theme ? {} : { theme: FieldValue.delete() }),
      ...(input.meta.toc !== undefined ? {} : { toc: FieldValue.delete() }),
      ...(input.meta.definitions?.length ? {} : { definitions: FieldValue.delete() }),
    }
    await ref.update({
      ...fields, ...password, ...subtitle, ...access, ...state, ...look, markdown: input.markdown, version: next,
      // `updatedAt` is when this version went live; finishing its own publish does not move it.
      ...(fresh || input.markdown !== existing.markdown ? { updatedAt: now } : {}),
      note: nextNote ?? FieldValue.delete(),
      ...(existing.versions ? { versions: FieldValue.delete() } : {}),
    })
    return { id: input.id, version: next, created: false }
  }
  const id = newArtifactId()
  const rec: ArtifactRecord = {
    id,
    ...fields,
    markdown: input.markdown,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...(note ? { note } : {}),
    views: 0,
  }
  await col().doc(id).set(rec)
  return { id, version: 1, created: true }
}

async function deleteArtifact(col: Col, id: string): Promise<boolean> {
  const ref = col().doc(id)
  const snap = await ref.get()
  if (!snap.exists) return false
  await ref.delete()
  return true
}

async function bumpViews(col: Col, id: string): Promise<void> {
  await col()
    .doc(id)
    .update({ views: FieldValue.increment(1) })
    .catch(() => {})
}
