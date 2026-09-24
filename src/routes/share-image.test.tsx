// @vitest-environment node
// The PNG encode runs outside jsdom: sharp refuses a typed array from jsdom's realm.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache.js', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation.js', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server.js'
import { readFile } from 'node:fs/promises'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'

const rec: ArtifactRecord = {
  id: 'abc23456', title: 'A title long enough to wrap onto a second line of the card', summary: 'S', template: 'document', markdown: '# hi',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', versions: [], views: 0,
}
const store: ArtifactStore = {
  get: vi.fn(async (id) => (id === 'abc23456' ? rec : null)),
  save: vi.fn(async () => ({ id: 'abc23456', version: 1, created: true })),
  delete: vi.fn(async () => true),
  bumpViews: vi.fn(async () => {}),
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('SHARE_IMAGE', () => {
  it('the Freedom default pack draws a card with no backdrop and its own bundled font', async () => {
    const r = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k' })
    const res = await r.SHARE_IMAGE(new NextRequest('http://x/abc23456/share.png?v=1'), params('abc23456'))
    expect(res.status).toBe(200)
    const png = Buffer.from(await res.arrayBuffer())
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  })
  it('renders a 1200x630 PNG title card from the pack font, cached by version', async () => {
    const ttf = await readFile('fonts/Newsreader-600.ttf')
    const font = vi.fn(async () => ({ name: 'Custom', data: ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength), weight: 600 }))
    const r = createArtifactRoutes({ store, brand: { ...freedomDefault, share: { font } }, siteUrl: 'https://example.com', publishKey: () => 'k' })
    const res = await r.SHARE_IMAGE(new NextRequest('http://x/abc23456/share.png?v=1'), params('abc23456'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('s-maxage')
    const png = Buffer.from(await res.arrayBuffer())
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    // IHDR: width at bytes 16..20, height at 20..24
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    // The font is loaded once per instance, not once per request.
    await r.SHARE_IMAGE(new NextRequest('http://x/abc23456/share.png?v=1'), params('abc23456'))
    expect(font).toHaveBeenCalledTimes(1)
  })
})
