// Resolving a comment thread (0.33.0): POST /api/artifacts/<id>/resolve. Who may (the owner, an
// admin, the publish key or a publisher pass; nobody else), what it records on the thread's top
// comment, reopening, what readers are then shown, and the comments feed's `resolved` field and
// `open=1` filter.
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import { createMemoryStateStore, type StateStore, type Writer } from '../artifacts/state-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { mintPublisherPass } from '../artifacts/publisher.js'
import { MAX_RESOLVE_NOTE_CHARS, mergeCommentsState, type CommentsVisible } from '../artifacts/comments.js'

const SECRET = 'sekrit'
const PUB_SECRET = 'publisher-sekrit'
const HOST = 'artifacts.example.com'
const t = '2026-09-28T00:00:00Z'
const page = (id: string, visible: CommentsVisible): ArtifactRecord => {
  const merged = mergeCommentsState(undefined, 'anyone', visible)
  if (!merged.ok) throw new Error(merged.error)
  return { id, title: `Page ${id}`, summary: 'S', template: 'document', markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 2, views: 0, comments: 'anyone', commentsVisible: visible, state: merged.state }
}
const RECORDS: Record<string, ArtifactRecord> = { rsv23456: page('rsv23456', 'readers'), rsw23456: page('rsw23456', 'owner') }

const owner: Reader = { uid: 'u0', email: 'owner@example.com', name: 'Olive Owner', member: true }
const admin: Reader = { uid: 'u9', email: 'admin@example.com', name: 'Ada Admin', member: true }
const sam: Reader = { uid: 'u3', email: 'sam@example.com', name: 'Sam Reader', member: true }
const samWriter: Writer = { key: 'u:u3', uid: 'u3', email: 'sam@example.com', name: 'Sam Reader', anonymous: false }
const anonWriter: Writer = { key: 'a:abcdefghijklmnopqrstuvwx', name: null, anonymous: true }
const grant = (r: Reader) => `${GRANT_COOKIE}=${mintGrant(SECRET, r)}`
const textAnchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs' }

afterEach(() => { vi.useRealTimers() })

async function build(opts: { state?: StateStore | null } = {}) {
  const state = opts.state === undefined ? createMemoryStateStore() : opts.state
  const ids: Record<string, string> = {}
  if (state) {
    vi.useFakeTimers()
    const add = async (iso: string, artifactId: string, writer: Writer, value: unknown) => {
      vi.setSystemTime(new Date(iso))
      const r = await state.append({ artifactId, slot: 'comments', writer, value })
      if ('full' in r) throw new Error('full')
      return r.id
    }
    ids.root = await add('2026-09-28T10:00:00.000Z', 'rsv23456', samWriter, { anchor: textAnchor, body: 'Which river?', version: 2 })
    ids.reply = await add('2026-09-28T10:30:00.000Z', 'rsv23456', anonWriter, { anchor: textAnchor, body: 'The north one.', version: 2, parent: ids.root })
    ids.other = await add('2026-09-28T11:00:00.000Z', 'rsv23456', anonWriter, { anchor: textAnchor, body: 'Still open', version: 2 })
    ids.hidden = await add('2026-09-28T11:30:00.000Z', 'rsw23456', samWriter, { anchor: textAnchor, body: 'Owner-only page', version: 2 })
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'))
  }
  const store = { get: vi.fn(async (id: string) => RECORDS[id] ?? null) } as unknown as ArtifactStore
  const routes = createArtifactRoutes({
    store, state: state ?? undefined, brand: freedomDefault, siteUrl: `https://${HOST}`, publishKey: () => 'k',
    readerSecret: () => SECRET, ownerEmail: 'Owner@Example.com', admins: ['Admin@Example.com'],
    publisherSecret: () => PUB_SECRET, publisherHost: HOST,
  })
  return { routes, ids, state }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const resolveReq = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://${HOST}/api/artifacts/${id}/resolve`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })
const asCookie = (r: Reader) => ({ cookie: grant(r), origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' })
const KEY = { authorization: 'Bearer k' }
const stateOf = (routes: Awaited<ReturnType<typeof build>>['routes'], id: string, cookie?: string) =>
  routes.STATE_GET(new NextRequest(`https://${HOST}/api/artifacts/${id}/state`, { headers: cookie ? { cookie } : {} }), params(id))
const feed = (q: string) => new NextRequest(`https://${HOST}/api/comments?since=2026-09-28T00:00:00Z${q}`, { headers: KEY })
type Shared = { id: string; value: { body: string; resolved?: { at: string; by: string; note?: string } } }

describe('RESOLVE: who may resolve', () => {
  it('refuses an anonymous reader with 401 and a signed-in reader who is not owner or admin with 403', async () => {
    const { routes, ids, state } = await build()
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }), params('rsv23456'))).status).toBe(401)
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, asCookie(sam)), params('rsv23456'))).status).toBe(403)
    // The comment's own writer is not the owner: leaving a comment is not resolving it.
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, { ...asCookie(sam), authorization: 'Bearer nope' }), params('rsv23456'))).status).toBe(403)
    expect((await state!.entries('rsv23456')).every((e) => !(e.value as { resolved?: unknown }).resolved)).toBe(true)
  })

  it('refuses before looking the page up, so a refusal says nothing about it', async () => {
    const { routes } = await build()
    expect((await routes.RESOLVE(resolveReq('zzz23456', { entry: 'x' }), params('zzz23456'))).status).toBe(401)
    expect((await routes.RESOLVE(resolveReq('zzz23456', { entry: 'x' }, asCookie(sam)), params('zzz23456'))).status).toBe(403)
  })

  it('the owner resolves, named by first name, and the note is recorded on the thread\'s top comment', async () => {
    const { routes, ids, state } = await build()
    const res = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'Named the river in the second paragraph.' }, asCookie(owner)), params('rsv23456'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'rsv23456', entry: ids.root, resolved: { at: '2026-09-28T12:00:00.000Z', by: 'Olive', note: 'Named the river in the second paragraph.' } })
    const root = (await state!.entries('rsv23456')).find((e) => e.id === ids.root)!
    expect(root.value).toMatchObject({ body: 'Which river?', resolved: body.resolved })
    // The writer and time of the comment are untouched.
    expect(root.writer.name).toBe('Sam Reader')
    expect(root.at).toBe('2026-09-28T10:00:00.000Z')
  })

  it('an admin resolves too', async () => {
    const { routes, ids } = await build()
    const res = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.other }, asCookie(admin)), params('rsv23456'))
    expect(res.status).toBe(200)
    expect((await res.json()).resolved).toEqual({ at: '2026-09-28T12:00:00.000Z', by: 'Ada' })
  })

  it('the publish key and a publisher pass resolve, and may say who they are with by', async () => {
    const { routes, ids } = await build()
    const k = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, by: 'Pat agent' }, KEY), params('rsv23456'))
    expect(k.status).toBe(200)
    expect((await k.json()).resolved.by).toBe('Pat agent')
    const pass = mintPublisherPass(PUB_SECRET, { uid: 'u0', email: 'owner@example.com', name: 'Olive Owner', host: HOST }, Math.floor(Date.now() / 1000) + 3600)
    const p = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.other }, { authorization: `Bearer ${pass}` }), params('rsv23456'))
    expect(p.status).toBe(200)
    expect((await p.json()).resolved.by).toBe('the publisher')
    // Without a cookie there is no origin to check: an agent's curl names none.
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, { ...KEY, origin: 'https://elsewhere.example.net' }), params('rsv23456'))).status).toBe(200)
  })

  it('a signed-in owner must come from this host, as JSON', async () => {
    const { routes, ids } = await build()
    const foreign = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, { ...asCookie(owner), origin: 'https://evil.example.net' }), params('rsv23456'))
    expect(foreign.status).toBe(403)
    const crossSite = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, { ...asCookie(owner), 'sec-fetch-site': 'cross-site' }), params('rsv23456'))
    expect(crossSite.status).toBe(403)
    const form = await routes.RESOLVE(resolveReq('rsv23456', `entry=${ids.root}`, { ...asCookie(owner), 'content-type': 'application/x-www-form-urlencoded' }), params('rsv23456'))
    expect(form.status).toBe(415)
  })

  it('by from a signed-in owner is ignored: they are named by their account', async () => {
    const { routes, ids } = await build()
    const res = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, by: 'Someone Else' }, asCookie(owner)), params('rsv23456'))
    expect((await res.json()).resolved.by).toBe('Olive')
  })
})

describe('RESOLVE: what it takes', () => {
  it('a note is one line of at most 280 characters; blank means none', async () => {
    const { routes, ids } = await build()
    const ok = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'x'.repeat(MAX_RESOLVE_NOTE_CHARS) }, KEY), params('rsv23456'))
    expect(ok.status).toBe(200)
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'x'.repeat(MAX_RESOLVE_NOTE_CHARS + 1) }, KEY), params('rsv23456'))).status).toBe(400)
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'two\nlines' }, KEY), params('rsv23456'))).status).toBe(400)
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 42 }, KEY), params('rsv23456'))).status).toBe(400)
    const blank = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: '   ' }, KEY), params('rsv23456'))
    expect((await blank.json()).resolved).not.toHaveProperty('note')
  })

  it('refuses a malformed body, an unknown field, and a missing or foreign entry', async () => {
    const { routes, ids } = await build()
    const call = (id: string, body: unknown) => routes.RESOLVE(resolveReq(id, body, KEY), params(id))
    expect((await call('rsv23456', 'not json')).status).toBe(400)
    expect((await call('rsv23456', [])).status).toBe(400)
    expect((await call('rsv23456', {})).status).toBe(400)
    expect((await call('rsv23456', { entry: ids.root, colour: 'red' })).status).toBe(400)
    expect((await call('rsv23456', { entry: ids.root, resolved: 'yes' })).status).toBe(400)
    expect((await call('rsv23456', { entry: 'no-such-comment' })).status).toBe(404)
    // A comment on another page is not on this one.
    expect((await call('rsv23456', { entry: ids.hidden })).status).toBe(404)
    expect((await call('zzz23456', { entry: ids.root })).status).toBe(404)
  })

  it('naming a reply resolves the thread it belongs to', async () => {
    const { routes, ids, state } = await build()
    const res = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.reply, note: 'Answered' }, KEY), params('rsv23456'))
    expect(res.status).toBe(200)
    expect((await res.json()).entry).toBe(ids.root)
    const all = await state!.entries('rsv23456')
    expect((all.find((e) => e.id === ids.root)!.value as { resolved?: unknown }).resolved).toMatchObject({ note: 'Answered' })
    expect((all.find((e) => e.id === ids.reply)!.value as { resolved?: unknown }).resolved).toBeUndefined()
  })

  it('unresolve: resolved false clears it, takes no note, and the same people may do it', async () => {
    const { routes, ids, state } = await build()
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'Done' }, KEY), params('rsv23456'))
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, resolved: false }, asCookie(sam)), params('rsv23456'))).status).toBe(403)
    expect((await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, resolved: false, note: 'why' }, KEY), params('rsv23456'))).status).toBe(400)
    const res = await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, resolved: false }, asCookie(admin)), params('rsv23456'))
    expect(res.status).toBe(200)
    expect((await res.json()).resolved).toBeNull()
    expect((await state!.entries('rsv23456')).find((e) => e.id === ids.root)!.value).not.toHaveProperty('resolved')
  })

  it('501 on a host that keeps no answers, or whose store cannot resolve', async () => {
    const none = await build({ state: null })
    expect((await none.routes.RESOLVE(resolveReq('rsv23456', { entry: 'abc' }, KEY), params('rsv23456'))).status).toBe(501)
    const { setResolved: _drop, ...older } = createMemoryStateStore()
    const old = await build({ state: older as StateStore })
    expect((await old.routes.RESOLVE(resolveReq('rsv23456', { entry: old.ids.root }, KEY), params('rsv23456'))).status).toBe(501)
  })
})

describe('a resolved thread, as readers are shown it', () => {
  it('a reader sees the resolution on the thread, and the comment\'s writer sees the note', async () => {
    const { routes, ids, state } = await build()
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'Fixed' }, KEY), params('rsv23456'))
    const shared = (await (await stateOf(routes, 'rsv23456')).json()).slots.comments.shared as Shared[]
    expect(shared.find((s) => s.id === ids.root)!.value.resolved).toMatchObject({ by: 'the publisher', note: 'Fixed' })
    // On an owner-only page the writer still sees their own comment's resolution.
    await routes.RESOLVE(resolveReq('rsw23456', { entry: ids.hidden, note: 'Seen to' }, KEY), params('rsw23456'))
    const got = await (await stateOf(routes, 'rsw23456', grant(sam))).json()
    const mine = got.slots.comments.mine as Shared[]
    expect(mine[0].value.resolved).toMatchObject({ note: 'Seen to' })
    expect(JSON.stringify(await state!.entries('rsw23456'))).not.toContain('owner@example.com')
  })

  it('a reader cannot resolve by writing resolved into a comment, and an edit keeps the resolution', async () => {
    const { routes, ids } = await build()
    const post = (body: unknown) => routes.STATE_POST(new NextRequest(`https://${HOST}/api/artifacts/rsv23456/state`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie: grant(sam), 'x-forwarded-for': '198.51.100.7' },
    }), params('rsv23456'))
    const forged = await post({ slot: 'comments', op: 'append', value: { anchor: textAnchor, body: 'Done!', version: 2, resolved: { at: t, by: 'Olive' } } })
    expect(forged.status).toBe(400)
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'Fixed' }, KEY), params('rsv23456'))
    const edited = await post({ slot: 'comments', op: 'replace', entry: ids.root, value: { anchor: textAnchor, body: 'Which river, exactly?', version: 2 } })
    expect(edited.status).toBe(200)
    const root = ((await edited.json()).slots.comments.shared as Shared[]).find((s) => s.id === ids.root)!
    expect(root.value).toMatchObject({ body: 'Which river, exactly?', resolved: { note: 'Fixed' } })
  })
})

describe('COMMENTS_FEED with resolved threads', () => {
  it('every row carries its thread\'s resolution, null when open', async () => {
    const { routes, ids } = await build()
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, note: 'Fixed' }, KEY), params('rsv23456'))
    const body = await (await routes.COMMENTS_FEED(feed(''))).json()
    const by = (id: string) => body.comments.find((c: { entryId: string }) => c.entryId === id)
    expect(by(ids.root).resolved).toEqual({ at: '2026-09-28T12:00:00.000Z', by: 'the publisher', note: 'Fixed' })
    // A reply carries the thread's resolution, which lives on its parent.
    expect(by(ids.reply).resolved).toEqual(by(ids.root).resolved)
    expect(by(ids.other).resolved).toBeNull()
    expect(body.cursor).toBe('2026-09-28T11:30:00.000Z')
    expect(body.more).toBe(false)
  })

  it('open=1 leaves out resolved threads but keeps a reply written after the resolution', async () => {
    const { routes, ids, state } = await build()
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, KEY), params('rsv23456'))
    let body = await (await routes.COMMENTS_FEED(feed('&open=1'))).json()
    expect(body.comments.map((c: { entryId: string }) => c.entryId).sort()).toEqual([ids.hidden, ids.other].sort())
    // The cursor still moves past what was read, so a caller paging with open=1 does not loop.
    expect(body.cursor).toBe('2026-09-28T11:30:00.000Z')
    vi.setSystemTime(new Date('2026-09-28T13:00:00.000Z'))
    const late = await state!.append({ artifactId: 'rsv23456', slot: 'comments', writer: samWriter, value: { anchor: textAnchor, body: 'Not fixed for me', version: 2, parent: ids.root } })
    body = await (await routes.COMMENTS_FEED(feed('&open=1'))).json()
    expect(body.comments.map((c: { entryId: string }) => c.entryId)).toContain(('id' in late) ? late.id : '')
    expect(body.comments.find((c: { body: string }) => c.body === 'Not fixed for me').resolved).not.toBeNull()
    // Reopened, the whole thread is back.
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root, resolved: false }, KEY), params('rsv23456'))
    body = await (await routes.COMMENTS_FEED(feed('&open=1'))).json()
    expect(body.comments.map((c: { entryId: string }) => c.entryId)).toEqual(expect.arrayContaining([ids.root, ids.reply]))
  })

  it('open=0 is everything, and any other value is a 400', async () => {
    const { routes, ids } = await build()
    await routes.RESOLVE(resolveReq('rsv23456', { entry: ids.root }, KEY), params('rsv23456'))
    expect((await (await routes.COMMENTS_FEED(feed('&open=0'))).json()).comments).toHaveLength(4)
    expect((await routes.COMMENTS_FEED(feed('&open=yes'))).status).toBe(400)
  })
})
