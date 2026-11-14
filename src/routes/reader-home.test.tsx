// The hub's home for a signed-in reader who is not its owner or an admin: "Shared with you", the
// pages the hub's own decide() opens for them, grouped onto the hub's shelves. Password pages and
// per-reader-link pages are never listed (they open by their own link only), and neither is a public page,
// shelf or not: a shelf lists what was shared with THIS reader, never what anyone may open. Memory stores only.
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { memoryArtifactStore, testConfig } from './test-config.js'
import type { ReadersStore, SessionDoc } from '../artifacts/readers-store.js'
import type { AllowEntry } from '../artifacts/reader.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { listOfKind } from '../artifacts/store.js'

const RS = 'rs'
const NOW = Date.now()
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const owner: Reader = { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }
const alex: Reader = { uid: 'u2', email: 'alex@example.com', name: 'Alex Doe', member: false }
const friend: Reader = { uid: 'u3', email: 'jamie@example.com', name: 'Jamie', member: false }
const member: Reader = { uid: 'u4', email: 'sam@example.com', name: 'Sam', member: true }

const LISTS: Record<string, AllowEntry[]> = {
  fam12345: [{ email: 'alex@example.com', name: 'Alex' }],
  scho2345: [{ email: 'alex@example.com', name: 'Alex' }],
  padl2345: [{ email: 'jamie@example.com', name: 'Jamie' }],
  trip2345: [{ email: 'alex@example.com', name: 'Alex' }, { email: 'jamie@example.com', name: 'Jamie' }],
  // Listed, but the page is per-reader-link only: never on a shelf.
  link2345: [{ email: 'alex@example.com', name: 'Alex' }],
}

function readersStore(sessions: SessionDoc[] = []): ReadersStore {
  return {
    allowList: vi.fn(async (id: string) => LISTS[id] ?? []),
    sessions: vi.fn(async (id: string) => sessions.filter((s) => s.artifactId === id)),
  } as unknown as ReadersStore
}

function pages() {
  return memoryArtifactStore([
    { id: 'fam12345', title: 'Sunday lunch', access: 'invite', shelf: 'family', createdAt: ago(3), updatedAt: ago(3) },
    { id: 'scho2345', title: 'The school week', access: 'invite', shelf: 'school', createdAt: ago(1), updatedAt: ago(1) },
    { id: 'padl2345', title: 'Club plan', access: 'invite', shelf: 'friends', createdAt: ago(2), updatedAt: ago(2) },
    { id: 'memb2345', title: 'For any member', access: 'freedom', createdAt: ago(2), updatedAt: ago(2) },
    { id: 'link2345', title: 'Per-reader only', access: 'invite', links: 'per-reader', shelf: 'family', createdAt: ago(1), updatedAt: ago(1) },
    { id: 'pass2345', title: 'Password page', password: 'hunter2', shelf: 'family', createdAt: ago(1), updatedAt: ago(1) },
    { id: 'trip2345', title: 'Summer trip', access: 'invite', shelf: 'trips', createdAt: ago(40), updatedAt: ago(40) },
    { id: 'pubs2345', title: 'Public, on a shelf', shelf: 'family', createdAt: ago(1), updatedAt: ago(1) },
    { id: 'publ2345', title: 'Old public page', createdAt: ago(5), updatedAt: ago(5) },
    { id: 'gone2345', title: 'Unpublished', access: 'invite', shelf: 'family', unpublishedAt: ago(1), createdAt: ago(9), updatedAt: ago(9) },
  ])
}

const SHELVES = [
  { id: 'family', label: 'Family pages' },
  { id: 'school', label: 'School' },
  { id: 'friends', label: 'Friends' },
  { id: 'trips', label: 'Trips and plans' },
]

function hub(who: Reader | null, sessions: SessionDoc[] = []) {
  return createArtifactRoutes(testConfig({
    store: pages(), readers: readersStore(sessions), shelves: SHELVES,
    readerSecret: () => RS, ownerEmail: 'robin@example.com',
    readCookie: async (n: string) => (who && n === GRANT_COOKIE ? mintGrant(RS, who) : undefined),
  }))
}
const html = async (who: Reader | null, searchParams: Record<string, string> = {}, sessions: SessionDoc[] = []) => {
  const out = await hub(who, sessions).ReaderHome({ searchParams: Promise.resolve(searchParams) })
  return out === null ? null : new DOMParser().parseFromString(renderToStaticMarkup(out), 'text/html')
}
const listed = (d: Document) => [...d.querySelectorAll('[data-shelf-page]')].map((e) => e.getAttribute('data-shelf-page')).sort()
const shelfOf = (d: Document, id: string) => d.querySelector(`[data-shelf-page="${id}"]`)!.closest('[data-shelf]')!.getAttribute('data-shelf')

describe('ReaderHome', () => {
  it('is null for a visitor who is signed out, so the host keeps its door', async () => {
    expect(await html(null)).toBeNull()
  })
  it('is null for the owner, who keeps the full owner home', async () => {
    expect(await html(owner)).toBeNull()
  })
  it('lists exactly the pages decide() opens for a listed reader', async () => {
    const d = (await html(alex))!
    expect(listed(d)).toEqual(['fam12345', 'scho2345', 'trip2345'])
    expect(shelfOf(d, 'fam12345')).toBe('family')
    expect(shelfOf(d, 'scho2345')).toBe('school')
    expect(d.querySelector('[data-shelf="family"] h2')!.textContent).toBe('Family pages')
    expect(d.querySelector('[data-shelf-page="fam12345"] a')!.getAttribute('href')).toBe('https://artifacts.example.com/fam12345')
    expect(d.body.textContent).toContain('Alex')
  })
  it('a friend sees only their own project, never another person\'s', async () => {
    expect(listed((await html(friend))!)).toEqual(['padl2345', 'trip2345'])
  })
  it('a Supersuit member sees freedom pages, under Other when they carry no shelf', async () => {
    const d = (await html(member))!
    expect(listed(d)).toEqual(['memb2345'])
    expect(shelfOf(d, 'memb2345')).toBe('other')
  })
  it('never lists a password page, a per-reader page, an unpublished page or a public page, shelf or not, for anyone', async () => {
    for (const who of [alex, friend, member]) {
      const ids = listed((await html(who))!)
      for (const never of ['pass2345', 'link2345', 'gone2345', 'publ2345', 'pubs2345']) expect(ids).not.toContain(never)
    }
  })
  it('never carries a password into the listing a store returns', () => {
    const items = listOfKind([{ id: 'pass2345', title: 'P', password: 'hunter2', template: 'document', shelf: 'family' }], 'document')
    expect(JSON.stringify(items)).not.toContain('hunter2')
    expect(items[0]).toMatchObject({ locked: true, shelf: 'family' })
  })
  it('marks NEW a page updated since the reader last opened it, and not one they have read since', async () => {
    const seen: SessionDoc[] = [
      { artifactId: 'fam12345', session: 's', email: 'alex@example.com', name: 'Alex', member: false, startedAt: ago(2), lastAt: ago(2), activeSeconds: 30, maxScroll: 1 },
    ]
    const d = (await html(alex, {}, seen))!
    expect(d.querySelector('[data-shelf-page="fam12345"] [data-new]')).toBeNull()
    expect(d.querySelector('[data-shelf-page="scho2345"] [data-new]')).not.toBeNull()
    // Weeks old and never opened is not news.
    expect(d.querySelector('[data-shelf-page="trip2345"] [data-new]')).toBeNull()
  })
  it('says so when nothing is shared with the reader yet', async () => {
    const d = (await html({ uid: 'u9', email: 'nobody@example.com', name: 'Nobody', member: false }))!
    expect(listed(d)).toEqual([])
    const empty = await createArtifactRoutes(testConfig({ store: memoryArtifactStore([]), readers: readersStore(), readerSecret: () => RS,
      ownerEmail: 'robin@example.com', readCookie: async () => mintGrant(RS, alex) })).ReaderHome({})
    expect(renderToStaticMarkup(empty!)).toContain('Nothing is shared with you here yet')
  })
  it('lets the owner see exactly what one person sees with ?as=', async () => {
    const d = (await html(owner, { as: 'Alex@Example.com' }))!
    expect(listed(d)).toEqual(['fam12345', 'scho2345', 'trip2345'])
    expect(d.querySelector('[data-seeing-as]')!.textContent).toContain('alex@example.com')
    // Nobody else may look through someone else's eyes.
    expect(listed((await html(friend, { as: 'alex@example.com' }))!)).toEqual(['padl2345', 'trip2345'])
  })
})

describe('GET /api/shelves', () => {
  const get = (h: ReturnType<typeof hub>, q: string, key?: string) =>
    h.SHELVES(new NextRequest(`https://artifacts.example.com/api/shelves?${q}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }))
  it('answers the publish key with exactly what that reader\'s home lists', async () => {
    const res = await get(hub(null), 'as=alex@example.com', 'test-key')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.as).toBe('alex@example.com')
    expect(body.shelves.flatMap((s: { pages: { id: string }[] }) => s.pages.map((p) => p.id)).sort()).toEqual(['fam12345', 'scho2345', 'trip2345'])
    expect(body.shelves.map((s: { id: string }) => s.id)).toEqual(['family', 'school', 'trips'])
  })
  it('refuses anyone without the key or an owner sign-in, and asks for as=', async () => {
    expect((await get(hub(null), 'as=alex@example.com')).status).toBe(401)
    expect((await get(hub(alex), 'as=alex@example.com')).status).toBe(401)
    expect((await get(hub(null), '', 'test-key')).status).toBe(400)
  })
})
