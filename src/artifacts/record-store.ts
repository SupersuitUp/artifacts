// The recorder's batches (0.74.0). A batch is the people an owner records a voice eCard for in one
// sitting: each one's name, photo and the note that prompts what to say, and, once recorded, the
// take's stored paths (the raw recording and the mix), its word timings and the page built from it.
// The store is host-side, like the recipients store; the helpers are browser-safe (the recorder
// page reads entriesOf and firstWaiting). One document per batch:
//   <base>RecordBatches/<batchId>   RecordBatch, entries keyed by slug, `order` keeping the order given
import { musicTrack } from './music.js'
import type { Firestore } from 'firebase-admin/firestore'
import { parseVoiceEcardTimings, type VoiceEcardTiming } from './voice-ecard.js'

export type RecordPerson = { slug: string; name: string; photo?: string; note: string }
/** `waiting` until the raw take is stored; `recorded` after; `built` once a page was made from it. */
export type RecordStatus = 'waiting' | 'recorded' | 'built'
export type RecordEntry = RecordPerson & {
  status: RecordStatus
  /** The raw recording and the mix, as `private:<stored name>` in the batch's private folder. */
  raw?: string
  mixed?: string
  /** The raw recording's type and length. */
  mime?: string
  seconds?: number
  /** Where the voice starts in the mix: timings measured on the raw take shift by this. */
  voiceDelay?: number
  recordedAt?: string
  /** Word timings in the MIX's timeline, written by the operator's computer (the host's transcriber
   *  answers text only). */
  timings?: VoiceEcardTiming[]
  pageId?: string
  builtAt?: string
}
/** `music`: a track id from the music library (music.ts) or an https address of a bed. */
export type RecordBatch = { id: string; title: string; music?: string; createdAt: string; order: string[]; entries: Record<string, RecordEntry> }
export type RecordBatchInput = { title: string; music?: string; people: RecordPerson[] }
export type RecordTake = { kind: 'raw' | 'mixed'; path: string; mime?: string; seconds?: number; voiceDelay?: number }

export interface RecordStore {
  create(input: RecordBatchInput): Promise<RecordBatch>
  get(id: string): Promise<RecordBatch | null>
  /** Null when the batch or the person is not there. A new raw take drops the timings and the build. */
  setTake(id: string, slug: string, take: RecordTake): Promise<RecordEntry | null>
  /** Throws `no take` before the raw take is stored. */
  setTimings(id: string, slug: string, timings: VoiceEcardTiming[]): Promise<RecordEntry | null>
  setBuilt(id: string, slug: string, pageId: string): Promise<RecordEntry | null>
}

export const RECORD_BATCH_ID = /^[a-z0-9]{10}$/
export const RECORD_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/
export const MAX_BATCH_PEOPLE = 200
const MAX_NOTE = 4000
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'
// Web Crypto, not node:crypto: the recorder page imports this module in the browser.
export const newBatchId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHA[b % ALPHA.length]).join('')
const https = (v: unknown) => { try { return typeof v === 'string' && new URL(v).protocol === 'https:' } catch { return false } }

/** A batch as the API takes it, checked. */
export function parseBatchInput(b: unknown): { ok: true; value: RecordBatchInput } | { ok: false; error: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 120) : 'Voice eCards'
  if (o.music !== undefined && o.music !== null && !https(o.music) && !(typeof o.music === 'string' && musicTrack(o.music))) return { ok: false, error: 'music must be a track id from the music library or an https address of the bed' }
  if (!Array.isArray(o.people) || !o.people.length) return { ok: false, error: 'people must be a non-empty list of { slug, name, note, photo? }' }
  if (o.people.length > MAX_BATCH_PEOPLE) return { ok: false, error: `a batch holds at most ${MAX_BATCH_PEOPLE} people` }
  const seen = new Set<string>()
  const people: RecordPerson[] = []
  for (const [i, raw] of o.people.entries()) {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const at = `person ${i + 1}`
    if (typeof p.slug !== 'string' || !RECORD_SLUG.test(p.slug)) return { ok: false, error: `${at}: slug must be lowercase letters, digits and dashes` }
    if (seen.has(p.slug)) return { ok: false, error: `${at}: the slug ${p.slug} is in the batch twice` }
    seen.add(p.slug)
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) return { ok: false, error: `${at}: name must be 1 to 80 characters` }
    if (p.photo !== undefined && p.photo !== null && !https(p.photo)) return { ok: false, error: `${at}: photo must be an https address` }
    if (typeof p.note !== 'string' || p.note.length > MAX_NOTE) return { ok: false, error: `${at}: note must be text, up to ${MAX_NOTE} characters` }
    people.push({ slug: p.slug, name: p.name.trim(), ...(typeof p.photo === 'string' ? { photo: p.photo } : {}), note: p.note })
  }
  return { ok: true, value: { title, ...(typeof o.music === 'string' ? { music: o.music } : {}), people } }
}

/** The people in the order given. */
export const entriesOf = (b: RecordBatch): RecordEntry[] => b.order.map((s) => b.entries[s]).filter(Boolean)

/** THE RESUME RULE: the recorder opens at the first person with no raw take, so closing the page
 *  loses nothing and reopening it carries on. Past the last person (entries.length) when all are done. */
export function firstWaiting(b: RecordBatch): number {
  const list = entriesOf(b)
  const i = list.findIndex((e) => !e.raw)
  return i === -1 ? list.length : i
}

function fresh(input: RecordBatchInput): RecordBatch {
  return {
    id: newBatchId(), title: input.title, ...(input.music ? { music: input.music } : {}), createdAt: new Date().toISOString(),
    order: input.people.map((p) => p.slug),
    entries: Object.fromEntries(input.people.map((p) => [p.slug, { ...p, status: 'waiting' as const }])),
  }
}

/** The entry after a take, timings or a build: the one rule both stores apply. */
function apply(e: RecordEntry, change: { take?: RecordTake; timings?: VoiceEcardTiming[]; pageId?: string }): RecordEntry {
  const next: RecordEntry = { ...e }
  if (change.take) {
    const t = change.take
    if (t.kind === 'raw') {
      next.raw = t.path
      next.status = 'recorded'
      next.recordedAt = new Date().toISOString()
      if (t.mime) next.mime = t.mime
      delete next.seconds
      // A new take: what was timed and built from the old one no longer matches it.
      delete next.timings; delete next.pageId; delete next.builtAt; delete next.mixed
    } else {
      next.mixed = t.path
    }
    if (t.voiceDelay !== undefined) next.voiceDelay = t.voiceDelay
    // The take's length: from the raw file, or from the mix's decode where the browser could not
    // read the raw file's length (Chrome's MediaRecorder webm reports none).
    if (t.seconds !== undefined && (t.kind === 'raw' || next.seconds === undefined)) next.seconds = t.seconds
  }
  if (change.timings) {
    if (!e.raw) throw new Error('no take for this person yet')
    next.timings = change.timings
  }
  if (change.pageId) {
    if (!e.raw) throw new Error('no take for this person yet')
    next.pageId = change.pageId
    next.builtAt = new Date().toISOString()
    next.status = 'built'
  }
  return next
}

export function memoryRecordStore(): RecordStore {
  const all = new Map<string, RecordBatch>()
  const change = async (id: string, slug: string, c: Parameters<typeof apply>[1]) => {
    const b = all.get(id)
    const e = b?.entries[slug]
    if (!b || !e) return null
    b.entries[slug] = apply(e, c)
    return structuredClone(b.entries[slug])
  }
  return {
    async create(input) { const b = fresh(input); all.set(b.id, b); return structuredClone(b) },
    async get(id) { const b = all.get(id); return b ? structuredClone(b) : null },
    setTake: (id, slug, take) => change(id, slug, { take }),
    setTimings: (id, slug, timings) => change(id, slug, { timings }),
    setBuilt: (id, slug, pageId) => change(id, slug, { pageId }),
  }
}

export function createRecordStore(db: Firestore, base: string): RecordStore {
  const col = () => db.collection(`${base}RecordBatches`)
  // One person's entry is rewritten whole, inside a transaction, so two takes landing at once for
  // two people never overwrite each other and a stale read never puts an old take back.
  const change = async (id: string, slug: string, c: Parameters<typeof apply>[1]) => {
    if (!RECORD_BATCH_ID.test(id) || !RECORD_SLUG.test(slug)) return null
    const ref = col().doc(id)
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const e = snap.exists ? (snap.data() as RecordBatch).entries?.[slug] : undefined
      if (!e) return null
      const next = apply(e, c)
      tx.update(ref, { [`entries.${slug}`]: next })
      return next
    })
  }
  return {
    async create(input) { const b = fresh(input); await col().doc(b.id).create(b); return b },
    async get(id) {
      if (!RECORD_BATCH_ID.test(id)) return null
      const snap = await col().doc(id).get()
      return snap.exists ? (snap.data() as RecordBatch) : null
    },
    setTake: (id, slug, take) => change(id, slug, { take }),
    setTimings: (id, slug, timings) => change(id, slug, { timings }),
    setBuilt: (id, slug, pageId) => change(id, slug, { pageId }),
  }
}

/** Timings as the API takes them: the voice eCard's own `{w, s, e, br?}` list. */
export const parseRecordTimings = parseVoiceEcardTimings
