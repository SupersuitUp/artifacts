// THE PAGE-ASSET GATE (any-file artifacts, 2026-11-11). A markdown page's assets keep the nine types
// whatever a file page may hold. These pin the refusal before the second rule exists, so the rule
// cannot loosen it by accident.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'

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
    it(`${id}: PUT_ASSET and UPLOAD refuse a pdf, an html and an svg with 415, private or not`, async () => {
      for (const name of ['deck.pdf', 'page.html', 'mark.svg']) {
        for (const q of ['', '?private=1']) {
          expect((await r.PUT_ASSET(put(id, name, q), params(id, name))).status, `${name}${q}`).toBe(415)
          expect((await r.UPLOAD(upload(id, name, { digest: '0123abcd' }, q), params(id, name))).status, `${name}${q}`).toBe(415)
        }
      }
    })
  }
})
