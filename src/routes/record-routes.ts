// The recorder's API (0.74.0): batches of people an owner records voice eCards for. Every route
// takes the publish key (the Supersuit skill) or the owner or an admin signed in (the recorder page),
// through keyOrOwner, the check the owner panel's endpoints use; a signed-in change must come from
// this host's own pages and carry JSON.
//
//   POST  /api/record                              { title?, music?, people: [{ slug, name, note, photo? }] }
//         201 { batch, url }                        url is the recorder page, /record/<batch>
//   GET   /api/record/<batch>                       200 { batch, next }  next = the resume index
//   GET   /api/record/<batch>/<slug>                200 { entry }
//   PATCH /api/record/<batch>/<slug>                { timings: [{w,s,e,br?}] } | { built: { pageId } }   200 { entry }
//   POST  /api/record/<batch>/<slug>/take           { kind: raw|mixed, type, digest }            201 { uploadUrl, headers }
//         the same with done: true (and seconds?, voiceDelay?)                                    200 { entry }
//   PUT   /api/record/<batch>/<slug>/take?kind=&type=[&seconds=&voiceDelay=]  the bytes, where the
//         host cannot sign uploads                                                                200 { entry }
//   GET   /api/record/<batch>/<slug>/take?kind=raw|mixed   302 to a signed read URL (an hour)
//
// Takes go to the PRIVATE bucket, under the folder `record-<batch>`, never public.
import { NextResponse, type NextRequest } from 'next/server'
import type { ArtifactAssets } from '../artifacts/assets.js'
import { PRIVATE_REF } from '../artifacts/assets.js'
import { AUDIO_TYPES, baseMime } from '../artifacts/audio.js'
import { keyOrOwner, type OwnerAuth } from './owner-auth.js'
import { RECORD_BATCH_ID, RECORD_SLUG, firstWaiting, parseBatchInput, parseRecordTimings, type RecordStore } from '../artifacts/record-store.js'
import { ARTIFACT_ID_RE } from './ids.js'

export type RecordRoutesCtx = { record?: RecordStore; assets?: ArtifactAssets; ownerAuth: OwnerAuth; siteUrl: string }
type BatchParams = { params: Promise<{ batch: string }> }
type EntryParams = { params: Promise<{ batch: string; slug: string }> }

/** The take types a recorder sends: what browsers record, and the mix's WAV. */
export const TAKE_TYPES: Record<string, string> = { ...Object.fromEntries(Object.entries(AUDIO_TYPES).map(([ext, t]) => [t, ext])), 'audio/wav': 'wav' }
/** A take through the route itself (a host that cannot sign uploads): about 3 minutes of WAV. */
export const MAX_TAKE_BYTES = 12 * 1024 * 1024
export const recordFolder = (batch: string) => `record-${batch}`
const DIGEST = /^[0-9a-f]{8}$/

export function createRecordRoutes(ctx: RecordRoutesCtx) {
  const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { 'cache-control': 'no-store' } })
  const no = (error: string, status: number) => json({ error }, status)
  const ready = () => (ctx.record ? null : no('this host keeps no recorder batches', 501))

  async function entryOf(batch: string, slug: string) {
    if (!RECORD_BATCH_ID.test(batch) || !RECORD_SLUG.test(slug)) return null
    const b = await ctx.record!.get(batch)
    return b?.entries[slug] ? b : null
  }

  /** POST /api/record: a new batch. */
  async function RECORD(req: NextRequest) {
    const refused = keyOrOwner(req, ctx.ownerAuth, { write: true, json: true }) ?? ready()
    if (refused) return refused
    const p = parseBatchInput(await req.json().catch(() => null))
    if (!p.ok) return no(p.error, 400)
    const batch = await ctx.record!.create(p.value)
    return json({ batch, url: `${ctx.siteUrl}/record/${batch.id}` }, 201)
  }

  /** GET /api/record/<batch>: the batch and where the recorder resumes. */
  async function RECORD_BATCH(req: NextRequest, { params }: BatchParams) {
    const refused = keyOrOwner(req, ctx.ownerAuth) ?? ready()
    if (refused) return refused
    const { batch } = await params
    const b = RECORD_BATCH_ID.test(batch) ? await ctx.record!.get(batch) : null
    return b ? json({ batch: b, next: firstWaiting(b) }) : no('no such batch', 404)
  }

  /** GET and PATCH /api/record/<batch>/<slug>: one person, their timings, their build. */
  async function RECORD_ENTRY(req: NextRequest, { params }: EntryParams) {
    const write = req.method !== 'GET'
    const refused = keyOrOwner(req, ctx.ownerAuth, { write, json: write }) ?? ready()
    if (refused) return refused
    const { batch, slug } = await params
    const b = await entryOf(batch, slug)
    if (!b) return no('no such person in that batch', 404)
    if (!write) return json({ entry: b.entries[slug] })
    if (req.method !== 'PATCH') return no('GET or PATCH', 405)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    try {
      if (body && 'timings' in body) {
        const t = parseRecordTimings(body.timings)
        if (!t.ok) return no(t.error, 400)
        return json({ entry: await ctx.record!.setTimings(batch, slug, t.words) })
      }
      const built = body?.built as { pageId?: unknown } | undefined
      if (built && typeof built.pageId === 'string' && ARTIFACT_ID_RE.test(built.pageId)) return json({ entry: await ctx.record!.setBuilt(batch, slug, built.pageId) })
    } catch (e) {
      return no(e instanceof Error ? e.message : 'could not change the entry', 409)
    }
    return no('send { timings: [...] } or { built: { pageId } }', 400)
  }

  /** The take: sign an upload and confirm it, take the bytes through the route, or read it back. */
  async function RECORD_TAKE(req: NextRequest, { params }: EntryParams) {
    const write = req.method !== 'GET'
    const refused = keyOrOwner(req, ctx.ownerAuth, { write, json: req.method === 'POST' }) ?? ready()
    if (refused) return refused
    const { batch, slug } = await params
    const b = await entryOf(batch, slug)
    if (!b) return no('no such person in that batch', 404)
    const a = ctx.assets
    const folder = recordFolder(batch)
    const q = req.nextUrl.searchParams
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : NaN)
    const extras = (seconds: unknown, voiceDelay: unknown) => ({
      ...(Number.isFinite(num(seconds)) && num(seconds) >= 0 ? { seconds: Math.round(num(seconds) * 100) / 100 } : {}),
      ...(Number.isFinite(num(voiceDelay)) && num(voiceDelay) >= 0 ? { voiceDelay: num(voiceDelay) } : {}),
    })
    if (req.method === 'GET') {
      const kind = q.get('kind') === 'mixed' ? 'mixed' : 'raw'
      const ref = b.entries[slug][kind]
      const stored = ref ? PRIVATE_REF.exec(ref)?.[1] : undefined
      if (!stored) return no(`no ${kind} take yet`, 404)
      if (!a?.privateUrl) return no('this host keeps no private files', 501)
      return NextResponse.redirect(await a.privateUrl(folder, stored), { status: 302, headers: { 'cache-control': 'no-store' } })
    }
    const kindOf = (v: unknown) => (v === 'raw' || v === 'mixed' ? v : null)
    if (req.method === 'PUT') {
      const kind = kindOf(q.get('kind'))
      const type = baseMime(q.get('type') ?? '')
      const ext = TAKE_TYPES[type]
      if (!kind || !ext) return no('kind must be raw or mixed, and type an audio type the page keeps', 400)
      if (!a?.putPrivate) return no('this host keeps no private files', 501)
      const bytes = Buffer.from(await req.arrayBuffer())
      if (!bytes.length || bytes.length > MAX_TAKE_BYTES) return no(`a take is 1 byte to ${MAX_TAKE_BYTES} bytes`, 413)
      const path = await a.putPrivate(folder, `${slug}-${kind}.${ext}`, bytes, type)
      return json({ entry: await ctx.record!.setTake(batch, slug, { kind, path, ...(kind === 'raw' ? { mime: type } : {}), ...extras(q.get('seconds'), q.get('voiceDelay')) }) })
    }
    if (req.method !== 'POST') return no('GET, POST or PUT', 405)
    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
    const kind = kindOf(body.kind)
    const type = baseMime(typeof body.type === 'string' ? body.type : '')
    const ext = TAKE_TYPES[type]
    if (!kind || !ext || typeof body.digest !== 'string' || !DIGEST.test(body.digest)) return no('send { kind: raw|mixed, type, digest: <first 8 hex of the sha-256> }', 400)
    const name = `${slug}-${kind}.${ext}`
    if (!a?.signPrivateUpload || !a.finishPrivateUpload) return no('this host cannot sign uploads: PUT the bytes instead', 501)
    if (body.done !== true) return json(await a.signPrivateUpload(folder, name, body.digest, type).then(({ uploadUrl, headers }) => ({ uploadUrl, headers })), 201)
    const path = await a.finishPrivateUpload(folder, name, body.digest)
    if (!path) return no('nothing arrived at the upload address', 409)
    return json({ entry: await ctx.record!.setTake(batch, slug, { kind, path, ...(kind === 'raw' ? { mime: type } : {}), ...extras(body.seconds, body.voiceDelay) }) })
  }

  return { RECORD, RECORD_BATCH, RECORD_ENTRY, RECORD_TAKE }
}
