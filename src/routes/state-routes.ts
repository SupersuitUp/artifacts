// The state routes: what readers put into a page, and what the publisher gets back.
//
//   GET  /api/artifacts/<id>/state      the reader's own answers + what the page lets them see
//   POST /api/artifacts/<id>/state      { slot, op: set|append|remove|replace, value?, entry? }
//   GET  /api/artifacts/<id>/responses  publish key; every answer with who (?format=csv)
//   DELETE /api/artifacts/<id>/responses?reader=<key>  publish key; one reader's answers
//   GET  /api/comments?since=<ISO>      publish key; every shared comment on any page after a time
//
// Who is writing: the grant a gated page already uses, or on a page with `writers: anyone`, an
// anonymous id in an HttpOnly cookie. When both are present the anonymous answers move to the
// signed-in reader, once, and the cookie is cleared.
import { createHmac, randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isPublisherAuthed } from '../artifacts/auth.js'
import { ARTIFACT_ID_RE } from './ids.js'
import { GRANT_COOKIE, decide, firstName, signInUrl, verifyGrant, type Reader } from '../artifacts/reader.js'
import { isUnlocked, unlockCookieName } from '../artifacts/unlock.js'
import { ANON_WRITES_PER_MINUTE, MAX_ENTRIES_PER_SLOT, checkValue, effectiveWriters, slotVisibility } from '../artifacts/state.js'
import { COMMENTS_SLOT, validateComment, type CommentValue } from '../artifacts/comments.js'
import { isCommentAudioPath } from '../artifacts/audio.js'
import { readerKeyFor, type StateStore, type Writer } from '../artifacts/state-store.js'
import { NOTES_SLOT, checkNoteValue, checklistAnswerIds, hasNotesWidget } from '../artifacts/widgets.js'
import { CHECKLIST_SLOT, checkChecklistValue } from '../artifacts/checklist.js'
import { responsesCsv, responsesOf, stateView } from '../artifacts/state-view.js'
import type { ArtifactRecord, ArtifactStore } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'

export const ANON_COOKIE = 'artifact_anon'
const ANON_ID = /^[A-Za-z0-9]{24}$/
const MAX_BODY = 16 * 1024
/** The most comments one feed answer carries. A caller that gets this many moves its cursor to the
 *  last row's `at` and asks again. */
export const FEED_MAX = 200
// An ISO 8601 time with a zone: 2026-09-28T12:00Z, 2026-09-28T12:00:00.123+02:00. A date alone, or
// a time with no zone, is refused rather than read in the server's own zone.
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/
/** `since` as the stored `at` form (UTC, milliseconds), or null. A `+` offset left unencoded in a
 *  query string arrives as a space, so that one spelling is read back as the `+` it was. */
export function feedSince(raw: string | null): string | null {
  const v = (raw ?? '').trim().replace(/ (\d{2}:?\d{2})$/, '+$1')
  if (!ISO_TIME.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

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
  /** Publisher passes, as in ArtifactRoutesConfig. Both absent means passes are refused. */
  publisherSecret?: () => string | undefined
  publisherHost?: string
  pageUrl: (id: string) => string
  signInOrigin?: string
  siteUrl: string
  /** The address the rate limit counts by. Default reads the first hop of `x-forwarded-for`,
   *  which is correct on Vercel (it overwrites XFF with the real client IP) and wrong behind any
   *  other proxy that appends rather than replaces; a host behind one of those passes its own. */
  clientIp?: (req: NextRequest) => string
  /** The page owner's sign-in email. Signed in as them, a page's comments show every entry with
   *  full names, whatever `comments_visible:` says. */
  ownerEmail?: string
  /** A signed URL to play a comment's recording. Called only for `comments/` paths, and only for
   *  comments the asker is already being shown. Without it a recording has no play control. */
  audioUrl?: (id: string, path: string) => Promise<string>
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

  const ownerEmail = ctx.ownerEmail?.trim().toLowerCase()
  const isOwner = (r: Reader | null) => !!r && !!ownerEmail && r.email === ownerEmail
  /** Comments are on for this page: the slot exists because `comments:` put it there. */
  const commentsOn = (a: ArtifactRecord) => !!a.comments && a.comments !== 'off' && Object.hasOwn(a.state!.slots, COMMENTS_SLOT)

  const writerFor = (r: Reader): Writer => ({ key: readerKeyFor.signedIn(r.uid), uid: r.uid, email: r.email, name: r.name, anonymous: false })

  /** Beside each comment row with a recording, a signed URL to play it. Only ever a `comments/`
   *  path: a personal recording can never be named by a comment, and is never signed here. */
  async function withAudioUrls<T extends { value: unknown }>(id: string, rows: T[]): Promise<T[]> {
    if (!ctx.audioUrl) return rows
    for (const r of rows) {
      const audio = (r.value as { audio?: unknown } | null)?.audio
      if (isCommentAudioPath(audio)) (r as T & { audioUrl?: string }).audioUrl = await ctx.audioUrl(id, audio)
    }
    return rows
  }

  async function viewBody(a: ArtifactRecord, reader: Reader | null, readerKey: string | null) {
    const allow = reader && ctx.readers && a.access ? await ctx.readers.allowList(a.id) : []
    const entries = await ctx.state!.entries(a.id)
    const slots = stateView(a.state!, entries, readerKey)
    const owner = isOwner(reader)
    // The owner reads every comment with its writer's full name, whatever the page shows readers.
    if (owner && commentsOn(a)) {
      slots[COMMENTS_SLOT].shared = entries.filter((e) => e.slot === COMMENTS_SLOT)
        .sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id))
        .map((e) => ({ id: e.id, name: e.writer.name?.trim() || 'a reader', value: e.value, at: e.at, mine: e.readerKey === readerKey }))
    }
    if (commentsOn(a) && slots[COMMENTS_SLOT]) {
      const v = slots[COMMENTS_SLOT]
      await withAudioUrls(a.id, Array.isArray(v.mine) ? (v.mine as { value: unknown }[]) : [])
      await withAudioUrls(a.id, v.shared ?? [])
    }
    return {
      reader: reader ? { firstName: firstName(reader, allow) } : null,
      canWrite: !!reader || effectiveWriters(a.state!, a.access) === 'anyone',
      ...(owner ? { owner: true } : {}),
      slots,
    }
  }

  /** The comments a writer can see, by id: every one on a readers-visible page, else their own,
   *  and every one for the owner. A reply may name only a comment its writer was shown. */
  async function visibleComments(a: ArtifactRecord, writerKey: string, reader: Reader | null) {
    const all = slotVisibility(a.state!, COMMENTS_SLOT) === 'shared' || isOwner(reader)
    const byId = new Map<string, CommentValue>()
    for (const e of await ctx.state!.entries(a.id))
      if (e.slot === COMMENTS_SLOT && (all || e.readerKey === writerKey)) byId.set(e.id, e.value as CommentValue)
    return byId
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
    if (op !== 'set' && op !== 'append' && op !== 'remove' && op !== 'replace') return json({ error: 'op must be set, append, remove or replace' }, 400)
    if (op === 'set' && def.shape !== 'one') return json({ error: `slot ${slot} takes append` }, 400)
    if ((op === 'append' || op === 'replace') && def.shape !== 'many') return json({ error: `slot ${slot} takes set` }, 400)
    const entryId = typeof b.entry === 'string' ? b.entry : undefined
    if (op === 'replace' && !entryId) return json({ error: 'replace names the entry it edits' }, 400)
    if (op === 'replace' && !ctx.state!.replace) return json({ error: 'this host cannot edit an answer' }, 501)
    const isComments = slot === COMMENTS_SLOT && commentsOn(a)
    let setCookie: string | null = null
    let writer: Writer
    if (reader) writer = writerFor(reader)
    else {
      if (effectiveWriters(a.state!, a.access, slot) !== 'anyone') return json({ error: 'sign in to answer', signIn }, 401)
      // A remove adds nothing, so it is never counted and never mints a cookie: with no cookie
      // there is nothing of theirs to remove, and the answer is simply the page as it stands.
      // Comments say so instead: deleting a comment that is not yours is a refusal, not a no-op.
      if (op === 'remove') {
        if (!anonId) return isComments && entryId ? json({ error: 'no comment of yours with that id' }, 404) : json(await viewBody(a, null, null))
        const key = readerKeyFor.anonymous(anonId)
        const n = await ctx.state!.remove({ artifactId: id, slot, readerKey: key, entryId })
        if (isComments && entryId && !n) return json({ error: 'no comment of yours with that id' }, 404)
        return json(await viewBody(a, null, key))
      }
      // An edit with no cookie has nothing of theirs to edit.
      if (op === 'replace' && !anonId) return json({ error: 'no answer of yours with that id' }, 404)
      const n = await ctx.state!.countAnonWrite(id, ipHash(req), Math.floor(Date.now() / 60000))
      if (n > ANON_WRITES_PER_MINUTE) return json({ error: 'too many answers from here; try again in a minute' }, 429)
      if (!anonId) { anonId = newAnonId(); setCookie = anonCookie(anonId, 31536000) }
      writer = { key: readerKeyFor.anonymous(anonId), name: null, anonymous: true }
    }
    if (op === 'remove') {
      const n = await ctx.state!.remove({ artifactId: id, slot, readerKey: writer.key, entryId })
      if (isComments && entryId && !n) return json({ error: 'no comment of yours with that id' }, 404)
    } else {
      const sendIds = slot === CHECKLIST_SLOT ? checklistAnswerIds(a.markdown) : null
      const bad = checkValue(b.value)
        ?? (slot === NOTES_SLOT && hasNotesWidget(a.markdown) ? checkNoteValue(b.value) : null)
        ?? (sendIds ? checkChecklistValue(b.value, sendIds) : null)
      if (bad) return json({ error: bad }, 400)
      let value: unknown = b.value
      if (isComments) {
        const seen = await visibleComments(a, writer.key, reader)
        const c = validateComment(b.value, (cid) => seen.get(cid) ?? null)
        if (!c.ok) return json({ error: c.error }, 400)
        // A shared comment's recording is one uploaded as a comment, never a path elsewhere under the
        // page: naming a personal recording here would get it signed for the publisher.
        if (c.value.audio !== undefined && !isCommentAudioPath(c.value.audio)) return json({ error: 'a comment\'s audio is the path its upload returned' }, 400)
        // An edit keeps the comment where it is in its thread: a reply stays a reply to the same one.
        if (op === 'replace' && seen.has(entryId!) && (seen.get(entryId!)!.parent ?? null) !== (c.value.parent ?? null))
          return json({ error: 'an edit cannot move a comment into or out of a thread' }, 400)
        value = c.value
      }
      if (op === 'replace') {
        const r = await ctx.state!.replace!({ artifactId: id, slot, readerKey: writer.key, entryId: entryId!, value })
        if (!r) return json({ error: 'no answer of yours with that id' }, 404)
        const res = json(await viewBody(a, reader, writer.key))
        if (setCookie) res.headers.append('set-cookie', setCookie)
        return res
      }
      // The page-wide cap per slot. Counted before the write and not atomically with it, so a
      // burst can overshoot by the writes in flight; it bounds the slot, it is not a quota.
      if ((await ctx.state!.countSlot(id, slot)) >= MAX_ENTRIES_PER_SLOT) {
        const replacing = op === 'set' && (ctx.state!.hasOne
          ? await ctx.state!.hasOne(id, slot, writer.key)
          : (await ctx.state!.entries(id)).some((e) => e.slot === slot && e.readerKey === writer.key))
        if (!replacing) return json({ error: 'this page is not taking more answers here' }, 409)
      }
      const r = op === 'set'
        ? await ctx.state!.set({ artifactId: id, slot, writer, value })
        : await ctx.state!.append({ artifactId: id, slot, writer, value })
      if ('full' in r) return json({ error: 'you have left the most answers this page takes here' }, 409)
    }
    const res = json(await viewBody(a, reader, writer.key))
    if (setCookie) res.headers.append('set-cookie', setCookie)
    return res
  }

  async function RESPONSES(req: NextRequest, { params }: Params) {
    if (!isPublisherAuthed(req, ctx)) return json({ error: 'Unauthorized' }, 401)
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
    // The publisher hears a shared comment's recording from here; the rows are signed in place.
    await withAudioUrls(id, rows.filter((r) => r.slot === COMMENTS_SLOT))
    return json({ id, title: a.title, responses: rows })
  }

  /** GET /api/comments?since=<ISO>: every SHARED comment on any of this host's pages written after
   *  `since` (exclusive), oldest first, at most FEED_MAX, each with a link that opens it on the
   *  page. It reads the `comments` slot of the state core only; personal notes live in a store no
   *  publisher route reads, so they cannot appear here. The publisher's own notifier polls it. */
  async function COMMENTS_FEED(req: NextRequest) {
    if (!isPublisherAuthed(req, ctx)) return json({ error: 'Unauthorized' }, 401)
    const since = feedSince(req.nextUrl.searchParams.get('since'))
    if (!since) return json({ error: 'since must be an ISO 8601 time with a zone, like 2026-09-28T12:00:00Z' }, 400)
    if (!ctx.state) return json({ error: 'this host keeps no answers' }, 501)
    if (!ctx.state.slotSince) return json({ error: 'this host cannot list comments by time' }, 501)
    const now = new Date().toISOString()
    const entries = await ctx.state.slotSince(COMMENTS_SLOT, since, FEED_MAX)
    const pages = new Map<string, Promise<ArtifactRecord | null>>()
    const pageOf = (id: string) => { if (!pages.has(id)) pages.set(id, ctx.store.get(id)); return pages.get(id)! }
    const comments = []
    for (const e of entries) {
      const a = await pageOf(e.artifactId)
      // A page deleted since the comment was left has nowhere for the link to land.
      if (!a) continue
      const v = e.value as CommentValue
      const audio = isCommentAudioPath(v.audio) && ctx.audioUrl ? await ctx.audioUrl(e.artifactId, v.audio) : null
      comments.push({
        artifactId: e.artifactId, title: a.title, entryId: e.id, parent: v.parent ?? null,
        name: e.writer.anonymous ? null : e.writer.name?.trim() || 'a signed-in reader',
        quote: v.anchor?.kind === 'text' ? v.anchor.quote : null, region: v.anchor?.kind === 'region',
        body: v.body, transcript: v.transcript ?? null, audioUrl: audio, at: e.at,
        link: `${ctx.pageUrl(e.artifactId)}#comment-${e.id}`,
      })
    }
    return json({ now, comments })
  }

  return { STATE_GET, STATE_POST, RESPONSES, COMMENTS_FEED }
}
