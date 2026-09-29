// Readers' voice memos: the upload, and the host's transcription of it.
//
//   POST /api/artifacts/<id>/uploads/<memo>.<ext>  { audio: 'comment'|'personal' [, done: true] }
//        the same UPLOAD route the publisher uses, dispatched here when the body names `audio`:
//        a signed URL to PUT one recording to, then `done` to confirm it arrived
//   POST /api/artifacts/<id>/transcribe            { asset: <path the upload returned> }
//
// Who may upload or transcribe: for a shared comment, whoever may write the page's comments slot
// (the same doors the state POST opens: password, access, agreement, `comments:` writers); for a
// personal note, a signed-in reader, into a directory only their uid derives. A reader who is not
// signed in keeps a personal memo on their device and never reaches this file.
//
// The transcription key lives in `ctx.transcribe`'s closure and is never read here. Every
// failure of the service answers one fixed line: whatever it threw is dropped, never echoed.
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ARTIFACT_ID_RE } from './ids.js'
import { GRANT_COOKIE, decide, signInUrl, verifyGrant, type Reader } from '../artifacts/reader.js'
import { isUnlocked, unlockCookieName } from '../artifacts/unlock.js'
import { ANON_WRITES_PER_MINUTE, effectiveWriters } from '../artifacts/state.js'
import { COMMENTS_SLOT } from '../artifacts/comments.js'
import type { StateStore } from '../artifacts/state-store.js'
import { personalAudioDir, type PersonalStore } from '../artifacts/personal-store.js'
import type { ArtifactRecord, ArtifactStore } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import type { ArtifactAssets } from '../artifacts/assets.js'
import type { Transcriber } from '../artifacts/transcribe.js'
import {
  MAX_AUDIO_BYTES, MEMO_NAME, audioTypeFor, commentAudioPath, isCommentAudioPath, isPersonalAudioPath, personalAudioPath,
} from '../artifacts/audio.js'
import { ANON_COOKIE, rateKey } from './state-routes.js'

/** Host transcriptions per reader per page per hour. */
export const TRANSCRIBE_PER_HOUR = 20

export type VoiceRoutesContext = {
  store: ArtifactStore
  state?: StateStore
  personal?: PersonalStore
  readers?: ReadersStore
  assets?: ArtifactAssets
  transcribe?: Transcriber
  readerSecret: () => string | undefined
  pageUrl: (id: string) => string
  signInOrigin?: string
  siteUrl: string
  clientIp?: (req: NextRequest) => string
}
type Params = { params: Promise<{ id: string }> }
type Scope = 'comment' | 'personal'
const ANON_ID = /^[A-Za-z0-9]{24}$/

export function createVoiceRoutes(ctx: VoiceRoutesContext) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  const siteOrigin = new URL(ctx.siteUrl).origin
  const foreign = (req: NextRequest) => { const o = req.headers.get('origin'); return o !== null && o !== siteOrigin }
  const clientIp = (req: NextRequest) => (ctx.clientIp ? ctx.clientIp(req) : (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim())
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

  /** The page and the reader, through every door the page has; or the refusal. */
  async function open(req: NextRequest, id: string): Promise<{ error: NextResponse } | { a: ArtifactRecord; reader: Reader | null; signIn: string | null }> {
    const a = ARTIFACT_ID_RE.test(id) ? await ctx.store.get(id) : null
    if (!a) return { error: json({ error: `no artifact with id ${id}` }, 404) }
    if (a.password && !isUnlocked({ id, password: a.password, cookie: req.cookies.get(unlockCookieName(id))?.value }))
      return { error: json({ error: 'this page is locked' }, 403) }
    const reader = verifyGrant(ctx.readerSecret(), req.cookies.get(GRANT_COOKIE)?.value)
    const signIn = ctx.signInOrigin ? signInUrl(ctx.signInOrigin, ctx.pageUrl(id)) : null
    if (a.access) {
      if (!ctx.readers) return { error: json({ error: 'this page is closed' }, 403) }
      if (!reader) return { error: json({ error: 'sign in to read this page', signIn }, 401) }
      if (!decide(a.access, reader, await ctx.readers.allowList(id)).open) return { error: json({ error: 'this page is not open to you' }, 403) }
      if (!(await ctx.readers.acknowledged(id, reader.email))) return { error: json({ error: 'accept the agreement first' }, 403) }
    }
    return { a, reader, signIn }
  }

  /** May this reader write in `scope` on page `a`? Null when yes, else the refusal. */
  function mayWrite(a: ArtifactRecord, reader: Reader | null, scope: Scope, signIn: string | null): NextResponse | null {
    if (scope === 'personal') {
      if (!ctx.personal) return json({ error: 'this host keeps no personal notes', device: true }, 501)
      if (!reader) return json({ error: 'sign in to keep recordings everywhere', device: true, signIn }, 401)
      return null
    }
    const on = !!ctx.state && !!a.state && !!a.comments && a.comments !== 'off' && Object.hasOwn(a.state.slots, COMMENTS_SLOT)
    if (!on) return json({ error: 'this page takes no comments' }, 403)
    if (!reader && effectiveWriters(a.state!, a.access, COMMENTS_SLOT) !== 'anyone') return json({ error: 'sign in to comment', signIn }, 401)
    return null
  }

  /** Who is asking, for the per-reader counters: the account, else the anonymous cookie, else the address. */
  const askerKey = (req: NextRequest, reader: Reader | null) => {
    if (reader) return `u:${reader.uid}`
    const anon = req.cookies.get(ANON_COOKIE)?.value
    return anon && ANON_ID.test(anon) ? `a:${anon}` : `ip:${rateKey(clientIp(req), ctx.siteUrl, ctx.readerSecret())}`
  }

  /** The reader branch of UPLOAD. `body` is already parsed; `name` is `<memo>.<ext>`. */
  async function readerUpload(req: NextRequest, id: string, name: string, body: { audio?: unknown; done?: unknown }) {
    if (foreign(req)) return json({ error: 'wrong origin' }, 403)
    const assets = ctx.assets
    if (!assets?.signAudioUpload || !assets.audioSize) return json({ error: 'this host does not keep recordings' }, 501)
    const scope = body.audio
    if (scope !== 'comment' && scope !== 'personal') return json({ error: 'audio is comment or personal' }, 400)
    if (!MEMO_NAME.test(name)) return json({ error: 'a recording is named <id>.<webm|m4a|mp3|ogg>' }, 400)
    const type = audioTypeFor(name)!
    const o = await open(req, id)
    if ('error' in o) return o.error
    const refused = mayWrite(o.a, o.reader, scope, o.signIn)
    if (refused) return refused
    const path = scope === 'comment' ? commentAudioPath(name) : personalAudioPath(personalAudioDir(o.reader!.uid), name)
    if (body.done === true) {
      const size = await assets.audioSize(id, path)
      if (size === null) return json({ error: 'nothing was uploaded to that url' }, 409)
      if (size > MAX_AUDIO_BYTES) return json({ error: 'a recording is at most 4 MB' }, 413)
      return json({ path }, 201)
    }
    // An anonymous signer is counted like an anonymous answer, so a public page is not free storage.
    if (!o.reader) {
      const n = ctx.state ? await ctx.state.countAnonWrite(id, `au.${hash(askerKey(req, null))}`, Math.floor(Date.now() / 60000)) : 0
      if (n > ANON_WRITES_PER_MINUTE) return json({ error: 'too many recordings from here; try again in a minute' }, 429)
    }
    return json({ path, ...(await assets.signAudioUpload(id, path, type)) }, 201)
  }

  async function TRANSCRIBE(req: NextRequest, { params }: Params) {
    // No transcriber: the reader's browser is the floor, and a 404 is how it learns that.
    if (!ctx.transcribe) return json({ error: 'this host does not transcribe' }, 404)
    if (foreign(req)) return json({ error: 'wrong origin' }, 403)
    const raw = await req.text()
    if (raw.length > 1024) return json({ error: 'request over 1 KB' }, 413)
    let asset: unknown
    try { asset = (JSON.parse(raw) as { asset?: unknown } | null)?.asset } catch { return json({ error: 'body is { asset }' }, 400) }
    const o = await open(req, (await params).id)
    if ('error' in o) return o.error
    const { a, reader, signIn } = o
    let scope: Scope
    if (isCommentAudioPath(asset)) scope = 'comment'
    else if (typeof asset === 'string' && asset.startsWith('personal/')) {
      if (!reader) return json({ error: 'sign in to transcribe a personal note', signIn }, 401)
      // A personal recording is transcribed only for the reader it belongs to.
      if (!isPersonalAudioPath(asset, personalAudioDir(reader.uid))) return json({ error: 'no recording of yours at that path' }, 404)
      scope = 'personal'
    } else return json({ error: 'asset is the path the upload returned' }, 400)
    const refused = mayWrite(a, reader, scope, signIn)
    if (refused) return refused
    if (!ctx.state) return json({ error: 'this host keeps no counters' }, 501)
    if (!ctx.assets?.readAudio) return json({ error: 'this host does not keep recordings' }, 501)
    const n = await ctx.state.countAnonWrite(a.id, `tx.${hash(askerKey(req, reader))}`, Math.floor(Date.now() / 3_600_000))
    if (n > TRANSCRIBE_PER_HOUR) return json({ error: 'that is enough transcriptions for this hour; type it instead' }, 429)
    const path = asset as string
    const bytes = await ctx.assets.readAudio(a.id, path)
    if (!bytes) return json({ error: 'no recording at that path' }, 404)
    if (bytes.length > MAX_AUDIO_BYTES) return json({ error: 'a recording is at most 4 MB' }, 413)
    const mime = audioTypeFor(path)!
    let out: { text: string } | null = null
    try {
      out = await ctx.transcribe(new Blob([new Uint8Array(bytes)], { type: mime }), mime)
    } catch {
      out = null
    }
    if (!out || typeof out.text !== 'string') return json({ error: 'the transcription service did not answer' }, 502)
    return json({ text: out.text })
  }

  return { TRANSCRIBE, readerUpload }
}
