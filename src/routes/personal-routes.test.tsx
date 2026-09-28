// The reader's own notes: signed in only, their own only, and every door the page has.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { createMemoryPersonalStore, type PersonalStore } from '../artifacts/personal-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { keyHash, unlockCookieName } from '../artifacts/unlock.js'

const SECRET = 'sekrit'
const t = '2026-09-28T00:00:00Z'
const base = { summary: 'S', template: 'document' as const, markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 1, views: 0 }
const RECORDS: Record<string, ArtifactRecord> = {
  // No state and no comments: personal notes still work on every page.
  pqn23456: { id: 'pqn23456', title: 'Plain', ...base },
  pwd23456: { id: 'pwd23456', title: 'Locked', password: 'sesame', ...base },
  gtd23456: { id: 'gtd23456', title: 'Gated', access: 'invite', ...base },
}
const store = (): ArtifactStore => ({
  get: vi.fn(async (id: string) => RECORDS[id] ?? null), save: vi.fn(), delete: vi.fn(), bumpViews: vi.fn(async () => {}),
}) as unknown as ArtifactStore
const readers = (acked = true): ReadersStore => ({
  allowList: vi.fn(async () => [{ email: 'sam@example.com', name: 'Sam' }]),
  allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
  sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
  acknowledged: vi.fn(async () => acked), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
})
function build(opts: { personal?: PersonalStore | null; acked?: boolean } = {}) {
  const personal = opts.personal === null ? undefined : (opts.personal ?? createMemoryPersonalStore())
  const routes = createArtifactRoutes({
    store: store(), personal, readers: readers(opts.acked ?? true), brand: freedomDefault, siteUrl: 'https://artifacts.example.com',
    publishKey: () => 'k', readerSecret: () => SECRET, signInOrigin: 'https://accounts.example.com',
  })
  return { routes, personal }
}

const sam: Reader = { uid: 'u3', email: 'sam@example.com', name: 'Sam Reader', member: false }
const jo: Reader = { uid: 'u5', email: 'jo@example.com', name: 'Jo Other', member: true }
const grant = (r: Reader) => `${GRANT_COOKIE}=${mintGrant(SECRET, r)}`
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const url = (id: string, q = '') => `https://artifacts.example.com/api/artifacts/${id}/personal${q}`
const get = (id: string, cookie?: string) => new NextRequest(url(id), { headers: cookie ? { cookie } : {} })
const post = (id: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  new NextRequest(url(id), { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers } })
const del = (id: string, entry: string, cookie?: string) => new NextRequest(url(id, `?entry=${entry}`), { method: 'DELETE', headers: cookie ? { cookie } : {} })

const value = { anchor: { kind: 'region', block: 'b-img-0a1b2c3d', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, body: 'Only for me', version: 1 }
type Notes = { notes: { id: string; value: { body: string } }[] }

describe('personal notes', () => {
  it('an anonymous reader is told to keep notes on the device (401, device: true)', async () => {
    const { routes } = build()
    const r = await routes.PERSONAL_GET(get('pqn23456'), params('pqn23456'))
    expect(r.status).toBe(401)
    expect(await r.json()).toMatchObject({ device: true })
    expect((await routes.PERSONAL_POST(post('pqn23456', { value }), params('pqn23456'))).status).toBe(401)
  })

  it('a host with no personal store answers 501, and the reader keeps notes on the device', async () => {
    const { routes } = build({ personal: null })
    const r = await routes.PERSONAL_GET(get('pqn23456', grant(sam)), params('pqn23456'))
    expect(r.status).toBe(501)
    expect(await r.json()).toMatchObject({ device: true })
  })

  it('a signed-in reader saves, reads, edits and deletes their own, on a page with no state at all', async () => {
    const { routes } = build()
    const saved = (await (await routes.PERSONAL_POST(post('pqn23456', { value }, grant(sam)), params('pqn23456'))).json()) as Notes
    expect(saved.notes.map((n) => n.value.body)).toEqual(['Only for me'])
    const id = saved.notes[0].id
    const edited = (await (await routes.PERSONAL_POST(post('pqn23456', { entry: id, value: { ...value, body: 'Still mine' } }, grant(sam)), params('pqn23456'))).json()) as Notes
    expect(edited.notes.map((n) => n.value.body)).toEqual(['Still mine'])
    // Another reader sees none of it, and can neither edit nor delete it.
    expect(((await (await routes.PERSONAL_GET(get('pqn23456', grant(jo)), params('pqn23456'))).json()) as Notes).notes).toEqual([])
    expect((await routes.PERSONAL_POST(post('pqn23456', { entry: id, value }, grant(jo)), params('pqn23456'))).status).toBe(404)
    expect((await routes.PERSONAL_DELETE(del('pqn23456', id, grant(jo)), params('pqn23456'))).status).toBe(404)
    const gone = await routes.PERSONAL_DELETE(del('pqn23456', id, grant(sam)), params('pqn23456'))
    expect(gone.status).toBe(200)
    expect(((await gone.json()) as Notes).notes).toEqual([])
  })

  it('refuses a malformed note, a reply, and a foreign origin', async () => {
    const { routes } = build()
    expect((await routes.PERSONAL_POST(post('pqn23456', { value: { body: 'no anchor', version: 1 } }, grant(sam)), params('pqn23456'))).status).toBe(400)
    expect((await routes.PERSONAL_POST(post('pqn23456', { value: { ...value, parent: 'x' } }, grant(sam)), params('pqn23456'))).status).toBe(400)
    expect((await routes.PERSONAL_POST(post('pqn23456', { value }, grant(sam), { origin: 'https://evil.example.net' }), params('pqn23456'))).status).toBe(403)
    expect((await routes.PERSONAL_POST(post('pqn23456', 'not an object', grant(sam)), params('pqn23456'))).status).toBe(400)
  })

  it('a password page needs its unlock cookie; a gated page needs the reader let in and agreed', async () => {
    const { routes } = build()
    expect((await routes.PERSONAL_GET(get('pwd23456', grant(sam)), params('pwd23456'))).status).toBe(403)
    const unlocked = `${grant(sam)}; ${unlockCookieName('pwd23456')}=${keyHash('pwd23456', 'sesame')}`
    expect((await routes.PERSONAL_GET(get('pwd23456', unlocked), params('pwd23456'))).status).toBe(200)
    expect((await routes.PERSONAL_GET(get('gtd23456', grant(jo)), params('gtd23456'))).status).toBe(403)
    expect((await routes.PERSONAL_GET(get('gtd23456', grant(sam)), params('gtd23456'))).status).toBe(200)
    const { routes: notAgreed } = build({ acked: false })
    expect((await notAgreed.PERSONAL_GET(get('gtd23456', grant(sam)), params('gtd23456'))).status).toBe(403)
  })

  it('a page that does not exist is a 404', async () => {
    const { routes } = build()
    expect((await routes.PERSONAL_GET(get('zzz99999', grant(sam)), params('zzz99999'))).status).toBe(404)
  })

  it('a password page on a host keeping personal notes sets its API unlock cookie, so the notes route opens', async () => {
    const withPersonal = createArtifactRoutes({
      store: store(), personal: createMemoryPersonalStore(), brand: freedomDefault, siteUrl: 'https://artifacts.example.com',
      publishKey: () => 'k', readCookie: async () => keyHash('pwd23456', 'sesame'),
    })
    const page = { params: Promise.resolve({ id: 'pwd23456' }), searchParams: Promise.resolve({}) }
    expect(renderToStaticMarkup(await withPersonal.Page(page))).toContain('Path=/api/artifacts/pwd23456;')
  })
})

