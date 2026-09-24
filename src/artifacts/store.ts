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
  markdown: string
  createdAt: string
  updatedAt: string
  /** The current version number. Absent on pages saved before history moved out. */
  version?: number
  /** LEGACY: history as an array on the document. Moved to the subcollection on next save. */
  versions?: { markdown: string; at: string }[]
  views: number
}

// No 0/o, 1/l/i: an id read aloud or retyped from a screenshot must survive it.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function newArtifactId(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

export type SaveResult = { id: string; version: number; created: boolean } | { notFound: true }

export interface ArtifactStore {
  get(id: string): Promise<ArtifactRecord | null>
  save(input: { id?: string; meta: ArtifactMeta; markdown: string }): Promise<SaveResult>
  delete(id: string): Promise<boolean>
  bumpViews(id: string): Promise<void>
  /** Set who may read a page without republishing it; 'public' opens it. False if no such page. */
  setAccess?(id: string, access: Access | 'public'): Promise<boolean>
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
  }
}

type Col = () => FirebaseFirestore.CollectionReference

async function getArtifact(col: Col, id: string): Promise<ArtifactRecord | null> {
  const snap = await col().doc(id).get()
  if (!snap.exists) return null
  return snap.data() as ArtifactRecord
}

async function saveArtifact(col: Col, input: {
  id?: string
  meta: ArtifactMeta
  markdown: string
}): Promise<SaveResult> {
  const now = new Date().toISOString()
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
  }
  if (input.id) {
    const existing = await getArtifact(col, input.id)
    if (!existing) return { notFound: true }
    const ref = col().doc(input.id)
    const history = ref.collection('versions')
    const legacy = existing.versions ?? []
    const current = existing.version ?? legacy.length + 1
    const vid = (n: number) => String(n).padStart(6, '0')
    // Move any legacy array out first, then file the body being replaced under its own number.
    for (let i = 0; i < legacy.length; i++) await history.doc(vid(i + 1)).set({ version: i + 1, ...legacy[i] })
    await history.doc(vid(current)).set({ version: current, markdown: existing.markdown, at: existing.updatedAt })
    const next = current + 1
    // An update merges, so a password the file no longer carries has to be cleared on purpose:
    // otherwise removing the line from the file would leave the door up on the live page.
    const password = input.meta.password ? {} : { password: FieldValue.delete() }
    // A subtitle the file no longer carries is gone from the page, like any other content.
    const subtitle = input.meta.subtitle ? {} : { subtitle: FieldValue.delete() }
    // Access is the opposite of password on purpose: absent leaves it alone, and only an explicit
    // `access: public` opens the page. Reopening a confidential page must never be a side effect.
    const access = input.meta.access === 'public' ? { access: FieldValue.delete() } : {}
    await ref.update({
      ...fields, ...password, ...subtitle, ...access, markdown: input.markdown, updatedAt: now, version: next,
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
