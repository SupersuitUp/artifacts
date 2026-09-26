// The state routes: what readers put into a page, and what the publisher gets back.
//
//   GET  /api/artifacts/<id>/state      the reader's own answers + what the page lets them see
//   POST /api/artifacts/<id>/state      { slot, op: set|append|remove, value?, entry? }
//   GET  /api/artifacts/<id>/responses  publish key; every answer with who (?format=csv)
//   DELETE /api/artifacts/<id>/responses?reader=<key>  publish key; one reader's answers
//
// Who is writing: the grant a gated page already uses, or on a page with `writers: anyone`, an
// anonymous id in an HttpOnly cookie. When both are present the anonymous answers move to the
// signed-in reader, once, and the cookie is cleared.
import { createHmac, randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isPublishAuthed } from '../artifacts/auth.js'
import { ARTIFACT_ID_RE } from './ids.js'
import { GRANT_COOKIE, decide, firstName, signInUrl, verifyGrant, type Reader } from '../artifacts/reader.js'
import { isUnlocked, unlockCookieName } from '../artifacts/unlock.js'
import { ANON_WRITES_PER_MINUTE, MAX_ENTRIES_PER_SLOT, checkValue, effectiveWriters } from '../artifacts/state.js'
import { readerKeyFor, type StateStore, type Writer } from '../artifacts/state-store.js'
import { NOTES_SLOT, checkNoteValue, hasNotesWidget } from '../artifacts/widgets.js'
import { responsesCsv, responsesOf, stateView } from '../artifacts/state-view.js'
import type { ArtifactRecord, ArtifactStore } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'

export const ANON_COOKIE = 'artifact_anon'
const ANON_ID = /^[A-Za-z0-9]{24}$/
const MAX_BODY = 16 * 1024

/** The id an anonymous writer's rate counter is stored under. An HMAC over the site and the IP,
 *  keyed by the reader secret when the host has one (so the stored value cannot be reversed by
 *  hashing the IPv4 space), else by the site URL. The site is in the message either way, so two
 *  hosts sharing a secret still count one visitor under unrelated ids. */
export function rateKey(ip: string, siteUrl: string, secret?: string): string {
  return createHmac('sha256', secret || siteUrl).update(`${siteUrl}|${ip}`).digest('hex').slice(0, 16)
}

export type StateRoutesContext = {
  store: ArtifactStore
  state?: StateStore
  readers?: ReadersStore
  readerSecret: () => string | undefined
  publishKey: () => string | undefined
  pageUrl: (id: string) => string
  signInOrigin?: string
  siteUrl: string
  /** The address the rate limit counts by. Default reads the first hop of `x-forwarded-for`,
   *  which is correct on Vercel (it overwrites XFF with the real client IP) and wrong behind any
   *  other proxy that appends rather than replaces; a host behind one of those passes its own. */
  clientIp?: (req: NextRequest) => string
}
type Params = { params: Promise<{ id: string }> }

export function createStateRoutes(ctx: StateRoutesContext) {
  const anonCookie = (v: string, maxAge: number) => `${ANON_COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  const newAnonId = () => { let s = ''; while (s.length < 24) s += randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, ''); return s.slice(0, 24) }
  const defaultClientIp = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const ipHash = (req: NextRequest) => rateKey((ctx.clientIp ?? defaultClientIp)(req), ctx.siteUrl, ctx.readerSecret())
  const siteOrigin = new URL(ctx.siteUrl).origin

  /** Resolve the page and who is asking, or the refusal. Shared by GET and POST. */
  async function open(req: NextRequest, id: string) {
    if (!ctx.state) return { error: json({ error: 'this host keeps no answers' }, 501) }
    const a = ARTIFACT_ID_RE.test(id) ? await ctx.store.get(id) : null
    if (!a) return { error: json({ error: `no artifact with id ${id}` }, 404) }
    if (!a.state) return { error: json({ error: 'this page takes no answers' }, 404) }
    if (a.password && !isUnlocked({ id, password: a.password, cookie: req.cookies.get(unlockCookieName(id))?.value }))
      return { error: json({ error: 'this page is locked' }, 403) }
    const reader = verifyGrant(ctx.readerSecret(), req.cookies.get(GRANT_COOKIE)?.value)
    const signIn = ctx.signInOrigin ? signInUrl(ctx.signInOrigin, ctx.pageUrl(id)) : null
    if (a.access) {
      if (!ctx.readers) return { error: json({ error: 'this page is closed' }, 403) }
      if (!reader) return { error: json({ error: 'sign in to answer', signIn }, 401) }
      if (!decide(a.access, reader, await ctx.readers.allowList(id)).open) return { error: json({ error: 'this page is not open to you' }, 403) }
      // The page shows its body only after the agreement, so its answers wait for it too.
      if (!(await ctx.readers.acknowledged(id, reader.email))) return { error: json({ error: 'accept the agreement first' }, 403) }
    }
    const rawAnon = req.cookies.get(ANON_COOKIE)?.value
    const anonId = rawAnon && ANON_ID.test(rawAnon) ? rawAnon : null
    return { a, reader, anonId, signIn }
  }

  const writerFor = (r: Reader): Writer => ({ key: readerKeyFor.signedIn(r.uid), uid: r.uid, email: r.email, name: r.name, anonymous: false })

  async function viewBody(a: ArtifactRecord, reader: Reader | null, readerKey: string | null) {
    const allow = reader && ctx.readers && a.access ? await ctx.readers.allowList(a.id) : []
    return {
      reader: reader ? { firstName: firstName(reader, allow) } : null,
      canWrite: !!reader || effectiveWriters(a.state!, a.access) === 'anyone',
      slots: stateView(a.state!, await ctx.state!.entries(a.id), readerKey),
    }
  }

  // A GET that writes, on purpose: when a signed-in reader still carries an anonymous cookie, the
  // answers move here, because this is the first request that sees both. It is safe as a GET:
  // moveReader is idempotent (a second run finds nothing under the cleared key), and the grant
  // cookie is SameSite=Lax, so a cross-site page can trigger it only by top-level navigation,
  // which moves the reader's own answers onto the reader's own account and nothing else.
  async function STATE_GET(req: NextRequest, { params }: Params) {
    const { id } = await params
    const o = await open(req, id)
    if ('error' in o) return o.error
    const { a, reader, anonId, signIn } = o
    let clearAnon = false
    if (reader && anonId) {
      await ctx.state!.moveReader(readerKeyFor.anonymous(anonId), writerFor(reader))
      clearAnon = true
    }
    const key = reader ? readerKeyFor.signedIn(reader.uid) : anonId ? readerKeyFor.anonymous(anonId) : null
    const res = json({ ...(await viewBody(a, reader, key)), ...(reader ? {} : { signIn }) })
    if (clearAnon) res.headers.append('set-cookie', anonCookie('', 0))
    return res
  }

  async function STATE_POST(req: NextRequest, { params }: Params) {
    const { id } = await params
    // A cross-site form or fetch carries the reader's cookies (anonymous or Lax grant on a
    // top-level POST); a browser always names its Origin on a POST, so a foreign one is refused.
    const origin = req.headers.get('origin')
    if (origin !== null && origin !== siteOrigin) return json({ error: 'wrong origin' }, 403)
    // Refuse on the declared length before reading a byte: a client naming an oversize body
    // does not get the server to buffer it first.
    const declaredLength = Number(req.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY) return json({ error: 'request over 16 KB' }, 413)
    const raw = await req.text()
    // Measured in bytes, not JS string length: a string of multi-byte characters can sit under
    // the code-unit count and over the byte cap the limit is actually about.
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return json({ error: 'request over 16 KB' }, 413)
    let b: { slot?: unknown; op?: unknown; value?: unknown; entry?: unknown }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'body must be JSON' }, 400)
      b = parsed as typeof b
    } catch {
      return json({ error: 'body must be JSON' }, 400)
    }
    const o = await open(req, id)
    if ('error' in o) return o.error
    const { a, reader, signIn } = o
    let { anonId } = o
    const slot = typeof b.slot === 'string' ? b.slot : ''
    // Object.hasOwn, never a bracket read: `slots['__proto__']` or `slots['constructor']`
    // resolves through the prototype chain to a real (truthy) object that names no slot.
    const def = Object.hasOwn(a.state!.slots, slot) ? a.state!.slots[slot] : undefined
    if (!def) return json({ error: `no slot named ${slot} on this page` }, 400)
    const op = b.op
    if (op !== 'set' && op !== 'append' && op !== 'remove') return json({ error: 'op must be set, append or remove' }, 400)
    if (op === 'set' && def.shape !== 'one') return json({ error: `slot ${slot} takes append` }, 400)
    if (op === 'append' && def.shape !== 'many') return json({ error: `slot ${slot} takes set` }, 400)
    let setCookie: string | null = null
    let writer: Writer
    if (reader) writer = writerFor(reader)
    else {
      if (effectiveWriters(a.state!, a.access) !== 'anyone') return json({ error: 'sign in to answer', signIn }, 401)
      // A remove adds nothing, so it is never counted and never mints a cookie: with no cookie
      // there is nothing of theirs to remove, and the answer is simply the page as it stands.
      if (op === 'remove') {
        if (!anonId) return json(await viewBody(a, null, null))
        const key = readerKeyFor.anonymous(anonId)
        await ctx.state!.remove({ artifactId: id, slot, readerKey: key, entryId: typeof b.entry === 'string' ? b.entry : undefined })
        return json(await viewBody(a, null, key))
      }
      const n = await ctx.state!.countAnonWrite(id, ipHash(req), Math.floor(Date.now() / 60000))
      if (n > ANON_WRITES_PER_MINUTE) return json({ error: 'too many answers from here; try again in a minute' }, 429)
      if (!anonId) { anonId = newAnonId(); setCookie = anonCookie(anonId, 31536000) }
      writer = { key: readerKeyFor.anonymous(anonId), name: null, anonymous: true }
    }
    if (op === 'remove') {
      await ctx.state!.remove({ artifactId: id, slot, readerKey: writer.key, entryId: typeof b.entry === 'string' ? b.entry : undefined })
    } else {
      const bad = checkValue(b.value) ?? (slot === NOTES_SLOT && hasNotesWidget(a.markdown) ? checkNoteValue(b.value) : null)
      if (bad) return json({ error: bad }, 400)
      // The page-wide cap per slot. Counted before the write and not atomically with it, so a
      // burst can overshoot by the writes in flight; it bounds the slot, it is not a quota.
      if ((await ctx.state!.countSlot(id, slot)) >= MAX_ENTRIES_PER_SLOT) {
        const replacing = op === 'set' && (ctx.state!.hasOne
          ? await ctx.state!.hasOne(id, slot, writer.key)
          : (await ctx.state!.entries(id)).some((e) => e.slot === slot && e.readerKey === writer.key))
        if (!replacing) return json({ error: 'this page is not taking more answers here' }, 409)
      }
      const r = op === 'set'
        ? await ctx.state!.set({ artifactId: id, slot, writer, value: b.value })
        : await ctx.state!.append({ artifactId: id, slot, writer, value: b.value })
      if ('full' in r) return json({ error: 'you have left the most answers this page takes here' }, 409)
    }
    const res = json(await viewBody(a, reader, writer.key))
    if (setCookie) res.headers.append('set-cookie', setCookie)
    return res
  }

  async function RESPONSES(req: NextRequest, { params }: Params) {
    if (!isPublishAuthed(req, ctx.publishKey())) return json({ error: 'Unauthorized' }, 401)
    if (!ctx.state) return json({ error: 'this host keeps no answers' }, 501)
    const { id } = await params
    const a = ARTIFACT_ID_RE.test(id) ? await ctx.store.get(id) : null
    if (!a) return json({ error: `no artifact with id ${id}` }, 404)
    if (req.method === 'DELETE') {
      const key = req.nextUrl.searchParams.get('reader') ?? ''
      if (!/^[ua]:[A-Za-z0-9_-]{1,128}$/.test(key)) return json({ error: 'reader must be a reader key like u:<uid> or a:<id>' }, 400)
      return json({ removed: await ctx.state.removeReader(id, key) })
    }
    const rows = responsesOf(await ctx.state.entries(id))
    if (req.nextUrl.searchParams.get('format') === 'csv')
      return new NextResponse(responsesCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } })
    return json({ id, title: a.title, responses: rows })
  }

  return { STATE_GET, STATE_POST, RESPONSES }
}
