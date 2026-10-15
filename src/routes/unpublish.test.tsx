// Unpublishing takes a page off the web and keeps everything that happened on it: every version,
// every comment, every file. DELETE is the separate, explicit act that destroys.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { memoryArtifactStore, testConfig } from './test-config.js'
import type { ArtifactRecord } from '../artifacts/store.js'

const ID = 'abcd2345'
const auth = { authorization: 'Bearer test-key' }
const post = (q: string, body = '') => new NextRequest(`https://artifacts.example.com/api/artifacts?${q}`, { method: 'POST', headers: { ...auth, 'content-type': 'text/markdown' }, body })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const page = (r: ReturnType<typeof createArtifactRoutes>) => r.Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) })

/** The memory store with the two writes unpublishing needs: the mark, and a save that clears it. */
function storeWith(pages: Partial<ArtifactRecord>[]) {
  const s = memoryArtifactStore(pages)
  return Object.assign(s, {
    setUnpublished: vi.fn(async (id: string, at: string | null) => {
      const a = s.pages.get(id)
      if (!a) return false
      if (at) a.unpublishedAt = at
      else delete a.unpublishedAt
      return true
    }),
    save: vi.fn(async ({ id }: { id?: string }) => {
      const a = s.pages.get(id!)
      if (!a) return { notFound: true as const }
      delete a.unpublishedAt
      return { id: id!, version: 2, created: false }
    }),
  })
}

describe('POST ?unpublish=1 takes a page down and keeps its record', () => {
  it('marks the page, keeps the record, and readers get nothing', async () => {
    const store = storeWith([{ id: ID, views: 0 }])
    const routes = createArtifactRoutes(testConfig({ store }))
    const r = await routes.POST(post(`id=${ID}&unpublish=1`))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j).toMatchObject({ id: ID, unpublished: true })
    expect(typeof j.at).toBe('string')
    expect(store.pages.get(ID)?.unpublishedAt).toBe(j.at)
    expect(store.pages.has(ID)).toBe(true)
    await expect(page(routes)).rejects.toThrow('NOT_FOUND')
  })

  it('refuses without an id, and 404s an id that was never a page', async () => {
    const store = storeWith([{ id: ID, views: 0 }])
    const routes = createArtifactRoutes(testConfig({ store }))
    expect((await routes.POST(post('unpublish=1'))).status).toBe(400)
    expect((await routes.POST(post('id=zzzz2345&unpublish=1'))).status).toBe(404)
  })

  it('needs the publish key', async () => {
    const store = storeWith([{ id: ID, views: 0 }])
    const routes = createArtifactRoutes(testConfig({ store }))
    const r = await routes.POST(new NextRequest(`https://artifacts.example.com/api/artifacts?id=${ID}&unpublish=1`, { method: 'POST' }))
    expect(r.status).toBe(401)
    expect(store.pages.get(ID)?.unpublishedAt).toBeUndefined()
  })

  it('answers 501 on a store that cannot keep a page unpublished, and destroys nothing', async () => {
    const store = memoryArtifactStore([{ id: ID, views: 0 }])
    const routes = createArtifactRoutes(testConfig({ store }))
    expect((await routes.POST(post(`id=${ID}&unpublish=1`))).status).toBe(501)
    expect(store.pages.has(ID)).toBe(true)
  })

  it('a republish to the same id puts the page back', async () => {
    const store = storeWith([{ id: ID, views: 0, unpublishedAt: '2026-10-15T00:00:00.000Z' }])
    const routes = createArtifactRoutes(testConfig({ store }))
    const r = await routes.POST(post(`id=${ID}`, '---\ntitle: Back\nsummary: Again\n---\nbody'))
    expect(r.status).toBe(200)
    expect(store.pages.get(ID)?.unpublishedAt).toBeUndefined()
  })

  it('the publisher can still reach an unpublished page; DELETE still destroys it', async () => {
    const store = storeWith([{ id: ID, views: 0, unpublishedAt: '2026-10-15T00:00:00.000Z' }])
    const routes = createArtifactRoutes(testConfig({ store }))
    expect((await routes.GET(new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}`, { headers: auth }), params(ID))).status).toBe(200)
    const d = await routes.DELETE(new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}`, { method: 'DELETE', headers: auth }), params(ID))
    expect(d.status).toBe(200)
    expect(store.pages.has(ID)).toBe(false)
  })
})
