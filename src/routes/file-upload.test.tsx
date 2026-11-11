// THE PAGE-ASSET GATE (any-file artifacts, 2026-11-11). A markdown page's assets keep the nine types
// whatever a file page may hold. These pin the refusal before the second rule exists, so the rule
// cannot loosen it by accident.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import type { ArtifactRecord, ArtifactStore, SaveInput } from '../artifacts/store.js'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))

const auth = { authorization: 'Bearer test-key' }
const site = 'https://artifacts.example.com'
const params = (id: string, name: string) => ({ params: Promise.resolve({ id, name }) })
const put = (id: string, name: string, query = '') => new NextRequest(`${site}/api/artifacts/${id}/assets/${name}${query}`, { method: 'PUT', body: 'x', headers: auth })
const upload = (id: string, name: string, body: unknown, query = '') =>
  new NextRequest(`${site}/api/artifacts/${id}/uploads/${name}${query}`, { method: 'POST', body: JSON.stringify(body), headers: { ...auth, 'content-type': 'application/json' } })
const assets = {
  put: async () => 'https://public.example.com/x',
  putPrivate: async (_i: string, n: string) => `private:${n}`,
  signUpload: async () => ({ uploadUrl: 'u', headers: {}, url: 'p' }),
  finishUpload: async () => 'p',
  signPrivateUpload: async (_i: string, n: string, d: string) => ({ uploadUrl: 'u', headers: {}, url: `private:${n}.${d}` }),
  finishPrivateUpload: async () => 'private:x',
  privateUrl: async () => 'https://signed.example.com/x',
}

describe('a markdown page keeps the nine asset types', () => {
  const store = memoryArtifactStore([{ id: 'dkcm2345', template: 'document' }, { id: 'bcst2345', template: 'broadcast', links: 'per-reader' }])
  const r = createArtifactRoutes(testConfig({ store, assets: assets as never }))
  for (const id of ['dkcm2345', 'bcst2345']) {
    it(`${id}: PUT_ASSET and UPLOAD refuse a pdf, an html, an svg and an inherited-property name with 415, private or not`, async () => {
      for (const name of ['deck.pdf', 'page.html', 'mark.svg', 'x.constructor', 'x.toString']) {
        for (const q of ['', '?private=1']) {
          expect((await r.PUT_ASSET(put(id, name, q), params(id, name))).status, `${name}${q}`).toBe(415)
          expect((await r.UPLOAD(upload(id, name, { digest: '0123abcd' }, q), params(id, name))).status, `${name}${q}`).toBe(415)
        }
      }
    })
  }
})

describe('the body of a file page: any type, private, with its own content type', () => {
  const FILE = { id: 'fkpg2345', template: 'file' as const, links: 'per-reader' as const, privateMedia: true as const,
    file: { name: 'Pricing.xlsx', bytes: 9, source: 'documents/Pricing.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
  const store = memoryArtifactStore([FILE, { id: 'dkcm2345', template: 'document' }])
  it('PUT ?private=1&file=1 stores an xlsx with its own type', async () => {
    const seen: string[] = []
    const r = createArtifactRoutes(testConfig({ store, assets: { ...assets, putPrivate: async (_i: string, n: string, _b: Buffer, t: string) => { seen.push(t); return `private:${n}` } } as never }))
    const res = await r.PUT_ASSET(put('fkpg2345', 'Pricing.xlsx', '?private=1&file=1'), params('fkpg2345', 'Pricing.xlsx'))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ url: 'private:Pricing.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(seen).toEqual(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
  })
  it('UPLOAD ?private=1&file=1 signs an html file as text/html, to the private key', async () => {
    const sign = vi.fn(async (_i: string, n: string, d: string, t: string) => ({ uploadUrl: 'u', headers: { 'content-type': t }, url: `private:${n}.${d}` }))
    const r = createArtifactRoutes(testConfig({ store, assets: { ...assets, signPrivateUpload: sign } as never }))
    const res = await r.UPLOAD(upload('fkpg2345', 'page.html', { digest: '0123abcd' }, '?private=1&file=1'), params('fkpg2345', 'page.html'))
    expect(res.status).toBe(201)
    expect(sign).toHaveBeenCalledWith('fkpg2345', 'page.html', '0123abcd', 'text/html')
  })
  it('file=1 is refused on a markdown page (409) and without private=1 (400)', async () => {
    const r = createArtifactRoutes(testConfig({ store, assets: assets as never }))
    expect((await r.PUT_ASSET(put('dkcm2345', 'a.pdf', '?private=1&file=1'), params('dkcm2345', 'a.pdf'))).status).toBe(409)
    expect((await r.UPLOAD(upload('dkcm2345', 'a.pdf', { digest: '0123abcd' }, '?private=1&file=1'), params('dkcm2345', 'a.pdf'))).status).toBe(409)
    expect((await r.PUT_ASSET(put('fkpg2345', 'a.pdf', '?file=1'), params('fkpg2345', 'a.pdf'))).status).toBe(400)
    expect((await r.UPLOAD(upload('fkpg2345', 'a.pdf', { digest: '0123abcd' }, '?file=1'), params('fkpg2345', 'a.pdf'))).status).toBe(400)
  })
  it("a file page's other assets (no file=1) still keep the nine types", async () => {
    const r = createArtifactRoutes(testConfig({ store, assets: assets as never }))
    expect((await r.PUT_ASSET(put('fkpg2345', 'a.pdf', '?private=1'), params('fkpg2345', 'a.pdf'))).status).toBe(415)
  })
})

describe('the publish path Supersuit uses for a file page', () => {
  it('POST a front-matter-only file page, then amend it with the ref; the stored record keeps the ref', async () => {
    const base = memoryArtifactStore()
    // A store that saves what POST parses, as the Firestore one does, with the file record kept whole.
    const save: ArtifactStore['save'] = async (input: SaveInput) => {
      const prev = input.id ? base.pages.get(input.id) : undefined
      if (input.id && !prev) return { notFound: true }
      const id = input.id ?? 'fkpg3456'
      const { title, summary, template, links, privateMedia, file } = input.meta
      base.pages.set(id, { ...(prev ?? {}), id, title, summary, template, markdown: input.markdown, links, privateMedia, file } as ArtifactRecord)
      return { id, version: 1, created: !prev }
    }
    const store = Object.assign(base, { save })
    const r = createArtifactRoutes(testConfig({ store, assets: assets as never }))
    const fm = (ref: string) => `---\ntitle: a.pdf\nsummary: A file.\ntemplate: file\nfile: {"name":"a.pdf","bytes":1,"source":"documents/a.pdf"${ref}}\n---\n`
    const post = (q: string, md: string) => new NextRequest(`${site}/api/artifacts${q}`, { method: 'POST', body: md, headers: { ...auth, 'content-type': 'text/markdown' } })
    const first = await r.POST(post('', fm('')))
    expect(first.status, await first.clone().text()).toBeLessThan(300)
    const { id } = await first.json()
    expect(id).toBeTruthy()
    const second = await r.POST(post(`?id=${id}&amend=1`, fm(',"ref":"private:a.0123abcd.pdf"')))
    expect(second.status, await second.clone().text()).toBeLessThan(300)
    expect(((await store.get(id)) as { file?: { ref?: string } }).file?.ref).toBe('private:a.0123abcd.pdf')
  })
})
