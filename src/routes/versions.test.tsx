import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord, VersionEntry, VersionRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { mintGrant, GRANT_COOKIE, type Reader } from '../artifacts/reader.js'
import { keyHash, unlockCookieName } from '../artifacts/unlock.js'

const SECRET = 'sekrit'
const ID = 'abc23456'
const base: ArtifactRecord = {
  id: ID, title: 'The Paper', summary: 'S', template: 'document', markdown: '# current body',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-13T15:04:00Z', views: 0, version: 3, note: 'Current note',
  narration: 'https://cdn.example.com/n.mp3', timings: 'https://cdn.example.com/n.json',
}
const past: Record<number, VersionRecord> = {
  1: { version: 1, at: '2026-09-11T00:00:00Z', markdown: '# first body', note: 'First draft', title: 'An Older Title' },
  2: { version: 2, at: '2026-09-12T09:30:00Z', markdown: '# second body' },
}
let rec: ArtifactRecord
function fakeStore(): ArtifactStore {
  return {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 4, created: false })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    history: vi.fn(async (id): Promise<VersionEntry[] | null> => (id === ID
      ? [{ version: 3, at: rec.updatedAt, note: rec.note, current: true }, { version: 2, at: past[2].at }, { version: 1, at: past[1].at, note: 'First draft' }]
      : null)),
    version: vi.fn(async (id, n) => (id !== ID ? null : n === 3 ? { version: 3, at: rec.updatedAt, markdown: rec.markdown, current: true as const } : past[n] ?? null)),
    setNote: vi.fn(async (id, n) => id === ID && n >= 1 && n <= 3),
  }
}
const member: Reader = { uid: 'u1', email: 'jordan@example.com', name: 'Jordan Lee', member: true }
const outsider: Reader = { uid: 'u2', email: 'friend@example.com', name: 'Friend', member: false }

let store: ArtifactStore
let readers: ReadersStore
beforeEach(() => {
  rec = { ...base }
  store = fakeStore()
  readers = {
    allowList: vi.fn(async () => []), allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
    sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  }
})
const routesWith = (cookies: Record<string, string> = {}) => createArtifactRoutes({
  store, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
  readers, readerSecret: () => SECRET, owner: 'Example Co', readCookie: async (n) => cookies[n],
  signInOrigin: 'https://accounts.example.com',
})
const current = async (cookies?: Record<string, string>, key?: string) =>
  renderToStaticMarkup(await routesWith(cookies).Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(key ? { key } : {}) }))
const version = async (n: string, cookies?: Record<string, string>, key?: string) =>
  renderToStaticMarkup(await routesWith(cookies).VersionPage({ params: Promise.resolve({ id: ID, n }), searchParams: Promise.resolve(key ? { key } : {}) }))

describe('the current page names its version and opens its history', () => {
  it('shows "Version N" beside the Updated minute, and a History control carrying every version', async () => {
    const html = await current()
    expect(html).toMatch(/Version 3[\s\S]*Updated/)
    expect(html).toContain('data-version-history')
    expect(html).toContain('First draft')
    expect(html).toContain('Current note')
    expect(html).toContain(`/${ID}/v/1`)
  })
  it('a page with one version names it and offers no history', async () => {
    store.history = vi.fn(async () => [{ version: 1, at: rec.updatedAt, current: true as const }])
    rec = { ...base, version: 1, note: undefined }
    const html = await current()
    expect(html).toContain('Version 1')
    expect(html).not.toContain('data-version-history')
  })
  it('the narration player still mounts on the current page', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ words: [{ word: 'current', start: 0, end: 1 }] }))) as typeof fetch
    expect(await current()).toContain('data-artifact-player')
  })
})

describe('a past version at /<id>/v/<n>', () => {
  it('renders that version read-only, under a banner naming it and linking the current page', async () => {
    const html = await version('2')
    expect(html).toContain('second body')
    expect(html).not.toContain('current body')
    expect(html).toContain('You are reading version 2 of 3')
    expect(html).toContain(`href="/${ID}"`)
  })
  it('uses the title that version carried when it has one', async () => {
    expect(await version('1')).toContain('An Older Title')
  })
  it('has no narration player and records no view', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ words: [{ word: 'x', start: 0, end: 1 }] }))) as typeof fetch
    const html = await version('2')
    expect(html).not.toContain('data-artifact-player')
    expect(store.bumpViews).not.toHaveBeenCalled()
  })
  it('the current number sends the reader to the page itself', async () => {
    await expect(version('3')).rejects.toThrow(`REDIRECT /${ID}`)
  })
  it('404s a version that does not exist, a number that is not one, and a deleted page', async () => {
    await expect(version('4')).rejects.toThrow('NOT_FOUND')
    await expect(version('0')).rejects.toThrow('NOT_FOUND')
    await expect(version('x')).rejects.toThrow('NOT_FOUND')
    await expect(version('01')).rejects.toThrow('NOT_FOUND')
    rec = undefined as unknown as ArtifactRecord
    store.get = vi.fn(async () => null)
    await expect(version('1')).rejects.toThrow('NOT_FOUND')
  })
  it('a store that keeps no history 404s every past version', async () => {
    delete store.version
    await expect(version('1')).rejects.toThrow('NOT_FOUND')
  })
  it('metadata is noindex and names the version', async () => {
    const m = await routesWith().generateVersionMetadata({ params: Promise.resolve({ id: ID, n: '2' }) })
    expect(m.robots).toEqual({ index: false, follow: false })
    expect(String(m.title)).toContain('version 2')
  })
})

describe('gate parity: a past version is shut exactly when the current page is', () => {
  const body = (html: string) => html.includes('current body') || html.includes('second body')
  it('password page: door without the key or cookie, body with either, for both', async () => {
    rec = { ...base, password: 'day ones' }
    const cookie = { [unlockCookieName(ID)]: keyHash(ID, 'day ones') }
    for (const [c, k, open] of [[undefined, undefined, false], [undefined, 'wrong', false], [undefined, 'day ones', true], [cookie, undefined, true]] as const) {
      expect(body(await current(c as Record<string, string> | undefined, k))).toBe(open)
      expect(body(await version('2', c as Record<string, string> | undefined, k))).toBe(open)
    }
  })
  it('gated page: signed out, forged, not allowed and not yet agreed are all shut; a member reads both', async () => {
    rec = { ...base, access: 'invite' }
    const cases: [Record<string, string> | undefined, boolean][] = [
      [undefined, false],
      [{ [GRANT_COOKIE]: mintGrant('wrong', member) }, false],
      [{ [GRANT_COOKIE]: mintGrant(SECRET, outsider) }, false],
    ]
    for (const [c, open] of cases) {
      expect(body(await current(c))).toBe(open)
      expect(body(await version('2', c))).toBe(open)
    }
    rec = { ...base, access: 'freedom' }
    const m = { [GRANT_COOKIE]: mintGrant(SECRET, member) }
    expect(body(await current(m))).toBe(true)
    expect(body(await version('2', m))).toBe(true)
    readers.acknowledged = vi.fn(async () => false)
    expect(body(await current(m))).toBe(false)
    expect(body(await version('2', m))).toBe(false)
  })
  it('a shut page leaks nothing of its history: no notes, no version list', async () => {
    rec = { ...base, access: 'invite' }
    for (const html of [await current(), await version('2'), await version('1')]) {
      expect(html).not.toContain('First draft')
      expect(html).not.toContain('Current note')
      expect(html).not.toContain('data-version-history')
    }
    rec = { ...base, password: 'day ones' }
    expect(await version('1')).not.toContain('First draft')
  })
  it('a shut page does not reveal whether a version exists: the door, not a 404', async () => {
    rec = { ...base, access: 'invite' }
    expect(await version('99')).toContain('The Paper')
  })
  it('signing in from a past version returns the reader to that version', async () => {
    rec = { ...base, access: 'freedom' }
    expect(await version('2')).toContain(encodeURIComponent(`https://artifacts.example.com/${ID}/v/2`))
  })
})

describe('the versions API', () => {
  const req = (method: string, body?: unknown, key = 'k') => new NextRequest(`http://x/api/artifacts/${ID}/versions`, {
    method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  })
  const p = (id = ID) => ({ params: Promise.resolve({ id }) })
  it('lists the history with the publish key, and refuses without it', async () => {
    const r = routesWith()
    expect((await r.VERSIONS(req('GET', undefined, 'nope'), p())).status).toBe(401)
    const ok = await r.VERSIONS(req('GET'), p())
    expect(ok.status).toBe(200)
    expect((await ok.json()).versions.map((v: VersionEntry) => v.version)).toEqual([3, 2, 1])
    expect((await r.VERSIONS(req('GET'), p('zzzzzzzz'))).status).toBe(404)
  })
  it('writes a note onto a version after the fact, and 404s one that does not exist', async () => {
    const r = routesWith()
    const ok = await r.VERSIONS(req('POST', { version: 2, note: 'Backfilled' }), p())
    expect(ok.status).toBe(200)
    expect(store.setNote).toHaveBeenCalledWith(ID, 2, 'Backfilled')
    expect((await r.VERSIONS(req('POST', { version: 9, note: 'x' }), p())).status).toBe(404)
    expect((await r.VERSIONS(req('POST', { version: 'two', note: 'x' }), p())).status).toBe(400)
  })
})

describe('publishing carries the note and the amend', () => {
  const post = (qs: string, body = `---\ntitle: T\nsummary: S\n---\n# hi`) => new NextRequest(`http://x/api/artifacts${qs}`, {
    method: 'POST', body, headers: { authorization: 'Bearer k', 'content-type': 'text/markdown' },
  })
  it('?note= reaches the store and wins over the file; ?amend=1 marks the same publish', async () => {
    const r = routesWith()
    await r.POST(post(`?id=${ID}&note=Tightened%20the%20close`, `---\ntitle: T\nsummary: S\nchange: stale line\n---\n# hi`))
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID, note: 'Tightened the close' }))
    await r.POST(post(`?id=${ID}&amend=1`))
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID, amend: true }))
    await r.POST(post(`?id=${ID}`, `---\ntitle: T\nsummary: S\nchange: From the file\n---\n# hi`))
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'From the file', amend: false }))
  })
})
