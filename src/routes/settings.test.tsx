// The page menu's Share settings and Comment settings (0.31.0), on the server: who may read and
// change a page's settings through /api/artifacts/<id>/settings, what each change does, and that
// the settings (the list, the key) are handed to no page rendered for anyone else.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { applySettingsPatch } from '../artifacts/settings.js'
import { mintGrant, GRANT_COOKIE, type AllowEntry, type Reader } from '../artifacts/reader.js'
import { PageMenu, type PageMenuProps } from '../reader/page-menu.js'
import type { PageSettings } from '../reader/settings-sheet.js'

const SECRET = 'sekrit'
const ID = 'abc23456'
const SITE = 'https://artifacts.example.com'
const base: ArtifactRecord = {
  id: ID, title: 'The Paper', summary: 'Three bets.', template: 'document', markdown: '## Findings\n\nThe river runs north.',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-13T15:04:00Z', views: 0, version: 2,
}
let rec: ArtifactRecord
let list: AllowEntry[]
let store: ArtifactStore
let readers: ReadersStore
beforeEach(() => {
  rec = { ...base }
  list = [{ email: 'dana@example.com', name: 'Dana Ruiz' }]
  store = {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 3, created: false })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    setSettings: vi.fn(async (id, patch) => {
      if (id !== ID) return null
      const r = applySettingsPatch(rec, patch)
      if (!r.ok) throw new Error(r.error)
      rec = { ...rec, ...r.live }
      return rec
    }),
  }
  readers = {
    allowList: vi.fn(async () => list),
    allow: vi.fn(async (_id, add: AllowEntry[], remove: string[]) => {
      list = [...list.filter((e) => !remove.includes(e.email)), ...add]
      return list
    }),
    touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}), sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  }
})

const owner: Reader = { uid: 'u1', email: 'Robin@Example.com', name: 'Robin Vale', member: true }
const admin: Reader = { uid: 'u2', email: 'casey@example.com', name: 'Casey Admin', member: true }
const dana: Reader = { uid: 'u3', email: 'dana@example.com', name: 'Dana Ruiz', member: true }

type Extra = Partial<Parameters<typeof createArtifactRoutes>[0]>
function routes(who: Reader | null, extra: Extra = {}) {
  const cookies: Record<string, string> = who ? { [GRANT_COOKIE]: mintGrant(SECRET, who) } : {}
  return createArtifactRoutes({
    store, brand: freedomDefault, siteUrl: SITE, publishKey: () => 'k', state: createMemoryStateStore(),
    readers, readerSecret: () => SECRET, readCookie: async (n) => cookies[n], signInOrigin: 'https://accounts.example.com',
    ownerEmail: 'robin@example.com', admins: ['casey@example.com'], ...extra,
  })
}
function req(who: Reader | null, method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...(method === 'POST' ? { 'content-type': 'application/json', origin: SITE } : {}), ...headers }
  if (who) h.cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, who)}`
  return new NextRequest(`${SITE}/api/artifacts/${ID}/settings`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
}
async function call(who: Reader | null, method: 'GET' | 'POST', body?: unknown, headers?: Record<string, string>, extra?: Extra, id = ID) {
  const res = await routes(who, extra).SETTINGS(req(who, method, body, headers), { params: Promise.resolve({ id }) })
  return { status: res.status, body: (await res.json()) as PageSettings & { error?: string } }
}

/** The props the page hands the client PageMenu (the shape the browser is sent). */
function menuProps(node: ReactNode): PageMenuProps | null {
  if (Array.isArray(node)) {
    for (const n of node) { const r = menuProps(n); if (r) return r }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === PageMenu) return node.props as PageMenuProps
  if (typeof node.type === 'function' && node.type.name === 'Menu') return menuProps((node.type as (p: unknown) => ReactNode)(node.props))
  const kids = (node.props as { children?: ReactNode }).children
  return kids === undefined ? null : menuProps(kids)
}
async function served(who: Reader | null, extra: Extra = {}, key?: string) {
  const t = await routes(who, extra).Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(key ? { key } : {}) })
  return { props: menuProps(t)!, html: renderToStaticMarkup(t) }
}
const items = (html: string) => /data-page-menu-items="([^"]*)"/.exec(html)?.[1].split(' ').filter(Boolean)

describe('who may use the settings endpoint', () => {
  it('a visitor is asked to sign in, a reader is refused, before the page is even looked up', async () => {
    expect((await call(null, 'GET')).status).toBe(401)
    expect((await call(dana, 'GET')).status).toBe(403)
    expect((await call(dana, 'POST', { access: 'public' })).status).toBe(403)
    expect((await call(dana, 'GET', undefined, undefined, undefined, 'nosuch23')).status).toBe(403)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.setSettings).not.toHaveBeenCalled()
  })
  it('the refusal carries no settings', async () => {
    rec = { ...base, password: 'hunter2' }
    const r = await call(dana, 'GET')
    expect(JSON.stringify(r.body)).not.toContain('hunter2')
    expect(JSON.stringify(r.body)).not.toContain('dana@example.com')
  })
  it('the owner (any case) and an admin read the settings', async () => {
    for (const who of [owner, admin]) {
      const r = await call(who, 'GET')
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ endpoint: `/api/artifacts/${ID}/settings`, access: 'public', levels: ['public', 'freedom', 'invite'], password: false, link: `${SITE}/${ID}`, comments: 'off', commentsVisible: 'owner', gated: false })
      expect(r.body.list).toEqual([{ email: 'dana@example.com', name: 'Dana Ruiz' }])
    }
  })
  it('the publish key is not a way in: it belongs to a session, not a person on the page', async () => {
    expect((await call(null, 'POST', { access: 'public' }, { authorization: 'Bearer k' })).status).toBe(401)
  })
  it('an unknown page is 404 for an admin; a store that cannot change settings is 501', async () => {
    expect((await call(admin, 'GET', undefined, undefined, undefined, 'nosuch23')).status).toBe(404)
    delete store.setSettings
    expect((await call(admin, 'GET')).status).toBe(501)
  })
})

describe('a POST must come from this host as JSON', () => {
  it('refuses a foreign origin, a cross-site fetch, and a form post', async () => {
    expect((await call(admin, 'POST', { access: 'invite' }, { origin: 'https://evil.example.net' })).status).toBe(403)
    expect((await call(admin, 'POST', { access: 'invite' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await call(admin, 'POST', 'access=invite', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415)
    expect(rec.access).toBeUndefined()
  })
  it('takes a same-origin fetch', async () => {
    expect((await call(admin, 'POST', { access: 'invite' }, { 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })
})

describe('validation', () => {
  it('refuses unknown settings and bad values, changing nothing', async () => {
    const bad = [
      { access: 'everyone' }, { password: 'yes' }, { comments: 'all' }, { commentsVisible: 'public' }, { secret: 1 },
      { add: [{ email: 'not-an-email' }] }, { add: 'dana@example.com' }, { remove: [3] }, [], 'not json',
    ]
    for (const b of bad) expect((await call(admin, 'POST', b)).status, JSON.stringify(b)).toBe(400)
    expect(store.setSettings).not.toHaveBeenCalled()
    expect(readers.allow).not.toHaveBeenCalled()
  })
  it('a host with no reader list offers only public, and refuses a gated level or a list change', async () => {
    const r = await call(admin, 'GET', undefined, undefined, { readers: undefined })
    expect(r.body.levels).toEqual(['public'])
    expect(r.body.list).toBeNull()
    expect((await call(admin, 'POST', { access: 'invite' }, undefined, { readers: undefined })).status).toBe(400)
    expect((await call(admin, 'POST', { add: [{ email: 'a@example.com' }] }, undefined, { readers: undefined })).status).toBe(400)
  })
  it('a host that keeps no answers has no comment settings, and refuses a change to them', async () => {
    const r = await call(admin, 'GET', undefined, undefined, { state: undefined })
    expect(r.body.comments).toBeNull()
    expect((await call(admin, 'POST', { comments: 'anyone' }, undefined, { state: undefined })).status).toBe(400)
  })
})

describe('each setting round-trips', () => {
  it('who can open it', async () => {
    for (const level of ['freedom', 'invite', 'public'] as const) {
      const r = await call(owner, 'POST', { access: level })
      expect(r.status).toBe(200)
      expect(r.body.access).toBe(level)
      expect(rec.access).toBe(level === 'public' ? undefined : level)
      expect((await call(owner, 'GET')).body.access).toBe(level)
    }
  })
  it('the password: on makes a key and puts it in the link; on again keeps it; off takes the door down', async () => {
    const on = await call(admin, 'POST', { password: 'on' })
    expect(on.body.password).toBe(true)
    const key = rec.password!
    expect(key).toMatch(/^[a-z2-9]{12}$/)
    expect(on.body.link).toBe(`${SITE}/${ID}?key=${key}`)
    expect((await call(admin, 'POST', { password: 'on' })).body.link).toContain(key)
    const off = await call(admin, 'POST', { password: 'off' })
    expect(off.body).toMatchObject({ password: false, link: `${SITE}/${ID}` })
    expect(rec.password).toBeUndefined()
  })
  it('the list: add and remove an email', async () => {
    const a = await call(admin, 'POST', { add: [{ email: ' lee@example.com ' }] })
    expect(a.body.list).toEqual([{ email: 'dana@example.com', name: 'Dana Ruiz' }, { email: 'lee@example.com' }])
    const r = await call(admin, 'POST', { remove: ['dana@example.com'] })
    expect(r.body.list).toEqual([{ email: 'lee@example.com' }])
  })
  it('who can comment and who reads the comments', async () => {
    const on = await call(admin, 'POST', { comments: 'anyone', commentsVisible: 'readers' })
    expect(on.body).toMatchObject({ comments: 'anyone', commentsVisible: 'readers' })
    expect(rec.state?.slots.comments).toEqual({ shape: 'many', visibility: 'shared', writers: 'anyone' })
    expect((await call(admin, 'POST', { comments: 'signed-in' })).body.comments).toBe('signed-in')
    expect((await call(admin, 'POST', { commentsVisible: 'owner' })).body.commentsVisible).toBe('owner')
    expect((await call(admin, 'POST', { comments: 'off' })).body.comments).toBe('off')
    expect(rec.state).toBeUndefined()
  })
  it('a change the store refuses comes back as a sentence', async () => {
    rec = { ...base, state: { writers: 'anyone', visibility: 'private', slots: { comments: { shape: 'one' } } } }
    const r = await call(admin, 'POST', { comments: 'anyone' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/own slot named "comments"/)
  })
  it('the page reflects a change at once: comments turned on show the comments item', async () => {
    expect(items((await served(admin)).html)).not.toContain('comments')
    await call(admin, 'POST', { comments: 'anyone' })
    expect(items((await served(admin)).html)).toContain('comments')
  })
})

describe('the menu and the settings it is handed', () => {
  it('Share settings and Comment settings for the owner and admins only', async () => {
    expect(items((await served(owner)).html)).toEqual(['share', 'share-settings', 'comment-settings', 'markdown', 'sign-out'])
    expect(items((await served(admin)).html)).toEqual(['share', 'share-settings', 'comment-settings', 'markdown', 'sign-out'])
    expect(items((await served(dana)).html)).toEqual(['share', 'sign-out'])
    expect(items((await served(null)).html)).toEqual(['share', 'sign-in'])
  })
  it('no Comment settings on a host that keeps no comments; no settings at all on a store that cannot change them', async () => {
    expect(items((await served(admin, { state: undefined })).html)).toEqual(['share', 'share-settings', 'markdown', 'sign-out'])
    delete store.setSettings
    expect(items((await served(admin)).html)).toEqual(['share', 'markdown', 'sign-out'])
  })
  it('the list and the key are handed to no page but the owner\'s and admins\'', async () => {
    rec = { ...base, password: 'hunter2' }
    for (const who of [null, dana]) {
      const { props, html } = await served(who, {}, 'hunter2')
      expect(props.settings ?? null).toBeNull()
      expect(JSON.stringify(props)).not.toContain('dana@example.com')
      expect(html).not.toContain('hunter2')
    }
    const { props } = await served(admin, {}, 'hunter2')
    expect(props.settings).toMatchObject({ password: true, link: `${SITE}/${ID}?key=hunter2` })
  })
  it('an admin gets the settings at a password door and at a gated door too', async () => {
    rec = { ...base, password: 'hunter2' }
    expect((await served(admin)).props.settings?.password).toBe(true)
    rec = { ...base, access: 'invite' }
    expect((await served(admin)).props.settings).toMatchObject({ access: 'invite', gated: true })
  })
  it('the package\'s own facts, by access level', async () => {
    const facts = async () => (await served(admin)).props.settings!.facts
    expect(await facts()).toEqual([
      { label: 'A stranger with the bare URL sees', text: 'The whole page. The bare link is all anyone needs.' },
      { label: 'Search engines', text: 'Hidden from search engines (noindex, nofollow). People find it only through a link someone sends.' },
    ])
    rec = { ...base, password: 'k' }
    expect((await facts())[0].text).toMatch(/door asking for the key/)
    rec = { ...base, access: 'freedom' }
    expect((await facts())[0].text).toMatch(/sign-in door/)
  })
  it('a host\'s shareFacts replace them; a throw falls back to them', async () => {
    const shareFacts = vi.fn(async (a: ArtifactRecord) => [{ label: 'Search engines', text: `robots.txt shuts ${a.id}` }])
    expect((await served(admin, { shareFacts })).props.settings!.facts).toEqual([{ label: 'Search engines', text: `robots.txt shuts ${ID}` }])
    expect((await call(admin, 'GET', undefined, undefined, { shareFacts })).body.facts).toEqual([{ label: 'Search engines', text: `robots.txt shuts ${ID}` }])
    await served(dana, { shareFacts })
    expect(shareFacts).toHaveBeenCalledTimes(2)
    const broken = () => { throw new Error('down') }
    expect((await served(admin, { shareFacts: broken })).props.settings!.facts).toHaveLength(2)
  })
})
