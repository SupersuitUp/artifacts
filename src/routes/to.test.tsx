// `to:` names who a page is for. It reads "For <name>" in the kicker, in the unfurl title, and on
// the share card; it is never spoken, and it is not an access control.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord, VersionRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'

const ID = 'abc23456'
const base: ArtifactRecord = {
  id: ID, title: 'The Plan', summary: 'Three bets.', template: 'document', markdown: '# Body\n\nWords.',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', views: 0, version: 2,
}
function routesFor(rec: ArtifactRecord, extra: Partial<Parameters<typeof createArtifactRoutes>[0]> = {}, past?: VersionRecord) {
  const store: ArtifactStore = {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 1, created: true })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    history: vi.fn(async () => [{ version: 2, at: rec.updatedAt, current: true as const }, { version: 1, at: rec.createdAt }]),
    version: vi.fn(async (_id, n) => (n === 1 ? past ?? null : null)),
  }
  return createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k', readCookie: async () => undefined, ...extra })
}
const params = { params: Promise.resolve({ id: ID }) }
/** The kicker paragraph's text, tags stripped, and the paragraph itself. */
function kicker(html: string): { text: string; tag: string } {
  const m = html.match(/<p data-nospeak="true" class="mb-4 text-\[11px\][^>]*>(.*?)<\/p>/)
  if (!m) throw new Error('no kicker')
  return { text: m[1].replace(/<[^>]+>/g, ''), tag: m[0] }
}

describe('to: on the page', () => {
  it('the kicker reads "<brand kicker> · For <name>", inside the unspoken kicker', async () => {
    const html = renderToStaticMarkup(await routesFor({ ...base, to: 'Marisol' }).Page(params))
    const k = kicker(html)
    expect(k.text).toBe('A page from Freedom · For Marisol')
    expect(k.tag).toMatch(/<span data-nospeak="true" data-to="true">/)
  })
  it('a page with no to: shows the brand kicker alone', async () => {
    const html = renderToStaticMarkup(await routesFor(base).Page(params))
    expect(kicker(html).text).toBe('A page from Freedom')
    expect(html).not.toContain('data-to')
  })
  it('a password door shows it too, because the door shows the title', async () => {
    const html = renderToStaticMarkup(await routesFor({ ...base, to: 'Marisol', password: 'pw', markdown: '# the secret body' }).Page({ ...params, searchParams: Promise.resolve({}) }))
    expect(html).not.toContain('the secret body')
    expect(kicker(html).text).toBe('A page from Freedom · For Marisol')
  })
  it('a gated door shows it too, because the door shows the title', async () => {
    const readers = {
      allowList: vi.fn(async () => []), allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
      sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
      acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
    } as unknown as ReadersStore
    const r = routesFor({ ...base, to: 'Marisol', access: 'freedom', markdown: '# the secret body' }, { readers, readerSecret: () => 's', signInOrigin: 'https://example.com' })
    const html = renderToStaticMarkup(await r.Page(params))
    expect(html).not.toContain('the secret body')
    expect(kicker(html).text).toBe('A page from Freedom · For Marisol')
  })
  it('a past version shows who THAT version was for', async () => {
    const past: VersionRecord = { version: 1, at: base.createdAt, markdown: '# old', title: 'The Plan', to: 'Dov' }
    const r = routesFor({ ...base, to: 'Marisol' }, {}, past)
    const html = renderToStaticMarkup(await r.VersionPage({ params: Promise.resolve({ id: ID, n: '1' }) }))
    expect(kicker(html).text).toBe('A page from Freedom · For Dov')
    const none = renderToStaticMarkup(await routesFor({ ...base, to: 'Marisol' }, {}, { ...past, to: undefined }).VersionPage({ params: Promise.resolve({ id: ID, n: '1' }) }))
    expect(kicker(none).text).toBe('A page from Freedom')
  })
})

describe('to: in the unfurl', () => {
  it('the title, og:title and twitter:title read "For <name>: <title>"; the description is unchanged', async () => {
    const m = await routesFor({ ...base, to: 'Marisol' }).generateMetadata(params)
    expect(m.title).toBe('For Marisol: The Plan')
    expect((m.openGraph as { title?: string }).title).toBe('For Marisol: The Plan')
    expect((m.twitter as { title?: string }).title).toBe('For Marisol: The Plan')
    expect(m.description).toBe('Three bets.')
    expect((m.openGraph as { description?: string }).description).toBe('Three bets.')
  })
  it('without to: the title is the title', async () => {
    const m = await routesFor(base).generateMetadata(params)
    expect(m.title).toBe('The Plan')
    expect((m.openGraph as { title?: string }).title).toBe('The Plan')
  })
  it('a password page unfurls with it too, since its unfurl carries the title', async () => {
    const m = await routesFor({ ...base, to: 'Marisol', password: 'pw' }).generateMetadata(params)
    expect(m.title).toBe('For Marisol: The Plan')
  })
})

describe('to: is never spoken', () => {
  it('the narration text leaves it out', async () => {
    const r = routesFor({ ...base, to: 'Marisol' })
    const g = await r.GET(new NextRequest(`http://x/api/artifacts/${ID}`, { headers: { authorization: 'Bearer k' } }), params)
    const { text } = (await g.json()) as { text: string }
    expect(text).toBe('The Plan\nThree bets.\nBody\nWords.')
    expect(text).not.toContain('Marisol')
  })
})
