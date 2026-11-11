import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { ridSig } from '../artifacts/recipients.js'

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

const S = 's'.repeat(40)
const props = (id: string, r?: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(r ? { r } : {}) })
async function fileRoutes(file: typeof FILE.file) {
  const recipients = memoryRecipientsStore()
  const [dana] = await recipients.add('fkpg2345', [{ label: 'Dana' }])
  const signer = vi.fn(async (_i: string, s: string, o?: { download?: string }) => `https://signed.example.com/${s}${o?.download ? '?dl=1' : ''}`)
  const r = createArtifactRoutes(testConfig({ store: memoryArtifactStore([{ ...FILE, file }]), recipients, recipientSecret: () => S, owner: 'Gary',
    assets: { put: async () => '', privateUrl: signer } as never }))
  return { r, recipients, dana, link: `${dana.rid}.${ridSig(S, 'fkpg2345', dana.rid)}` }
}

describe('the file page a reader opens', () => {
  it('a PDF: title, For Dana, the box, the viewer, Open the PDF and Download', async () => {
    const { r, link } = await fileRoutes(FILE.file)
    const html = renderToStaticMarkup(await r.Page(props('fkpg2345', link)))
    expect(html).toContain('A file from Gary')
    expect(html).toContain('Pricing model')
    expect(html).toContain('For Dana. This link is yours alone.')
    expect(html).toContain('data-file-card')
    expect(html).toContain('2.4 MB')
    expect(html).toContain('<object')
    expect(html).toContain('Open the PDF')
    expect(html).toContain('href="https://signed.example.com/Pricing-model.0123abcd.pdf?dl=1"')
    expect(html).not.toMatch(/pages/)
  })
  it('a spreadsheet: Download only, and the sentence saying why', async () => {
    const { r, link } = await fileRoutes({ name: 'model.xlsx', bytes: 180000, source: 's', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ref: 'private:model.0123abcd.xlsx' })
    const html = renderToStaticMarkup(await r.Page(props('fkpg2345', link)))
    expect(html).toContain('Spreadsheet')
    expect(html).toContain('A browser cannot open a spreadsheet, so the link gives the file itself.')
    expect(html).not.toContain('<object')
    expect(html).not.toContain('<iframe')
  })
  it('an html or svg file is never shown in place', async () => {
    for (const [name, stored] of [['page.html', 'page.0123abcd.html'], ['mark.svg', 'mark.0123abcd.svg']]) {
      const { r, link } = await fileRoutes({ name, bytes: 10, source: 's', type: 'x', ref: `private:${stored}` })
      const html = renderToStaticMarkup(await r.Page(props('fkpg2345', link)))
      expect(html, name).not.toMatch(/<object|<iframe|<img data-file|<video|<audio/)
      expect(html).toContain(`https://signed.example.com/${stored}?dl=1`)
    }
  })
  it('before the file arrives, it says so', async () => {
    const { r, link } = await fileRoutes({ name: 'x.pdf', bytes: 1, source: 's', type: 'application/pdf' })
    expect(renderToStaticMarkup(await r.Page(props('fkpg2345', link)))).toContain('The file is still on its way. Open this link again in a minute.')
  })
  it('a shut reader gets the shut page and no signed link', async () => {
    const { r, recipients, dana, link } = await fileRoutes(FILE.file)
    await recipients.revoke('fkpg2345', [dana.rid])
    const html = renderToStaticMarkup(await r.Page(props('fkpg2345', link)))
    expect(html).not.toContain('signed.example.com')
    expect(html).not.toContain('data-file-card')
  })
})
