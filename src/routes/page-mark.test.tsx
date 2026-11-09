// A pack with a mark shows it small at the top of every page, above the kicker, linking to the
// hub's front page (supersuit-dev#2151). A pack with no mark draws nothing new, so the default
// look stays byte for byte (unchanged-default.test.tsx). `mark: none` hides it on one page.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault, type BrandPack } from '../brand/pack.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import type { ArtifactStore, ArtifactRecord, VersionRecord } from '../artifacts/store.js'

const ID = 'abc23456'
const base: ArtifactRecord = {
  id: ID, title: 'The Plan', summary: 'Three bets.', template: 'document', markdown: '# Body\n\nWords.',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', views: 0, version: 2,
}
const marked: BrandPack = {
  ...freedomDefault,
  id: 'marked',
  name: 'Example Co',
  kicker: 'A page from Example Co',
  // eslint-disable-next-line @next/next/no-img-element
  Mark: ({ className }) => <img data-test-mark src="https://cdn.example.com/mark.svg" width={120} height={40} alt="" className={className} />,
}
function routesFor(rec: ArtifactRecord, brand: BrandPack = marked, past?: VersionRecord) {
  const store: ArtifactStore = {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 1, created: true })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    history: vi.fn(async () => [{ version: 2, at: rec.updatedAt, current: true as const }, { version: 1, at: rec.createdAt }]),
    version: vi.fn(async (_id, n) => (n === 1 ? past ?? null : null)),
  }
  return createArtifactRoutes({ store, brand, siteUrl: 'https://pages.example.com', publishKey: () => 'k', readCookie: async () => undefined, history: 'everyone' })
}
const params = { params: Promise.resolve({ id: ID }) }
const markLink = (html: string) => html.match(/<a [^>]*data-page-mark[^>]*>.*?<\/a>/)?.[0] ?? null

describe('the brand mark in the page header', () => {
  it('a pack with a mark draws it small above the kicker, unspoken, linking to the front page', async () => {
    const html = renderToStaticMarkup(await routesFor(base).Page(params))
    const link = markLink(html)
    expect(link).not.toBeNull()
    expect(link).toMatch(/href="https:\/\/pages\.example\.com\/"/)
    expect(link).toMatch(/data-nospeak="true"/)
    expect(link).toMatch(/aria-label="Example Co"/)
    expect(link).toMatch(/<img data-test-mark[^>]*class="[^"]*h-8[^"]*w-auto/)
    // Above the kicker line, inside the header.
    expect(html.indexOf('data-page-mark')).toBeLessThan(html.indexOf('A page from Example Co'))
    expect(html.indexOf('data-page-mark')).toBeLessThan(html.indexOf('The Plan</h1>'))
  })
  it('is drawn once, and never stands in for the cover', async () => {
    const html = renderToStaticMarkup(await routesFor({ ...base, cover: 'https://cdn.example.com/cover.png' }).Page(params))
    expect(html.match(/data-page-mark/g)?.length).toBe(1)
    expect(html).toContain('src="https://cdn.example.com/cover.png"')
  })
  it('a pack with no mark draws nothing new', async () => {
    const html = renderToStaticMarkup(await routesFor(base, freedomDefault).Page(params))
    expect(html).not.toContain('data-page-mark')
  })
  it('mark: none hides it on that page', async () => {
    const html = renderToStaticMarkup(await routesFor({ ...base, mark: 'none' }).Page(params))
    expect(html).not.toContain('data-page-mark')
    expect(html).toContain('A page from Example Co')
  })
  it('a password door and a past version show it too', async () => {
    const door = renderToStaticMarkup(await routesFor({ ...base, password: 'pw', markdown: '# secret' }).Page({ ...params, searchParams: Promise.resolve({}) }))
    expect(markLink(door)).not.toBeNull()
    const past: VersionRecord = { version: 1, at: base.createdAt, markdown: '# old', title: 'The Plan' }
    const v = renderToStaticMarkup(await routesFor(base, marked, past).VersionPage({ params: Promise.resolve({ id: ID, n: '1' }) }))
    expect(markLink(v)).not.toBeNull()
  })
  it('a pack Cover gets the mark inside the kicker it is handed', async () => {
    const covered: BrandPack = { ...marked, Cover: ({ title, summary, kicker }) => <header>{kicker}<h1>{title}</h1><p>{summary}</p></header> }
    const html = renderToStaticMarkup(await routesFor(base, covered).Page(params))
    expect(markLink(html)).not.toBeNull()
  })
})

describe('mark: in the front matter', () => {
  it('takes none, and refuses anything else', () => {
    const ok = parseArtifactSource('---\ntitle: T\nsummary: S\nmark: none\n---\nbody')
    expect(ok.ok && ok.meta.mark).toBe('none')
    const bad = parseArtifactSource('---\ntitle: T\nsummary: S\nmark: big\n---\nbody')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/mark must be none/)
  })
})
