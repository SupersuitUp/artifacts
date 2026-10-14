// The page menu as the server decides it (0.30.0): which role a reader is given, which items each
// role gets at each access level, and that the admin-only data (the markdown source, the password
// in a share link, the version list) is never handed to a page rendered for anyone else.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord, VersionEntry } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { mintGrant, GRANT_COOKIE, type Reader } from '../artifacts/reader.js'
import { PageMenu, type PageMenuProps } from '../reader/page-menu.js'

const SECRET = 'sekrit'
const ID = 'abc23456'
const SOURCE_MARK = `---\nid: ${ID}\n`
const base: ArtifactRecord = {
  id: ID, title: 'The Paper', summary: 'Three bets.', template: 'document', markdown: '## Findings\n\nThe river runs north.',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-13T15:04:00Z', views: 0, version: 2,
}
let rec: ArtifactRecord
let store: ArtifactStore
let readers: ReadersStore
beforeEach(() => {
  rec = { ...base }
  store = {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 3, created: false })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    history: vi.fn(async (): Promise<VersionEntry[]> => [{ version: 2, at: rec.updatedAt, current: true }, { version: 1, at: rec.createdAt, note: 'First draft' }]),
    version: vi.fn(async (_id, n) => (n === 1 ? { version: 1, at: rec.createdAt, markdown: '# first body', note: 'First draft' } : null)),
  }
  readers = {
    allowList: vi.fn(async () => [{ email: 'dana@example.com', name: 'Dana Ruiz' }]), allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}),
    flag: vi.fn(async () => {}), sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  }
})

const owner: Reader = { uid: 'u1', email: 'Robin@Example.com', name: 'Robin Vale', member: true }
const admin: Reader = { uid: 'u2', email: 'casey@example.com', name: 'Casey Admin', member: true }
const dana: Reader = { uid: 'u3', email: 'dana@example.com', name: 'Dana Ruiz', member: true }
const stranger: Reader = { uid: 'u4', email: 'lee@example.com', name: 'Lee Park', member: false }

function routes(who: Reader | null, extra: Partial<Parameters<typeof createArtifactRoutes>[0]> = {}) {
  const cookies: Record<string, string> = who ? { [GRANT_COOKIE]: mintGrant(SECRET, who) } : {}
  return createArtifactRoutes({
    store, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readers, readerSecret: () => SECRET, readCookie: async (n) => cookies[n], signInOrigin: 'https://accounts.example.com',
    ownerEmail: 'robin@example.com', admins: ['casey@example.com'], ...extra,
  })
}
async function tree(who: Reader | null, extra = {}, key?: string) {
  return routes(who, extra).Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(key ? { key } : {}) })
}
async function page(who: Reader | null, extra = {}, key?: string) {
  return renderToStaticMarkup(await tree(who, extra, key))
}
const role = (html: string) => /data-page-menu-for="([^"]+)"/.exec(html)?.[1]
const items = (html: string) => /data-page-menu-items="([^"]*)"/.exec(html)?.[1].split(' ').filter(Boolean)

/** The props the page hands the client PageMenu: exactly what is serialized to the browser for
 *  it. The server-side `Menu` wrapper is pure, so it is expanded here to reach them. */
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
async function served(who: Reader | null, extra = {}, key?: string): Promise<PageMenuProps> {
  const p = menuProps(await tree(who, extra, key))
  if (!p) throw new Error('no page menu on the page')
  return p
}
/** Every string in what the browser is handed for the menu. */
const flat = (v: unknown): string => JSON.stringify(v)
const carries = async (who: Reader | null, needle: string, extra = {}, key?: string) => flat(await served(who, extra, key)).includes(flat(needle).slice(1, -1))

describe('the role the menu is given', () => {
  it('visitor signed out, reader signed in, owner by ownerEmail (any case), admin by admins', async () => {
    expect(role(await page(null))).toBe('visitor')
    expect(role(await page(dana))).toBe('reader')
    expect(role(await page(owner))).toBe('owner')
    expect(role(await page(admin))).toBe('admin')
  })
  it('every page path carries the menu: a past version, a password door, a gated door', async () => {
    expect(role(renderToStaticMarkup(await routes(admin).VersionPage({ params: Promise.resolve({ id: ID, n: '1' }), searchParams: Promise.resolve({}) })))).toBe('admin')
    rec = { ...base, password: 'hunter2' }
    expect(role(await page(null))).toBe('visitor')
    rec = { ...base, access: 'invite' }
    expect(role(await page(null))).toBe('visitor')
    expect(role(await page(stranger))).toBe('reader')
  })
})

describe('the items each role gets on a public page', () => {
  it('visitor: Share and Sign in', async () => {
    expect(items(await page(null))).toEqual(['share', 'sign-in'])
  })
  it('a host with no sign-in authority offers no Sign in', async () => {
    expect(items(await page(null, { signInOrigin: undefined }))).toEqual(['share'])
  })
  it('reader: Share and Sign out, no history, no markdown', async () => {
    expect(items(await page(dana))).toEqual(['share', 'sign-out'])
  })
  it('owner and admin: Share, Version history, Copy the markdown, Sign out', async () => {
    expect(items(await page(owner))).toEqual(['share', 'history', 'markdown', 'sign-out'])
    expect(items(await page(admin))).toEqual(['share', 'history', 'markdown', 'sign-out'])
  })
  it('Show / Hide comments only where shared comments are on', async () => {
    rec = { ...base, comments: 'anyone', state: { writers: 'anyone', visibility: 'private', slots: { comments: { shape: 'many', visibility: 'private', writers: 'anyone' } } } }
    const { createMemoryStateStore } = await import('../artifacts/state-store.js')
    expect(items(await page(null, { state: createMemoryStateStore() }))).toEqual(['share', 'comments', 'sign-in'])
    expect(items(await page(null))).toEqual(['share', 'sign-in'])
  })
  it("history: 'everyone' gives every reader Version history, never the markdown", async () => {
    expect(items(await page(dana, { history: 'everyone' }))).toEqual(['share', 'history', 'sign-out'])
  })
  it('the old History control under the summary is gone; the version line stays for an admin', async () => {
    const html = await page(admin)
    expect(html).toContain('Version 2 · Updated')
    expect(html).not.toContain('>History</button>')
  })
  it('a reader who may not see the history is not told the version number, only when it was updated', async () => {
    for (const who of [null, dana, stranger]) {
      const html = await page(who)
      expect(html).not.toMatch(/Version \d/)
      expect(html).toMatch(/<p data-nospeak="true"[^>]*>Updated /)
    }
  })
  it("history: 'everyone' shows every reader the version number", async () => {
    expect(await page(null, { history: 'everyone' })).toContain('Version 2 · Updated')
    expect(await page(dana, { history: 'everyone' })).toContain('Version 2 · Updated')
  })
})

describe('Share by access level', () => {
  it('a gated freedom page: shown, no note', async () => {
    rec = { ...base, access: 'freedom' }
    const html = await page(dana)
    expect(items(html)).toContain('share')
    expect(await carries(dana, 'Only people on the list can open it.')).toBe(false)
  })
  it('an invite page: shown, with the line that only the list can open it', async () => {
    rec = { ...base, access: 'invite' }
    expect(items(await page(dana))).toContain('share')
    expect(await carries(dana, 'Only people on the list can open it.')).toBe(true)
  })
  it('a password page: absent for everyone but the owner and admins, whose link carries the key', async () => {
    rec = { ...base, password: 'hunter2' }
    expect(items(await page(null, {}, 'hunter2'))).toEqual(['sign-in'])
    expect(items(await page(dana, {}, 'hunter2'))).toEqual(['sign-out'])
    expect(await carries(dana, 'key=hunter2', {}, 'hunter2')).toBe(false)
    expect(items(await page(admin, {}, 'hunter2'))).toContain('share')
    expect(await carries(admin, `https://artifacts.example.com/${ID}?key=hunter2`, {}, 'hunter2')).toBe(true)
    // At the locked door too, so an admin can send the key without opening the page first.
    expect(items(await page(admin))).toEqual(['share', 'sign-out'])
    expect(items(await page(null))).toEqual(['sign-in'])
  })
})

describe('admin-only data never reaches anyone else', () => {
  it('the markdown source is handed to the page only for the owner and admins', async () => {
    expect((await served(null)).markdown).toBeNull()
    expect((await served(dana)).markdown).toBeNull()
    expect(await carries(null, SOURCE_MARK)).toBe(false)
    expect(await carries(dana, SOURCE_MARK)).toBe(false)
    expect(await carries(owner, SOURCE_MARK)).toBe(true)
    expect(await carries(admin, SOURCE_MARK)).toBe(true)
  })
  it('the source is the published front matter and body, ready to republish onto the same page', async () => {
    expect((await served(admin)).markdown).toBe(`---\nid: ${ID}\ntitle: "The Paper"\nsummary: "Three bets."\n---\n\n## Findings\n\nThe river runs north.`)
  })
  it('the version list is not in a non-admin page at all', async () => {
    expect((await served(dana)).history).toBeNull()
    expect(await page(dana)).not.toContain('First draft')
    expect(await page(admin)).toContain('First draft')
  })
  it('a shut-out reader at the door gets only who they are and Sign out', async () => {
    rec = { ...base, access: 'invite' }
    const html = await page(stranger)
    expect(items(html)).toEqual(['share', 'sign-out'])
    expect(await carries(stranger, SOURCE_MARK)).toBe(false)
    expect(html).not.toContain('river runs north')
  })
})
