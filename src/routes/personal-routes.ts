// The reader's own notes on a page, and nobody else's.
//
//   GET    /api/artifacts/<id>/personal              the signed-in reader's notes on this page
//   POST   /api/artifacts/<id>/personal              { value } adds one; { entry, value } edits one
//   DELETE /api/artifacts/<id>/personal?entry=<id>   deletes one
//
// Signed-in readers only, by the grant cookie. A reader who is not signed in gets 401 with
// `{ device: true }` and keeps the note in their browser instead, where no server (this host's
// owner included) can read it. There is deliberately NO publisher variant of any of these: the
// publish key opens nothing here, and personal-privacy.test.ts holds every handler to that.
import { NextRequest, NextResponse } from 'next/server'
import { ARTIFACT_ID_RE } from './ids.js'
import { GRANT_COOKIE, decide, signInUrl, verifyGrant } from '../artifacts/reader.js'
import { isUnlocked, unlockCookieName } from '../artifacts/unlock.js'
import { personalAudioDir, validatePersonal, type PersonalStore } from '../artifacts/personal-store.js'
import { isPersonalAudioPath } from '../artifacts/audio.js'
import type { ArtifactStore } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'

export type PersonalRoutesContext = {
  store: ArtifactStore
  personal?: PersonalStore
  readers?: ReadersStore
  readerSecret: () => string | undefined
  pageUrl: (id: string) => string
  signInOrigin?: string
  siteUrl: string
  /** A signed URL to play one of the reader's own recordings. */
  audioUrl?: (id: string, path: string) => Promise<string>
}
type Params = { params: Promise<{ id: string }> }
const MAX_BODY = 16 * 1024

export function createPersonalRoutes(ctx: PersonalRoutesContext) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  const siteOrigin = new URL(ctx.siteUrl).origin

  /** The page, the signed-in reader, and every door the page itself has; or the refusal. */
  async function open(req: NextRequest, id: string) {
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
    // The client reads `device: true` as "keep this note in the browser".
    if (!ctx.personal) return { error: json({ error: 'this host keeps no personal notes', device: true }, 501) }
    if (!reader) return { error: json({ error: 'sign in to keep notes everywhere', device: true, signIn }, 401) }
    return { id, uid: reader.uid, personal: ctx.personal }
  }

  // Each note with a recording carries a signed URL to play it, issued to its owner here and nowhere else.
  const list = async (o: { id: string; uid: string; personal: PersonalStore }) => {
    const notes: (Awaited<ReturnType<PersonalStore['list']>>[number] & { audioUrl?: string })[] = await o.personal.list(o.id, o.uid)
    const dir = personalAudioDir(o.uid)
    if (ctx.audioUrl) for (const n of notes) if (isPersonalAudioPath(n.value.audio, dir)) n.audioUrl = await ctx.audioUrl(o.id, n.value.audio)
    return json({ notes })
  }
  // A write carries the reader's cookies; a browser always names its Origin on one, so a foreign one is refused.
  const foreign = (req: NextRequest) => { const origin = req.headers.get('origin'); return origin !== null && origin !== siteOrigin }

  async function PERSONAL_GET(req: NextRequest, { params }: Params) {
    const o = await open(req, (await params).id)
    return 'error' in o ? o.error : list(o)
  }

  async function PERSONAL_POST(req: NextRequest, { params }: Params) {
    if (foreign(req)) return json({ error: 'wrong origin' }, 403)
    const declared = Number(req.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_BODY) return json({ error: 'request over 16 KB' }, 413)
    const raw = await req.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return json({ error: 'request over 16 KB' }, 413)
    let b: { value?: unknown; entry?: unknown }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'body must be JSON' }, 400)
      b = parsed as typeof b
    } catch {
      return json({ error: 'body must be JSON' }, 400)
    }
    const o = await open(req, (await params).id)
    if ('error' in o) return o.error
    const v = validatePersonal(b.value)
    if (!v.ok) return json({ error: v.error }, 400)
    // A note's recording is one this reader uploaded as a personal note: never a comment's, never another reader's.
    if (v.value.audio !== undefined && !isPersonalAudioPath(v.value.audio, personalAudioDir(o.uid))) return json({ error: 'a note\'s audio is the path its upload returned' }, 400)
    if (b.entry !== undefined) {
      if (typeof b.entry !== 'string' || !(await o.personal.replace(o.id, o.uid, b.entry, v.value))) return json({ error: 'no note of yours with that id' }, 404)
      return list(o)
    }
    const r = await o.personal.add(o.id, o.uid, v.value)
    if ('full' in r) return json({ error: 'you have left the most notes this page keeps' }, 409)
    return list(o)
  }

  async function PERSONAL_DELETE(req: NextRequest, { params }: Params) {
    if (foreign(req)) return json({ error: 'wrong origin' }, 403)
    const o = await open(req, (await params).id)
    if ('error' in o) return o.error
    const entry = req.nextUrl.searchParams.get('entry') ?? ''
    if (!(await o.personal.remove(o.id, o.uid, entry))) return json({ error: 'no note of yours with that id' }, 404)
    return list(o)
  }

  return { PERSONAL_GET, PERSONAL_POST, PERSONAL_DELETE }
}
