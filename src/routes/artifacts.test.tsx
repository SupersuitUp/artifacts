import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('next/cache.js', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation.js', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'

const rec: ArtifactRecord = {
  id: 'abc23456', title: 'T', summary: 'S', template: 'document', markdown: '# hi',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', versions: [], views: 0,
}
function fakeStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    get: vi.fn(async (id) => (id === 'abc23456' ? rec : null)),
    save: vi.fn(async () => ({ id: 'abc23456', version: 1, created: true })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    ...overrides,
  }
}
const GOOD = `---\ntitle: T\nsummary: S\n---\n# hi`
const post = (body: string, key?: string, id?: string) =>
  new NextRequest(`http://x/api/artifacts${id ? `?id=${id}` : ''}`, {
    method: 'POST', body, headers: { 'content-type': 'text/markdown', ...(key ? { authorization: `Bearer ${key}` } : {}) },
  })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('createArtifactRoutes', () => {
  let store: ArtifactStore
  let routes: ReturnType<typeof createArtifactRoutes>
  beforeEach(() => {
    store = fakeStore()
    routes = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k' })
  })
  it('POST: 401 without or with the wrong key, 400 naming the field, 201 with the url', async () => {
    expect((await routes.POST(post(GOOD))).status).toBe(401)
    expect((await routes.POST(post(GOOD, 'nope'))).status).toBe(401)
    const bad = await routes.POST(post(`---\ntitle: T\n---\nx`, 'k'))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('front matter is missing summary')
    const ok = await routes.POST(post(GOOD, 'k'))
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ id: 'abc23456', url: 'https://example.com/abc23456', version: 1 })
  })
  it('POST: a missing server key refuses everything', async () => {
    const r = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => undefined })
    expect((await r.POST(post(GOOD, 'k'))).status).toBe(401)
  })
  it('GET returns the narration text; DELETE reports unknown ids', async () => {
    const g = await routes.GET(new NextRequest('http://x/api/artifacts/abc23456', { headers: { authorization: 'Bearer k' } }), params('abc23456'))
    expect((await g.json()).text).toBe('T\nS\nhi')
    store.delete = vi.fn(async () => false)
    const d = await routes.DELETE(new NextRequest('http://x/api/artifacts/zz', { method: 'DELETE', headers: { authorization: 'Bearer k' } }), params('zz'))
    expect(d.status).toBe(404)
  })
  it('metadata is noindex with the site url and the brand name', async () => {
    const m = await routes.generateMetadata(params('abc23456'))
    expect(m.robots).toEqual({ index: false, follow: false })
    expect((m.openGraph as { url?: string }).url).toBe('https://example.com/abc23456')
    expect((m.openGraph as { siteName?: string }).siteName).toBe('Freedom')
  })
  it('a pack with a share card unfurls every page as its own title card, versioned by updatedAt', async () => {
    // Order: a cover the author supplied, then the pack's title card, then the instance's static
    // default. The card URL carries updatedAt so a re-publish changes it and unfurl caches miss.
    const pack = { ...freedomDefault, share: { font: async () => ({ name: 'F', data: new ArrayBuffer(0), weight: 600 }) } }
    const r = createArtifactRoutes({ store, brand: pack, siteUrl: 'https://example.com', publishKey: () => 'k', defaultShareImage: '/og/x.jpg' })
    const m = await r.generateMetadata(params('abc23456'))
    const images = (m.openGraph as { images?: { url: string }[] }).images
    expect(images?.[0].url).toBe('https://example.com/abc23456/share.png?v=2026-09-11T00%3A00%3A00Z')
    expect((m.twitter as { images?: string[] }).images?.[0]).toBe('https://example.com/abc23456/share.png?v=2026-09-11T00%3A00%3A00Z')
    // A cover still wins over the card.
    store.get = vi.fn(async () => ({ ...rec, cover: '/covers/a.webp' }))
    const withCover = await r.generateMetadata(params('abc23456'))
    expect((withCover.openGraph as { images?: { url: string }[] }).images?.[0].url).toBe('https://example.com/covers/a.webp')
    // Without a share card the instance's static default is used, as before.
    const plain = createArtifactRoutes({ store: fakeStore(), brand: { ...freedomDefault, share: undefined }, siteUrl: 'https://example.com', publishKey: () => 'k', defaultShareImage: '/og/x.jpg' })
    expect(((await plain.generateMetadata(params('abc23456'))).openGraph as { images?: { url: string }[] }).images?.[0].url).toBe('https://example.com/og/x.jpg')
  })
  it('SHARE_IMAGE answers 404 for an unknown id and for a pack with no share card, before any render', async () => {
    const pack = { ...freedomDefault, share: { font: async () => ({ name: 'F', data: new ArrayBuffer(0), weight: 600 }) } }
    const r = createArtifactRoutes({ store, brand: pack, siteUrl: 'https://example.com', publishKey: () => 'k' })
    expect((await r.SHARE_IMAGE(new NextRequest('http://x/zzzzzzzz/share.png'), params('zzzzzzzz'))).status).toBe(404)
    const bare = createArtifactRoutes({ store, brand: { ...freedomDefault, share: undefined }, siteUrl: 'https://example.com', publishKey: () => 'k' })
    expect((await bare.SHARE_IMAGE(new NextRequest('http://x/abc23456/share.png'), params('abc23456'))).status).toBe(404)
  })
  it('the page renders the pack kicker, the title and the body', async () => {
    const el = await routes.Page(params('abc23456'))
    const out = renderToStaticMarkup(el)
    expect(out).toContain('A page from Freedom')
    expect(out).toContain('>T<')
    expect(out).toContain('hi')
    expect(out).toContain('data-brand-ground="freedom-default"')
  })
  it('the page carries NO brand mark above the kicker', async () => {
    // An artifact is somebody's writing to somebody, so the header opens on the kicker and the
    // title. An emblem above the kicker was tried and removed (2026-09-13): artifacts do not
    // need one. Asserted as an ABSENCE because an emblem is exactly
    // the kind of thing a later pass adds back as an improvement, and nothing would complain.
    // It is removed from the ARTIFACT route only; the index page still carries the pack's mark.
    const el = await routes.Page(params('abc23456'))
    const out = renderToStaticMarkup(el)
    expect(out).not.toContain('data-brand-mark')
    expect(out).not.toContain('\u{1F54A}')
    expect(out).not.toContain('north-star-cross')
    expect(out).toContain('A page from Freedom')   // the kicker is still the header
  })
  it('PUT_ASSET stores bytes for a known artifact and refuses bad names, types and unknown ids', async () => {
    const put = vi.fn(async (id: string, name: string, _bytes: Buffer, _type: string) => `https://cdn/${id}/${name}`)
    const r = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k', assets: { put } })
    const req = (id: string, name: string, body = 'bytes', key = 'k') =>
      new NextRequest(`http://x/api/artifacts/${id}/assets/${name}`, { method: 'PUT', body, headers: { authorization: `Bearer ${key}` } })
    const p = (id: string, name: string) => ({ params: Promise.resolve({ id, name }) })
    const ok = await r.PUT_ASSET(req('abc23456', 'cover.webp'), p('abc23456', 'cover.webp'))
    expect(ok.status).toBe(201)
    expect((await ok.json()).url).toBe('https://cdn/abc23456/cover.webp')
    expect(put.mock.calls[0][3]).toBe('image/webp')
    expect((await r.PUT_ASSET(req('abc23456', 'cover.webp', 'b', 'nope'), p('abc23456', 'cover.webp'))).status).toBe(401)
    expect((await r.PUT_ASSET(req('zzzzzzzz', 'cover.webp'), p('zzzzzzzz', 'cover.webp'))).status).toBe(404)
    expect((await r.PUT_ASSET(req('abc23456', 'x.exe'), p('abc23456', 'x.exe'))).status).toBe(415)
    expect((await r.PUT_ASSET(req('abc23456', 'a.webp', ''), p('abc23456', 'a.webp'))).status).toBe(400)
    expect((await routes.PUT_ASSET(req('abc23456', 'cover.webp'), p('abc23456', 'cover.webp'))).status).toBe(501)
  })
  describe('a page with a password', () => {
    const shut: ArtifactRecord = { ...rec, password: 'day ones', markdown: '# the secret body' }
    const withCookie = (cookie?: string) => createArtifactRoutes({
      store: fakeStore({ get: vi.fn(async () => shut) }), brand: freedomDefault, siteUrl: 'https://example.com',
      publishKey: () => 'k', readCookie: async () => cookie,
    })
    const open = (key?: string) => ({ params: Promise.resolve({ id: 'abc23456' }), searchParams: Promise.resolve(key === undefined ? {} : { key }) })
    it('shows a door and NOT the body when nothing opens it, and the door asks for a key in the URL', async () => {
      const out = renderToStaticMarkup(await withCookie().Page(open()))
      expect(out).not.toContain('the secret body')
      expect(out).toContain('name="key"')
      expect(out).toContain('>T<')
    })
    it('opens on ?key=<password>, and sets the cookie so the next visit needs nothing', async () => {
      const out = renderToStaticMarkup(await withCookie().Page(open('day ones')))
      expect(out).toContain('the secret body')
      expect(out).toContain('artifact_key_abc23456=')
      expect(out).not.toContain('day ones')
    })
    it('opens on the cookie alone', async () => {
      const { keyHash } = await import('../artifacts/unlock.js')
      const out = renderToStaticMarkup(await withCookie(keyHash('abc23456', 'day ones')).Page(open()))
      expect(out).toContain('the secret body')
    })
    it('a wrong key says so and stays shut, and never echoes the password', async () => {
      const out = renderToStaticMarkup(await withCookie().Page(open('nope')))
      expect(out).not.toContain('the secret body')
      expect(out).toContain('did not open')
      expect(out).not.toContain('day ones')
    })
    it('the unfurl still carries the title and summary, so the link reads as itself in a thread', async () => {
      const m = await withCookie().generateMetadata(params('abc23456'))
      expect(m.title).toBe('T')
      expect(m.description).toBe('S')
    })
    it('a shut page does not count a view', async () => {
      const store = fakeStore({ get: vi.fn(async () => shut) })
      const r = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k', readCookie: async () => undefined })
      await r.Page(open())
      expect(store.bumpViews).not.toHaveBeenCalled()
      await r.Page(open('day ones'))
      expect(store.bumpViews).toHaveBeenCalledTimes(1)
    })
  })
  it('the page 404s an unknown id', async () => {
    await expect(routes.Page(params('nope'))).rejects.toThrow('NOT_FOUND')
  })
  it('a path that is not an id never reaches the store', async () => {
    await expect(routes.Page(params('favicon.ico'))).rejects.toThrow('NOT_FOUND')
    expect(store.get).not.toHaveBeenCalled()
  })
  it('an instance inside a larger site can keep the /a/ prefix', async () => {
    const r = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k', pagePrefix: '/a/' })
    const ok = await r.POST(post(GOOD, 'k'))
    expect((await ok.json()).url).toBe('https://example.com/a/abc23456')
  })
})
