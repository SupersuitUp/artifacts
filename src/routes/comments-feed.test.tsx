// The comments feed: GET /api/comments?since=<ISO>, the publisher's view of every shared comment
// left on any of the tenant's pages after a time, each with a link straight to it. Personal notes
// never appear (personal-privacy.test.tsx proves that for every handler, this one included).
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import { createMemoryStateStore, type StateStore, type Writer } from '../artifacts/state-store.js'
import { createMemoryPersonalStore } from '../artifacts/personal-store.js'
import { mergeCommentsState } from '../artifacts/comments.js'

const t = '2026-09-28T00:00:00Z'
const page = (id: string, title: string): ArtifactRecord => {
  const merged = mergeCommentsState({ writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one' } } }, 'anyone', 'owner')
  if (!merged.ok) throw new Error(merged.error)
  return { id, title, summary: 'S', template: 'document', markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 2, views: 0, comments: 'anyone', commentsVisible: 'owner', state: merged.state }
}
const RECORDS: Record<string, ArtifactRecord> = { fda23456: page('fda23456', 'First page'), fdb23456: page('fdb23456', 'Second page') }

const sam: Writer = { key: 'u:sam1', uid: 'sam1', email: 'sam@example.com', name: 'Sam Rivera', anonymous: false }
const anon: Writer = { key: 'a:abcdefghijklmnopqrstuvwx', name: null, anonymous: true }
const textAnchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs' }
const regionAnchor = { kind: 'region', block: 'b-p-00000002', x: 0, y: 0, w: 1, h: 1 }

afterEach(() => { vi.useRealTimers() })

async function build(opts: { state?: StateStore | null; audio?: boolean } = {}) {
  vi.useFakeTimers()
  const state = opts.state === undefined ? createMemoryStateStore() : opts.state
  const personal = createMemoryPersonalStore()
  const ids: Record<string, string> = {}
  const add = async (iso: string, artifactId: string, slot: string, writer: Writer, value: unknown) => {
    vi.setSystemTime(new Date(iso))
    const r = await state!.append({ artifactId, slot, writer, value })
    if ('full' in r) throw new Error('full')
    return r.id
  }
  if (state) {
    ids.old = await add('2026-09-28T09:00:00.000Z', 'fda23456', 'comments', sam, { anchor: textAnchor, body: 'too old', version: 2 })
    ids.edge = await add('2026-09-28T10:00:00.000Z', 'fda23456', 'comments', sam, { anchor: textAnchor, body: 'exactly at since', version: 2 })
    ids.first = await add('2026-09-28T11:00:00.000Z', 'fda23456', 'comments', sam, { anchor: textAnchor, body: 'Which river?', version: 2, audio: 'comments/memo1memo1memo1memo1.webm', transcript: 'host' })
    ids.region = await add('2026-09-28T12:00:00.000Z', 'fdb23456', 'comments', anon, { anchor: regionAnchor, body: 'This box', version: 2 })
    ids.reply = await add('2026-09-28T13:00:00.000Z', 'fda23456', 'comments', anon, { anchor: textAnchor, body: 'The north one.', version: 2, parent: ids.first })
    await add('2026-09-28T12:30:00.000Z', 'fda23456', 'notes', sam, 'a notes-slot answer')
    vi.setSystemTime(new Date('2026-09-28T12:40:00.000Z'))
    await state.set({ artifactId: 'fda23456', slot: 'vote', writer: sam, value: 'a vote' })
    await personal.add('fda23456', 'sam1', { anchor: textAnchor as never, body: 'PERSONAL-FEED-MARKER', version: 2 })
  }
  vi.setSystemTime(new Date('2026-09-28T14:00:00.000Z'))
  const store = { get: vi.fn(async (id: string) => RECORDS[id] ?? null) } as unknown as ArtifactStore
  const assets = opts.audio === false ? undefined : { audioUrl: vi.fn(async (id: string, path: string) => `https://cdn.example.com/signed/${id}/${path}`) }
  const routes = createArtifactRoutes({
    store, state: state ?? undefined, personal, assets: assets as never, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
  })
  return { routes, ids, state }
}
const feed = (since: string | null, auth: string | null = 'Bearer k') =>
  new NextRequest(`https://artifacts.example.com/api/comments${since === null ? '' : `?since=${encodeURIComponent(since)}`}`, { headers: auth ? { authorization: auth } : {} })

type Row = { artifactId: string; title: string; entryId: string; parent: string | null; name: string | null; quote: string | null; region: boolean; body: string; transcript: string | null; audioUrl: string | null; at: string; link: string }

describe('COMMENTS_FEED', () => {
  it('refuses without the publish key', async () => {
    const { routes } = await build()
    expect((await routes.COMMENTS_FEED(feed('2026-09-28T10:00:00Z', null))).status).toBe(401)
    expect((await routes.COMMENTS_FEED(feed('2026-09-28T10:00:00Z', 'Bearer nope'))).status).toBe(401)
  })

  it('refuses a missing or malformed since with 400', async () => {
    const { routes } = await build()
    for (const s of [null, '', 'yesterday', '2026-13-45T99:00:00Z', '2026-09-28', '1727000000']) {
      const res = await routes.COMMENTS_FEED(feed(s))
      expect(res.status, String(s)).toBe(400)
    }
  })

  it('every shared comment after since, across pages, oldest first, shaped for a notification', async () => {
    const { routes, ids } = await build()
    const res = await routes.COMMENTS_FEED(feed('2026-09-28T10:00:00Z'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { now: string; comments: Row[] }
    expect(body.now).toBe('2026-09-28T14:00:00.000Z')
    // Exclusive: the comment left exactly at `since` is not repeated.
    expect(body.comments.map((c) => c.body)).toEqual(['Which river?', 'This box', 'The north one.'])
    expect(body.comments[0]).toEqual({
      artifactId: 'fda23456', title: 'First page', entryId: ids.first, parent: null, name: 'Sam Rivera', quote: 'river', region: false,
      body: 'Which river?', transcript: 'host', audioUrl: 'https://cdn.example.com/signed/fda23456/comments/memo1memo1memo1memo1.webm',
      at: '2026-09-28T11:00:00.000Z', link: `https://artifacts.example.com/fda23456#comment-${ids.first}`,
    })
    expect(body.comments[1]).toEqual({
      artifactId: 'fdb23456', title: 'Second page', entryId: ids.region, parent: null, name: null, quote: null, region: true,
      body: 'This box', transcript: null, audioUrl: null, at: '2026-09-28T12:00:00.000Z', link: `https://artifacts.example.com/fdb23456#comment-${ids.region}`,
    })
    expect(body.comments[2]).toMatchObject({ entryId: ids.reply, parent: ids.first, name: null, link: `https://artifacts.example.com/fda23456#comment-${ids.reply}` })
    const text = JSON.stringify(body)
    for (const never of ['a notes-slot answer', 'a vote', 'PERSONAL-FEED-MARKER', 'sam@example.com', 'too old']) expect(text).not.toContain(never)
  })

  it('takes a since with an offset, and answers nothing new past the latest comment', async () => {
    const { routes } = await build()
    const shifted = (await (await routes.COMMENTS_FEED(feed('2026-09-28T13:30:00+02:00'))).json()) as { comments: Row[] }
    expect(shifted.comments.map((c) => c.body)).toEqual(['This box', 'The north one.'])
    const none = (await (await routes.COMMENTS_FEED(feed('2026-09-28T13:00:00.000Z'))).json()) as { comments: Row[] }
    expect(none.comments).toEqual([])
  })

  it('at most 200, the oldest ones, so a cursor at the last row picks up the rest', async () => {
    const state = createMemoryStateStore()
    vi.useFakeTimers()
    for (let i = 0; i < 205; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 15, 0, i)))
      await state.append({ artifactId: 'fda23456', slot: 'comments', writer: { ...sam, key: `u:s${i}` }, value: { anchor: textAnchor, body: `c${i}`, version: 2 } })
    }
    const { routes } = await build({ state })
    const body = (await (await routes.COMMENTS_FEED(feed('2026-09-28T14:59:00Z'))).json()) as { comments: Row[] }
    expect(body.comments).toHaveLength(200)
    expect(body.comments[0].body).toBe('c0')
    expect(body.comments[199].body).toBe('c199')
  })

  it('no recording URL when the host cannot sign one', async () => {
    const { routes } = await build({ audio: false })
    const body = (await (await routes.COMMENTS_FEED(feed('2026-09-28T10:00:00Z'))).json()) as { comments: Row[] }
    expect(body.comments[0].audioUrl).toBeNull()
  })

  it('501 on a host that keeps no answers, or whose store cannot list by time', async () => {
    const { routes } = await build({ state: null })
    expect((await routes.COMMENTS_FEED(feed('2026-09-28T10:00:00Z'))).status).toBe(501)
    const { slotSince: _drop, ...older } = createMemoryStateStore()
    const b = await build({ state: older as StateStore })
    expect((await b.routes.COMMENTS_FEED(feed('2026-09-28T10:00:00Z'))).status).toBe(501)
  })
})
