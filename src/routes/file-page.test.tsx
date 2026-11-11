import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'

const site = 'https://artifacts.example.com'
const auth = { authorization: 'Bearer test-key' }
const FILE = { id: 'fkpg2345', template: 'file' as const, title: 'Pricing model', summary: 'A file.', links: 'per-reader' as const, privateMedia: true as const,
  file: { name: 'Pricing model.pdf', bytes: 2400000, source: 'documents/pricing.pdf', type: 'application/pdf', ref: 'private:Pricing-model.0123abcd.pdf' } }
const privateStore = { put: async () => 'x', putPrivate: async () => 'private:x', privateUrl: async () => 'https://signed.example.com/x' }

describe('a file page on the publish route', () => {
  it('stays a file page: a document posted at its id is refused with 409, and so is a file posted at a document', async () => {
    const save = vi.fn()
    const store = { ...memoryArtifactStore([FILE, { id: 'dkcm2345', template: 'document' }]), save } as never
    const r = createArtifactRoutes(testConfig({ store, assets: privateStore as never }))
    const asDoc = await r.POST(new NextRequest(`${site}/api/artifacts?id=fkpg2345`, { method: 'POST', body: '---\ntitle: T\nsummary: S\n---\nBody\n', headers: auth }))
    expect(asDoc.status).toBe(409)
    const asFile = await r.POST(new NextRequest(`${site}/api/artifacts?id=dkcm2345`, { method: 'POST',
      body: `---\ntitle: T\nsummary: S\ntemplate: file\nfile: ${JSON.stringify({ name: 'a.pdf', bytes: 1, source: 's' })}\n---\n`, headers: auth }))
    expect(asFile.status).toBe(409)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('LIST ?kind=file', () => {
  it('lists file pages with the workspace path and the file, newest first, and no document', async () => {
    const recipients = memoryRecipientsStore()
    await recipients.add('fkpg2345', [{ label: 'Dana' }])
    const r = createArtifactRoutes(testConfig({ store: memoryArtifactStore([FILE, { id: 'dkcm2345', template: 'document' }]), recipients }))
    const res = await r.LIST(new NextRequest(`${site}/api/artifacts?kind=file`, { headers: auth }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pages.map((p: { id: string }) => p.id)).toEqual(['fkpg2345'])
    expect(body.pages[0]).toMatchObject({ source: 'documents/pricing.pdf', file: { name: 'Pricing model.pdf', type: 'application/pdf', bytes: 2400000 }, readerLinks: 1 })
  })
})
