import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))

const auth = { authorization: 'Bearer test-key' }
const params = { params: Promise.resolve({ id: 'abcd2345', name: 'river.mp4' }) }
const put = (query = '?private=1', headers: Record<string, string> = auth) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/abcd2345/assets/river.mp4${query}`, { method: 'PUT', body: 'v', headers })
const upload = (body: unknown, query = '?private=1') =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/abcd2345/uploads/river.mp4${query}`, { method: 'POST', body: JSON.stringify(body), headers: { ...auth, 'content-type': 'application/json' } })

describe('private uploads', () => {
  it('PUT ?private=1 goes to putPrivate and answers 201 with the private ref', async () => {
    const stored: string[] = []
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => 'https://public.example.com/x', putPrivate: async (_id, name) => { stored.push(name); return `private:${name}` } } }))
    const res = await r.PUT_ASSET(put(), params)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'abcd2345', name: 'river.mp4', url: 'private:river.mp4' })
    expect(stored).toEqual(['river.mp4'])
  })
  it('PUT without ?private=1 still answers the public url', async () => {
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => 'https://public.example.com/x', putPrivate: async () => 'private:x' } }))
    const res = await r.PUT_ASSET(put(''), params)
    expect((await res.json()).url).toBe('https://public.example.com/x')
  })
  it('a host with no private store answers 501', async () => {
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => 'https://public.example.com/x' } }))
    expect((await r.PUT_ASSET(put(), params)).status).toBe(501)
  })
  it('UPLOAD ?private=1 signs to the private key and answers 201 with the private ref', async () => {
    const sign = vi.fn(async (_id: string, _name: string, digest: string) => ({ uploadUrl: 'https://signed.example.com/put', headers: { 'content-type': 'video/mp4' }, url: `private:river.${digest}.mp4` }))
    const publicSign = vi.fn(async () => ({ uploadUrl: 'x', headers: {}, url: 'x' }))
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => 'x', signUpload: publicSign, finishUpload: async () => 'x', signPrivateUpload: sign, finishPrivateUpload: async () => null } }))
    const res = await r.UPLOAD(upload({ digest: '0123abcd' }), params)
    expect(res.status).toBe(201)
    expect((await res.json()).url).toBe('private:river.0123abcd.mp4')
    expect(sign).toHaveBeenCalledOnce()
    expect(publicSign).not.toHaveBeenCalled()
  })
  it('UPLOAD ?private=1 done answers the private ref, or 409 when nothing arrived', async () => {
    const finish = vi.fn(async (_id: string, _name: string, digest: string) => (digest === '0123abcd' ? `private:river.${digest}.mp4` : null))
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => 'x', signPrivateUpload: async () => ({ uploadUrl: 'u', headers: {}, url: 'p' }), finishPrivateUpload: finish } }))
    const ok = await r.UPLOAD(upload({ digest: '0123abcd', done: true }), params)
    expect(ok.status).toBe(201)
    expect((await ok.json()).url).toBe('private:river.0123abcd.mp4')
    expect((await r.UPLOAD(upload({ digest: '99999999', done: true }), params)).status).toBe(409)
  })
  it('UPLOAD ?private=1 on a host with no private store answers 501', async () => {
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => 'x', signUpload: async () => ({ uploadUrl: 'u', headers: {}, url: 'p' }), finishUpload: async () => 'x' } }))
    expect((await r.UPLOAD(upload({ digest: '0123abcd' }), params)).status).toBe(501)
  })
})

// Fail closed: with no private store, a `media: private` page would have its media in the public
// bucket, so it is refused at publish, in words that say what to configure.
describe('publishing media: private', () => {
  const source = (extra = 'media: private\n') => `---\ntitle: The river\nsummary: Eleven minutes.\nlinks: per-reader\n${extra}---\n![sound: river](private:river.0123abcd.mp4)\n`
  const post = (body: string, query = '') =>
    new NextRequest(`https://artifacts.example.com/api/artifacts${query}`, { method: 'POST', body, headers: auth })
  const storeWith = (pages: Parameters<typeof memoryArtifactStore>[0] = []) => {
    const save = vi.fn(async (input: { id?: string }) => ({ id: input.id ?? 'abcd2345', version: 1, created: !input.id }))
    return { save, store: { ...memoryArtifactStore(pages), save } as never }
  }
  it('is refused with 501 and nothing saved on a host with no private store', async () => {
    const { save, store } = storeWith()
    const r = createArtifactRoutes(testConfig({ store, assets: { put: async () => 'x' } }))
    const res = await r.POST(post(source()))
    expect(res.status).toBe(501)
    expect((await res.json()).error).toMatch(/no private store.*privateBucket/)
    expect(save).not.toHaveBeenCalled()
  })
  it('is refused too when the file drops the line but the stored page already keeps private media', async () => {
    const { save, store } = storeWith([{ id: 'abcd2345', links: 'per-reader', privateMedia: true }])
    const r = createArtifactRoutes(testConfig({ store, assets: { put: async () => 'x' } }))
    expect((await r.POST(post(source(''), '?id=abcd2345'))).status).toBe(501)
    expect(save).not.toHaveBeenCalled()
  })
  it('publishes on a host with a private store', async () => {
    const { save, store } = storeWith()
    const r = createArtifactRoutes(testConfig({ store, assets: { put: async () => 'x', putPrivate: async () => 'private:x', privateUrl: async () => 'https://signed.example.com/x' } }))
    expect((await r.POST(post(source()))).status).toBe(201)
    expect(save).toHaveBeenCalledOnce()
  })
  it('a page without private media publishes on a host with no private store', async () => {
    const { save, store } = storeWith()
    const r = createArtifactRoutes(testConfig({ store, assets: { put: async () => 'x' } }))
    expect((await r.POST(post(source('')))).status).toBe(201)
    expect(save).toHaveBeenCalledOnce()
  })
})
