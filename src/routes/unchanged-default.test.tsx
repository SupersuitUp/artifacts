// A pack that uses none of the 0.16.0 extension points renders every page byte for byte as it did
// before they existed. The golden was rendered by 0.15.0 (the release before them) from this same
// file; regenerate it only on purpose, with WRITE_GOLDEN=1, and say why in the commit.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault, type BrandPack } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord, VersionRecord } from '../artifacts/store.js'

const ID = 'abc23456'
const MD = [
  '## Opening', '', 'A first paragraph with **bold**, *italic* and a [link](https://example.com/x).', '',
  '![A still](https://cdn.example.com/01-still.png)', '',
  '## Second part', '', '- one', '- two', '', '### A subhead', '', '> a quote', '',
  '![An animation](https://cdn.example.com/02-moving.abc12345.mp4)', '',
  '## Third', '', 'Agentic Edge is defined here.', '', '## Fourth', '', 'Last words.',
].join('\n')
const rec: ArtifactRecord = {
  id: ID, title: 'The Plan', subtitle: 'A line under it', summary: 'Three bets.', to: 'Marisol', template: 'document', markdown: MD,
  cover: 'https://cdn.example.com/cover.png', definitions: [{ term: 'Agentic Edge', description: 'Context you own.' }],
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', views: 0, version: 2,
}
const past: VersionRecord = { version: 1, at: rec.createdAt, markdown: MD.replace('Last words.', 'Old words.'), title: 'The Plan' }
function routes(brand: BrandPack) {
  const store: ArtifactStore = {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 1, created: true })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    history: vi.fn(async () => [{ version: 2, at: rec.updatedAt, current: true as const }, { version: 1, at: rec.createdAt }]),
    version: vi.fn(async (_id, n) => (n === 1 ? past : null)),
  }
  return createArtifactRoutes({ store, brand, siteUrl: 'https://example.com', publishKey: () => 'k', readCookie: async () => undefined, history: 'everyone' })
}
const wrapped: BrandPack = { ...freedomDefault, id: 'wrapped', Wrapper: ({ children }) => <main data-wrapped>{children}</main> }

async function render(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [name, pack] of [['default', freedomDefault], ['wrapped', wrapped]] as const) {
    const r = routes(pack)
    out[`${name}:page`] = renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: ID }) }))
    out[`${name}:version`] = renderToStaticMarkup(await r.VersionPage({ params: Promise.resolve({ id: ID, n: '1' }) }))
  }
  return out
}

const GOLDEN = join(__dirname, '__golden__', 'default-pages.json')

describe('a pack with no extension points', () => {
  it('renders the page and a past version exactly as 0.15.0 did', async () => {
    const got = await render()
    if (process.env.WRITE_GOLDEN) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n')
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k])
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
  })
})
