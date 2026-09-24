import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('next/cache.js', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation.js', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { mintGrant, mintPass, GRANT_COOKIE, type Reader } from '../artifacts/reader.js'

const SECRET = 'sekrit'
const rec: ArtifactRecord = {
  id: 'abc23456', title: 'The Lightpaper', summary: 'S', template: 'document', markdown: '# the secret body',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', versions: [], views: 0, access: 'freedom', subtitle: 'The Subtitle Line',
}
const store: ArtifactStore = {
  get: vi.fn(async (id) => (id === 'abc23456' ? rec : null)),
  save: vi.fn(), delete: vi.fn(), bumpViews: vi.fn(async () => {}),
} as unknown as ArtifactStore
const member: Reader = { uid: 'u1', email: 'jordan@example.com', name: 'Jordan Lee', member: true }
const outsider: Reader = { uid: 'u2', email: 'friend@example.com', name: 'Friend', member: false }
const listed: Reader = { uid: 'u3', email: 'priya@example.com', name: null, member: false }

let readers: ReadersStore
function routesWith(cookie?: string) {
  return createArtifactRoutes({
    store, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readers, readerSecret: () => SECRET, owner: 'Example Co', readCookie: async () => cookie,
    signInOrigin: 'https://accounts.example.com',
  })
}
const page = async (cookie?: string) =>
  renderToStaticMarkup(await routesWith(cookie).Page({ params: Promise.resolve({ id: 'abc23456' }) }))

beforeEach(() => {
  readers = {
    allowList: vi.fn(async () => [{ email: 'priya@example.com', name: 'Priya', reason: 'Sam shared it with you personally' }]),
    allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
    sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  }
})

describe('a gated page', () => {
  it('signed out: title and a sign-in door, never the body', async () => {
    const html = await page()
    expect(html).toContain('The Lightpaper')
    expect(html).toContain('/artifact/sign-in?to=https%3A%2F%2Fartifacts.example.com%2Fabc23456')
    expect(html).not.toContain('the secret body')
  })
  it('no sign-in authority configured: the door stays shut and offers no way through', async () => {
    // The package names no sign-in service of its own, so a host that forgot signInOrigin must
    // fail closed rather than send readers to somebody else's sign-in.
    const r = createArtifactRoutes({
      store, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
      readers, readerSecret: () => SECRET, readCookie: async () => undefined,
    })
    const html = renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: 'abc23456' }) }))
    expect(html).toContain('The Lightpaper')
    expect(html).toContain('cannot sign readers in yet')
    expect(html).not.toContain('/artifact/sign-in')
    expect(html).not.toContain('the secret body')
  })
  it('a forged or foreign-secret cookie is signed out', async () => {
    expect(await page(mintGrant('wrong', member))).not.toContain('the secret body')
  })
  it('a Freedom member reads it, addressed by name, told why, with the rule and the record', async () => {
    const html = await page(mintGrant(SECRET, member))
    expect(html).toContain('the secret body')
    expect(html).toContain('Jordan, this is confidential.')
    expect(html).toContain('You are reading it because you are a Freedom user.')
    expect(html).toContain('anyone Example Co has not given access')
    expect(html).toContain('Your reading is recorded under jordan@example.com')
    expect(html).toContain('@media print')
    // Title, subtitle and teaser are three separate lines, in that order.
    const t = html.indexOf('The Lightpaper'), st = html.indexOf('The Subtitle Line')
    expect(t).toBeGreaterThan(-1)
    expect(st).toBeGreaterThan(t)
  })
  it('a listed non-member reads it with their own reason and name', async () => {
    const html = await page(mintGrant(SECRET, listed))
    expect(html).toContain('Priya, this is confidential.')
    expect(html).toContain('You are reading it because Sam shared it with you personally.')
  })
  it('someone it was forwarded to is refused, and the refusal is recorded under their address', async () => {
    const html = await page(mintGrant(SECRET, outsider))
    expect(html).not.toContain('the secret body')
    expect(html).toContain('friend@example.com')
    expect(readers.flag).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'abc23456', kind: 'refused', reader: expect.objectContaining({ email: 'friend@example.com' }) }))
  })
  it('without a reader record the page fails closed', async () => {
    const r = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://a', publishKey: () => 'k', readerSecret: () => SECRET, readCookie: async () => mintGrant(SECRET, member) })
    expect(renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: 'abc23456' }) }))).not.toContain('the secret body')
  })
})

describe('the confidentiality agreement', () => {
  it('an allowed reader who has not agreed sees the agreement and never the body', async () => {
    readers.acknowledged = vi.fn(async () => false)
    const html = await page(mintGrant(SECRET, member))
    expect(html).not.toContain('the secret body')
    expect(html).toContain('Jordan, before you read')
    expect(html).toContain('I understand this document is confidential.')
    expect(html).toContain('anyone Example Co has not given access')
    expect(html).toContain('action="/api/reader/ack"')
  })
  const ack = (reader: Reader | null, fields: Record<string, string>) => {
    const body = new URLSearchParams(fields)
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
    if (reader) headers.cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, reader)}`
    return routesWith().ACK(new NextRequest('https://artifacts.example.com/api/reader/ack', { method: 'POST', body, headers }))
  }
  it('ACK records the exact wording for an allowed reader who ticked the box, and lands on the page', async () => {
    const res = await ack(member, { id: 'abc23456', agree: 'yes' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://artifacts.example.com/abc23456')
    expect(readers.acknowledge).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'abc23456', reader: expect.objectContaining({ email: 'jordan@example.com' }),
      text: expect.stringContaining('anyone Example Co has not given access'),
    }))
  })
  it('ACK records nothing without the box, without a grant, or for someone the page refuses', async () => {
    await ack(member, { id: 'abc23456' })
    await ack(null, { id: 'abc23456', agree: 'yes' })
    await ack(outsider, { id: 'abc23456', agree: 'yes' })
    expect(readers.acknowledge).not.toHaveBeenCalled()
  })
})

describe('the reader routes', () => {
  it('ENTER swaps a good pass for an HttpOnly grant and lands on the clean page', async () => {
    const pass = mintPass(SECRET, member, Math.floor(Date.now() / 1000) + 60)
    const res = await routesWith().ENTER(new NextRequest(`https://artifacts.example.com/api/reader/enter?to=/abc23456&pass=${pass}`))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://artifacts.example.com/abc23456')
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${GRANT_COOKIE}=g1\\..*HttpOnly; Secure`))
  })
  it('ENTER sets nothing for a bad pass and refuses an off-host target', async () => {
    const bad = await routesWith().ENTER(new NextRequest('https://a/api/reader/enter?to=/abc23456&pass=a1.x.y'))
    expect(bad.headers.get('set-cookie')).toBeNull()
    expect((await routesWith().ENTER(new NextRequest('https://a/api/reader/enter?to=//evil.example'))).status).toBe(400)
  })
  const track = (reader: Reader | null, body: object) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (reader) headers.cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, reader)}`
    return routesWith().TRACK(new NextRequest('https://a/api/reader/track', { method: 'POST', body: JSON.stringify(body), headers }))
  }
  it('TRACK records time and scroll for an allowed reader, capped', async () => {
    expect((await track(member, { id: 'abc23456', session: 'sess-12345678', kind: 'beat', active: 999, scroll: 42 })).status).toBe(204)
    expect(readers.touchSession).toHaveBeenCalledWith(expect.objectContaining({ addSeconds: 60, scroll: 42, session: 'sess-12345678' }))
  })
  it('TRACK records a save attempt, and refuses anyone the page would refuse', async () => {
    expect((await track(member, { id: 'abc23456', session: 'sess-12345678', kind: 'flag', flag: 'save', detail: 'keyboard' })).status).toBe(204)
    expect(readers.flag).toHaveBeenCalledWith(expect.objectContaining({ kind: 'save', detail: 'keyboard' }))
    expect((await track(outsider, { id: 'abc23456', session: 'sess-12345678', kind: 'beat' })).status).toBe(403)
    expect((await track(null, { id: 'abc23456', session: 'sess-12345678', kind: 'beat' })).status).toBe(401)
    expect((await track(member, { id: 'abc23456', session: 'sess-12345678', kind: 'flag', flag: 'refused' })).status).toBe(400)
  })
  it('ACCESS and READS need the publish key', async () => {
    const ctx = { params: Promise.resolve({ id: 'abc23456' }) }
    expect((await routesWith().ACCESS(new NextRequest('https://a/api/artifacts/abc23456/access'), ctx)).status).toBe(401)
    expect((await routesWith().READS(new NextRequest('https://a/api/artifacts/abc23456/reads'), ctx)).status).toBe(401)
    const ok = await routesWith().ACCESS(new NextRequest('https://a/api/artifacts/abc23456/access', {
      method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ add: [{ email: 'd@example.com', name: 'D' }] }),
    }), { params: Promise.resolve({ id: 'abc23456' }) })
    expect(ok.status).toBe(200)
    expect(readers.allow).toHaveBeenCalledWith('abc23456', [{ email: 'd@example.com', name: 'D' }], [])
    const bad = await routesWith().ACCESS(new NextRequest('https://a/api/artifacts/abc23456/access', {
      method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ add: [{ email: 'not-an-email' }] }),
    }), { params: Promise.resolve({ id: 'abc23456' }) })
    expect(bad.status).toBe(400)
  })
  it('ACCESS sets the level host-side, and refuses a level it does not know', async () => {
    const setAccess = vi.fn(async () => true)
    ;(store as { setAccess?: unknown }).setAccess = setAccess
    const call = (access: string) => routesWith().ACCESS(new NextRequest('https://a/api/artifacts/abc23456/access', {
      method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ access }),
    }), { params: Promise.resolve({ id: 'abc23456' }) })
    const r = await call('invite')
    expect(r.status).toBe(200)
    expect((await r.json()).access).toBe('invite')
    expect(setAccess).toHaveBeenCalledWith('abc23456', 'invite')
    expect((await call('everyone')).status).toBe(400)
  })
})
