// 0.43.0: a comment's id per reader in /views, the comments feed for one page, and a limit on how
// fast one group link can mint new browsers. Every test builds its own routes and stores; none
// reads anything an earlier test left behind.
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { createRecipientsRoutes } from './recipients-routes.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { mergeCommentsState } from '../artifacts/comments.js'
import { ANON_WRITES_PER_MINUTE } from '../artifacts/state.js'

const RS = 'r'.repeat(40)
const t = '2026-10-01T00:00:00Z'
const anchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs north.' }
const page = (id: string, extra: Partial<ArtifactRecord> = {}): ArtifactRecord => {
  const merged = mergeCommentsState(undefined, 'anyone', 'owner')
  if (!merged.ok) throw new Error(merged.error)
  return { id, title: `Page ${id}`, summary: 'S', template: 'document', markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 2, views: 0, comments: 'anyone', commentsVisible: 'owner', state: merged.state, ...extra } as ArtifactRecord
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (id: string, body: unknown, cookie?: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
  })
const note = (text: string, extra: Record<string, unknown> = {}) => ({ slot: 'comments', op: 'append', value: { anchor, body: text, version: 2, ...extra } })
const authed = { authorization: 'Bearer k' }
const anonCookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]

function build(pages: ArtifactRecord[]) {
  const records = Object.fromEntries(pages.map((p) => [p.id, p]))
  const state = createMemoryStateStore()
  const recipients = memoryRecipientsStore()
  const store = { get: vi.fn(async (id: string) => records[id] ?? null) } as unknown as ArtifactStore
  const routes = createArtifactRoutes({
    store, state, recipients, recipientSecret: () => RS, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k', readerSecret: () => 's'.repeat(40),
  })
  const rr = createRecipientsRoutes({ store, recipients, recipientSecret: () => RS, state, publishKey: () => 'k', pageUrl: (id) => `https://artifacts.example.com/${id}`, authed: (r) => r.headers.get('authorization') === 'Bearer k' })
  const views = async (id: string) => (await (await rr.VIEWS(new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/views`, { headers: authed }), params(id))).json()) as { recipients: { rid: string; label: string; comments: { id: string; parent: string | null; at: string; text: string }[] }[] }
  const feed = async (query: string) => {
    const res = await routes.COMMENTS_FEED(new NextRequest(`https://artifacts.example.com/api/comments${query}`, { headers: authed }))
    return { status: res.status, body: (await res.json()) as { comments: { artifactId: string; entryId: string; body: string; at: string }[]; cursor: string | null; more: boolean; error?: string } }
  }
  const cookie = (id: string, r: { rid: string }) => `artifact_r_${id}=${r.rid}.${ridSig(RS, id, r.rid)}`
  return { routes, state, recipients, views, feed, cookie }
}
afterEach(() => { vi.useRealTimers() })

describe('/views: an id on each comment', () => {
  it('carries the entry id the feed calls entryId, and a reply carries its parent', async () => {
    const { routes, recipients, views, feed, cookie } = build([page('ndv23456', { links: 'per-reader' })])
    const [ada] = await recipients.add('ndv23456', [{ label: 'Reader A' }])
    const top = await routes.STATE_POST(post('ndv23456', note('First.'), cookie('ndv23456', ada)), params('ndv23456'))
    expect(top.status).toBe(200)
    const topId = ((await top.json()) as { slots: { comments: { mine: { id: string }[] } } }).slots.comments.mine[0].id
    expect((await routes.STATE_POST(post('ndv23456', note('Second.', { parent: topId }), cookie('ndv23456', ada)), params('ndv23456'))).status).toBe(200)
    const [row] = (await views('ndv23456')).recipients
    expect(row.comments).toHaveLength(2)
    expect(row.comments.map((c) => [c.text, c.parent])).toEqual([['First.', null], ['Second.', topId]])
    expect(row.comments[0].id).toBe(topId)
    const f = await feed('?since=2020-01-01T00:00:00Z')
    expect(row.comments.map((c) => c.id).sort()).toEqual(f.body.comments.map((c) => c.entryId).sort())
    expect(Object.keys(row.comments[0]).sort()).toEqual(['at', 'id', 'parent', 'text'])
  })
  it('two browsers on one group link under comment_name: required are both listed under the link, with distinct ids', async () => {
    const { routes, recipients, views, cookie } = build([page('ndg23456', { links: 'per-reader', commentName: 'required' })])
    const [link] = await recipients.add('ndg23456', [{ label: 'Anyone with the link', group: true }])
    const rid = cookie('ndg23456', link)
    for (const [who, text] of [['Kit', 'From Kit.'], ['Robin', 'From Robin.']]) {
      expect((await routes.STATE_POST(post('ndg23456', note(text, { by: who }), rid), params('ndg23456'))).status).toBe(200)
    }
    const rows = (await views('ndg23456')).recipients
    expect(rows).toHaveLength(1)
    expect(rows[0].rid).toBe(link.rid)
    expect(rows[0].comments.map((c) => c.text).sort()).toEqual(['From Kit.', 'From Robin.'])
    expect(new Set(rows[0].comments.map((c) => c.id)).size).toBe(2)
  })
  it('a publisher reply does not appear', async () => {
    const { routes, recipients, state, views, cookie } = build([page('ndp23456', { links: 'per-reader' })])
    const [ada] = await recipients.add('ndp23456', [{ label: 'Reader A' }])
    const top = await routes.STATE_POST(post('ndp23456', note('Question.'), cookie('ndp23456', ada)), params('ndp23456'))
    const topId = ((await top.json()) as { slots: { comments: { mine: { id: string }[] } } }).slots.comments.mine[0].id
    const reply = await routes.REPLY(new NextRequest('https://artifacts.example.com/api/artifacts/ndp23456/reply', {
      method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify({ entry: topId, body: 'Answer.' }),
    }), params('ndp23456'))
    expect(reply.status).toBe(200)
    expect((await state.entries('ndp23456')).filter((e) => e.slot === 'comments')).toHaveLength(2)
    const [row] = (await views('ndp23456')).recipients
    expect(row.comments.map((c) => c.text)).toEqual(['Question.'])
  })
})

describe('the comments feed for one page', () => {
  async function twoPages() {
    const b = build([page('fa234567'), page('fb234567')])
    vi.useFakeTimers()
    const put = async (iso: string, id: string, text: string, who: string, extra: Record<string, unknown> = {}) => {
      vi.setSystemTime(new Date(iso))
      const r = await b.state.append({ artifactId: id, slot: 'comments', writer: { key: `u:${who}`, uid: who, email: `${who}@example.com`, name: who, anonymous: false }, value: { anchor, body: text, version: 2, ...extra } })
      if ('full' in r) throw new Error('full')
      return r.id
    }
    const a1 = await put('2026-10-01T10:00:00.000Z', 'fa234567', 'a1', 'sam')
    await put('2026-10-01T10:01:00.000Z', 'fb234567', 'b1', 'sam')
    const a2 = await put('2026-10-01T10:02:00.000Z', 'fa234567', 'a2', 'jo')
    await put('2026-10-01T10:03:00.000Z', 'fb234567', 'b2', 'jo')
    const a3 = await put('2026-10-01T10:04:00.000Z', 'fa234567', 'a3', 'sam')
    vi.setSystemTime(new Date('2026-10-01T11:00:00.000Z'))
    return { ...b, a1, a2, a3 }
  }
  it('artifact= returns only that page\'s rows', async () => {
    const { feed } = await twoPages()
    const { status, body } = await feed('?since=2020-01-01T00:00:00Z&artifact=fa234567')
    expect(status).toBe(200)
    expect(body.comments.map((c) => c.body)).toEqual(['a1', 'a2', 'a3'])
    expect(new Set(body.comments.map((c) => c.artifactId))).toEqual(new Set(['fa234567']))
  })
  it('since and open=1 compose with it', async () => {
    const { feed, state, a1 } = await twoPages()
    expect((await feed('?since=2026-10-01T10:00:00Z&artifact=fa234567')).body.comments.map((c) => c.body)).toEqual(['a2', 'a3'])
    await state.setResolved!({ artifactId: 'fa234567', slot: 'comments', entryId: a1, resolved: { at: '2026-10-01T10:30:00.000Z', by: 'Robin' } })
    expect((await feed('?since=2020-01-01T00:00:00Z&artifact=fa234567&open=1')).body.comments.map((c) => c.body)).toEqual(['a2', 'a3'])
    expect((await feed('?since=2020-01-01T00:00:00Z&artifact=fb234567&open=1')).body.comments.map((c) => c.body)).toEqual(['b1', 'b2'])
  })
  it('paging with a small page reaches the end and never returns another page\'s row', async () => {
    const b = build([page('fa234567'), page('fb234567')])
    vi.useFakeTimers()
    for (let i = 0; i < 450; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 12, 0, i)))
      await b.state.append({ artifactId: i % 3 === 0 ? 'fb234567' : 'fa234567', slot: 'comments', writer: { key: `u:s${i}`, uid: `s${i}`, email: `s${i}@example.com`, name: 'S', anonymous: false }, value: { anchor, body: `c${i}`, version: 2 } })
    }
    const seen: string[] = []
    let since = '2020-01-01T00:00:00Z'
    for (let guard = 0; guard < 10; guard++) {
      const { body } = await b.feed(`?since=${encodeURIComponent(since)}&artifact=fa234567`)
      expect(new Set(body.comments.map((c) => c.artifactId)).size).toBeLessThanOrEqual(1)
      for (const c of body.comments) { expect(c.artifactId).toBe('fa234567'); seen.push(c.body) }
      if (!body.more) break
      since = body.cursor!
    }
    expect(seen).toHaveLength(300)
    expect(new Set(seen).size).toBe(300)
  })
  it('without the parameter the feed is every page, as before', async () => {
    const { feed } = await twoPages()
    expect((await feed('?since=2020-01-01T00:00:00Z')).body.comments.map((c) => c.body)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3'])
  })
  it('a malformed id is a 400 in words; a valid id with no page is an empty feed', async () => {
    const { feed } = await twoPages()
    for (const bad of ['../x', 'short', 'UPPERCASE', 'abcd1111', '']) {
      const r = await feed(`?since=2020-01-01T00:00:00Z&artifact=${encodeURIComponent(bad)}`)
      expect(r.status, bad).toBe(400)
      expect(r.body.error).toMatch(/artifact/)
    }
    const none = await feed('?since=2020-01-01T00:00:00Z&artifact=zz234567')
    expect(none.status).toBe(200)
    expect(none.body).toMatchObject({ comments: [], cursor: null, more: false })
  })
})

describe('a limit on new browsers through one group link', () => {
  function group(pageExtra: Partial<ArtifactRecord> = { commentName: 'required' }, label = 'Anyone with the link') {
    const b = build([page('rk234567', { links: 'per-reader', ...pageExtra })])
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T10:00:10.000Z'))
    return b.recipients.add('rk234567', [{ label, group: label !== 'Reader A' }]).then(([link]) => ({ ...b, link, rid: b.cookie('rk234567', link) }))
  }
  const send = (routes: ReturnType<typeof build>['routes'], cookie: string, n: number) => routes.STATE_POST(post('rk234567', note(`Note ${n}.`, { by: 'Kit' }), cookie), params('rk234567'))

  it('trips for cookieless writes through one link, in words, and not for a browser that already has its cookie', async () => {
    const { routes, rid } = await group()
    const first = await send(routes, rid, 0)
    expect(first.status).toBe(200)
    const returning = [rid, anonCookieOf(first)].join('; ')
    for (let i = 1; i < ANON_WRITES_PER_MINUTE; i++) expect((await send(routes, rid, i)).status).toBe(200)
    const over = await send(routes, rid, 99)
    expect(over.status).toBe(429)
    expect(((await over.json()) as { error: string }).error).toMatch(/try again in a minute/)
    expect(over.headers.get('set-cookie')).toBeNull()
    expect((await send(routes, returning, 100)).status).toBe(200)
    // The next minute opens it again.
    vi.setSystemTime(new Date('2026-10-01T10:01:10.000Z'))
    expect((await send(routes, rid, 101)).status).toBe(200)
  })
  it('a named link is unaffected', async () => {
    const { routes, rid } = await group({ commentName: 'required' }, 'Reader A')
    for (let i = 0; i < ANON_WRITES_PER_MINUTE + 5; i++) expect((await send(routes, rid, i)).status).toBe(200)
  })
  it('a page without comment_name: required is unaffected', async () => {
    const { routes, rid } = await group({})
    for (let i = 0; i < ANON_WRITES_PER_MINUTE + 5; i++) expect((await routes.STATE_POST(post('rk234567', note(`Note ${i}.`), rid), params('rk234567'))).status).toBe(200)
  })
})
