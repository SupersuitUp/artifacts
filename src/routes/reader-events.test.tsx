// onReaderEvent: the one place a host learns a reader's state changed. The package says WHAT
// changed and leaves what to do about it (an alert, a text, nothing) entirely to the host.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes, type ArtifactRoutesConfig } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore, SessionDoc } from '../artifacts/readers-store.js'
import type { ReaderEvent } from '../artifacts/read-alerts.js'
import { mintGrant, GRANT_COOKIE, type Reader } from '../artifacts/reader.js'

const SECRET = 'sekrit'
const ID = 'abc23456'
const BODY = Array.from({ length: 460 }, (_, i) => `word${i}`).join(' ')
const rec: ArtifactRecord = {
  id: ID, title: 'The Plan', summary: 'Three bets.', template: 'document', markdown: BODY,
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', views: 0, access: 'invite',
}
const store = {
  get: vi.fn(async (id: string) => (id === ID ? rec : null)),
  save: vi.fn(), delete: vi.fn(), bumpViews: vi.fn(async () => {}),
} as unknown as ArtifactStore
const listed: Reader = { uid: 'u3', email: 'priya@example.com', name: 'Priya Rao', member: false }
const stranger: Reader = { uid: 'u2', email: 'friend@example.com', name: 'Friend', member: false }
const session: SessionDoc = {
  artifactId: ID, session: 'sess-12345678', email: 'priya@example.com', name: 'Priya Rao', member: false,
  startedAt: '2026-10-07T17:00:00Z', lastAt: '2026-10-07T17:05:00Z', activeSeconds: 120, maxScroll: 60,
}

let readers: ReadersStore
let events: ReaderEvent[]
beforeEach(() => {
  events = []
  readers = {
    allowList: vi.fn(async () => [{ email: 'priya@example.com', name: 'Priya', addedAt: '2026-10-01T00:00:00Z' }]),
    allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
    sessions: vi.fn(async () => [session]), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
    listed: vi.fn(async () => [{ artifactId: ID, readers: [{ email: 'priya@example.com', name: 'Priya', addedAt: '2026-10-01T00:00:00Z' }, { email: 'sam@example.com', addedAt: '2026-10-02T00:00:00Z' }] }]),
  }
})
function routes(extra: Partial<ArtifactRoutesConfig> = {}, cookie?: string) {
  return createArtifactRoutes({
    store, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readers, readerSecret: () => SECRET, readCookie: async () => cookie, signInOrigin: 'https://accounts.example.com',
    onReaderEvent: (e) => { events.push(e) },
    ...extra,
  })
}
const beat = (r: ReturnType<typeof routes>, reader: Reader) =>
  r.TRACK(new NextRequest('https://a/api/reader/track', {
    method: 'POST', body: JSON.stringify({ id: ID, session: 'sess-12345678', kind: 'beat', active: 15, scroll: 60 }),
    headers: { 'content-type': 'application/json', cookie: `${GRANT_COOKIE}=${mintGrant(SECRET, reader)}` },
  }))

describe('onReaderEvent', () => {
  it('a recorded heartbeat tells the host who, which page, their record, their list entry, and the reading time', async () => {
    expect((await beat(routes(), listed)).status).toBe(204)
    expect(readers.touchSession).toHaveBeenCalled()
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e).toMatchObject({
      kind: 'visit', artifactId: ID, title: 'The Plan', url: 'https://artifacts.example.com/abc23456',
      reader: { email: 'priya@example.com', name: 'Priya Rao' },
      summary: { sessions: 1, activeSeconds: 120, maxScroll: 60, firstSeen: session.startedAt, lastStarted: session.startedAt },
      entry: { email: 'priya@example.com', addedAt: '2026-10-01T00:00:00Z' },
    })
    // Title, summary and body are what a reader reads: 2 + 2 + 460 words, at 230 a minute.
    expect(e.words).toBe(464)
    expect(e.readSeconds).toBe(121)
  })
  it('a refusal at the door tells the host the account that tried, after the refusal is recorded', async () => {
    const order: string[] = []
    readers.flag = vi.fn(async () => { order.push('flag') })
    const r = routes({ onReaderEvent: (e) => { order.push('event'); events.push(e) } }, mintGrant(SECRET, stranger))
    const html = renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: ID }) }))
    expect(html).not.toContain('word1 ')
    expect(order).toEqual(['flag', 'event'])
    expect(events[0]).toMatchObject({ kind: 'refused', reader: { email: 'friend@example.com', name: 'Friend' }, summary: null, entry: null })
  })
  it('a sink that throws costs the reader nothing: the beat still answers 204 and the page still renders', async () => {
    const boom = { onReaderEvent: () => { throw new Error('sink down') } }
    expect((await beat(routes(boom), listed)).status).toBe(204)
    const html = renderToStaticMarkup(await routes(boom, mintGrant(SECRET, stranger)).Page({ params: Promise.resolve({ id: ID }) }))
    expect(html).toContain('friend@example.com')
    const rejects = { onReaderEvent: async () => { throw new Error('sink down') } }
    expect((await beat(routes(rejects), listed)).status).toBe(204)
  })
  it('without the hook, a heartbeat reads nothing extra', async () => {
    await beat(routes({ onReaderEvent: undefined }), listed)
    expect(readers.sessions).not.toHaveBeenCalled()
    expect(readers.flags).not.toHaveBeenCalled()
  })
  it('nothing is told for a beat the page refuses', async () => {
    expect((await beat(routes(), stranger)).status).toBe(403)
    expect(events).toEqual([])
  })
})

describe('sweepReaders', () => {
  it('tells the host about every listed reader of every gated page, opened or not', async () => {
    expect(await routes().sweepReaders()).toEqual({ pages: 1, readers: 2 })
    expect(events.map((e) => [e.kind, e.reader.email, e.summary?.sessions ?? 0, e.entry?.addedAt])).toEqual([
      ['sweep', 'priya@example.com', 1, '2026-10-01T00:00:00Z'],
      ['sweep', 'sam@example.com', 0, '2026-10-02T00:00:00Z'],
    ])
  })
  it('skips a listed page that is no longer gated or no longer exists', async () => {
    readers.listed = vi.fn(async () => [{ artifactId: 'zzzz2345', readers: [{ email: 'x@example.com' }] }])
    expect(await routes().sweepReaders()).toEqual({ pages: 0, readers: 0 })
  })
  it('does nothing without the hook or without a store that can list', async () => {
    expect(await routes({ onReaderEvent: undefined }).sweepReaders()).toEqual({ pages: 0, readers: 0 })
    delete readers.listed
    expect(await routes().sweepReaders()).toEqual({ pages: 0, readers: 0 })
  })
})
