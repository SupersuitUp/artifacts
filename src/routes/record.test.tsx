// The recorder's routes (0.74.0): the JSON API the Supersuit skill drives with the publish key,
// the take uploads into private storage, and the owner-only page.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig } from './test-config.js'
import { memoryRecordStore } from '../artifacts/record-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import type { ArtifactAssets } from '../artifacts/assets.js'

const site = 'https://artifacts.example.com'
const RS = 'r'.repeat(40)
const owner: Reader = { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }
const stranger: Reader = { uid: 'u2', email: 'dana@example.com', name: 'Dana', member: true }
const PEOPLE = [{ slug: 'sam', name: 'Sam', note: 'The year.' }, { slug: 'dana-lee', name: 'Dana Lee', note: 'The move.', photo: 'https://cdn.example.com/d.jpg' }]

function setup(o: { who?: Reader | null; assets?: Partial<ArtifactAssets> } = {}) {
  const record = memoryRecordStore()
  const puts: { id: string; name: string; type: string; bytes: number }[] = []
  const assets: Partial<ArtifactAssets> = o.assets ?? {
    async putPrivate(id, name, bytes, type) { puts.push({ id, name, type, bytes: bytes.length }); return `private:${name.replace('.', '.0000abcd.')}` },
    async signPrivateUpload(id, name, digest) { return { uploadUrl: `https://storage.example.com/${id}/${name}?sig=1`, headers: { 'content-type': 'audio/webm' }, url: `private:${name}` } },
    async finishPrivateUpload(id, name, digest) { return digest === 'deadbeef' ? `private:${name.replace('.', `.${digest}.`)}` : null },
    async privateUrl(id, stored) { return `https://storage.example.com/${id}/${stored}?read=1` },
  }
  const who = o.who === undefined ? null : o.who
  const r = createArtifactRoutes(testConfig({
    record, assets: assets as ArtifactAssets, readerSecret: () => RS, ownerEmail: owner.email, signInOrigin: 'https://signin.example.com',
    readCookie: async (n: string) => (who && n === GRANT_COOKIE ? mintGrant(RS, who) : undefined),
  }))
  return { r, record, puts }
}
const key = { authorization: 'Bearer test-key' }
const req = (path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) =>
  new NextRequest(`${site}${path}`, {
    method: init.method ?? 'GET',
    ...(init.raw !== undefined ? { body: init.raw } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
  })
const P = (o: Record<string, string>) => ({ params: Promise.resolve(o) }) as never

describe('the batch API, with the publish key', () => {
  it('creates a batch and answers its recorder page', async () => {
    const { r } = setup()
    const res = await r.RECORD(req('/api/record', { method: 'POST', body: { title: 'Thanksgiving', music: 'https://cdn.example.com/bed.mp3', people: PEOPLE }, headers: key }))
    expect(res.status).toBe(201)
    const { batch, url } = await res.json()
    expect(url).toBe(`${site}/record/${batch.id}`)
    expect(batch.order).toEqual(['sam', 'dana-lee'])
    expect(batch.entries.sam).toMatchObject({ name: 'Sam', status: 'waiting' })
  })
  it('refuses a bad batch in words', async () => {
    const { r } = setup()
    const res = await r.RECORD(req('/api/record', { method: 'POST', body: { people: [] }, headers: key }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('people')
  })
  it('lists the batch with where the recorder resumes, reads one person, sets timings, marks built', async () => {
    const { r, record } = setup()
    const b = await record.create({ title: 'T', people: PEOPLE })
    await record.setTake(b.id, 'sam', { kind: 'raw', path: 'private:sam-raw.webm' })
    const list = await (await r.RECORD_BATCH(req(`/api/record/${b.id}`, { headers: key }), P({ batch: b.id }))).json()
    expect(list.next).toBe(1)
    expect(Object.keys(list.batch.entries)).toEqual(['sam', 'dana-lee'])
    const one = await (await r.RECORD_ENTRY(req(`/api/record/${b.id}/sam`, { headers: key }), P({ batch: b.id, slug: 'sam' }))).json()
    expect(one.entry.raw).toBe('private:sam-raw.webm')
    const t = await r.RECORD_ENTRY(req(`/api/record/${b.id}/sam`, { method: 'PATCH', body: { timings: [{ w: 'Dear', s: 4, e: 4.3 }, { w: 'Sam,', s: 4.4, e: 4.9, br: 1 }] }, headers: key }), P({ batch: b.id, slug: 'sam' }))
    expect(t.status).toBe(200)
    expect((await t.json()).entry.timings).toHaveLength(2)
    const built = await r.RECORD_ENTRY(req(`/api/record/${b.id}/sam`, { method: 'PATCH', body: { built: { pageId: 'card2345' } }, headers: key }), P({ batch: b.id, slug: 'sam' }))
    expect((await built.json()).entry).toMatchObject({ status: 'built', pageId: 'card2345' })
  })
  it('refuses timings in a bad shape, and before there is a take', async () => {
    const { r, record } = setup()
    const b = await record.create({ title: 'T', people: PEOPLE })
    const bad = await r.RECORD_ENTRY(req(`/api/record/${b.id}/sam`, { method: 'PATCH', body: { timings: [{ t: 1 }] }, headers: key }), P({ batch: b.id, slug: 'sam' }))
    expect(bad.status).toBe(400)
    const early = await r.RECORD_ENTRY(req(`/api/record/${b.id}/sam`, { method: 'PATCH', body: { timings: [{ w: 'Hi', s: 1, e: 2 }] }, headers: key }), P({ batch: b.id, slug: 'sam' }))
    expect(early.status).toBe(409)
    expect((await early.json()).error).toContain('no take')
  })
  it('answers 404 for a batch or a person that is not there', async () => {
    const { r } = setup()
    expect((await r.RECORD_BATCH(req('/api/record/zzzzzzzzzz', { headers: key }), P({ batch: 'zzzzzzzzzz' }))).status).toBe(404)
    expect((await r.RECORD_ENTRY(req('/api/record/zzzzzzzzzz/sam', { headers: key }), P({ batch: 'zzzzzzzzzz', slug: 'sam' }))).status).toBe(404)
  })
})

describe('owner only', () => {
  it('no key and no owner: 401; a signed-in stranger: 403; nothing is created', async () => {
    const { r, record } = setup()
    const b = await record.create({ title: 'T', people: PEOPLE })
    expect((await r.RECORD(req('/api/record', { method: 'POST', body: { people: PEOPLE } }))).status).toBe(401)
    expect((await r.RECORD_BATCH(req(`/api/record/${b.id}`), P({ batch: b.id }))).status).toBe(401)
    const cookie = { cookie: `${GRANT_COOKIE}=${mintGrant(RS, stranger)}` }
    expect((await r.RECORD_BATCH(req(`/api/record/${b.id}`, { headers: cookie }), P({ batch: b.id }))).status).toBe(403)
    expect((await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/webm', digest: 'deadbeef' }, headers: cookie }), P({ batch: b.id, slug: 'sam' }))).status).toBe(403)
  })
  it('the owner signed in may use it from this hub\'s own pages, and never from another site', async () => {
    const { r, record } = setup()
    const b = await record.create({ title: 'T', people: PEOPLE })
    const cookie = `${GRANT_COOKIE}=${mintGrant(RS, owner)}`
    expect((await r.RECORD_BATCH(req(`/api/record/${b.id}`, { headers: { cookie } }), P({ batch: b.id }))).status).toBe(200)
    const own = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/webm', digest: 'deadbeef' }, headers: { cookie, origin: site } }), P({ batch: b.id, slug: 'sam' }))
    expect(own.status).toBe(201)
    const foreign = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/webm', digest: 'deadbeef' }, headers: { cookie, origin: 'https://evil.example.com' } }), P({ batch: b.id, slug: 'sam' }))
    expect(foreign.status).toBe(403)
  })
  it('the recorder page: the owner gets the recorder at the first person with no take; anyone else never sees the batch', async () => {
    const page = async (who: Reader | null, setupFirst?: (s: ReturnType<typeof setup>, id: string) => Promise<void>) => {
      const s = setup({ who })
      const b = await s.record.create({ title: 'Thanksgiving', people: PEOPLE })
      await setupFirst?.(s, b.id)
      return renderToStaticMarkup(await s.r.RecordPage({ params: Promise.resolve({ batch: b.id }) }))
    }
    const mine = await page(owner, async (s, id) => { await s.record.setTake(id, 'sam', { kind: 'raw', path: 'private:a.webm' }) })
    expect(mine).toContain('data-recorder-person="dana-lee"')
    expect(mine).toContain('1 of 2 recorded')
    const out = await page(null)
    expect(out).toContain('Sign in as this hub&#x27;s owner to record.')
    // Issue #17: the door's button says what the owner is about to do.
    expect(out).toMatch(/>Sign in to record<\/a>/)
    expect(out).not.toContain('Sign in to read')
    expect(out).not.toContain('data-recorder-person')
    expect(out).not.toContain('The year.')
    const theirs = await page(stranger)
    expect(theirs).toContain('Only the owner of this hub records here.')
    expect(theirs).not.toContain('The move.')
  })
})

describe('takes go to private storage', () => {
  it('a signed upload, then done: the entry keeps the private path, the type and the length', async () => {
    const { r, record } = setup()
    const b = await record.create({ title: 'T', people: PEOPLE })
    const at = P({ batch: b.id, slug: 'sam' })
    const signed = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/webm;codecs=opus', digest: 'deadbeef' }, headers: key }), at)
    expect(signed.status).toBe(201)
    expect((await signed.json()).uploadUrl).toBe(`https://storage.example.com/record-${b.id}/sam-raw.webm?sig=1`)
    const done = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/webm', digest: 'deadbeef', done: true, seconds: 21.437 }, headers: key }), at)
    expect((await done.json()).entry).toMatchObject({ status: 'recorded', raw: 'private:sam-raw.deadbeef.webm', mime: 'audio/webm', seconds: 21.44 })
    const mixed = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'mixed', type: 'audio/wav', digest: 'deadbeef', done: true, voiceDelay: 4 }, headers: key }), at)
    expect((await mixed.json()).entry).toMatchObject({ mixed: 'private:sam-mixed.deadbeef.wav', voiceDelay: 4 })
    const nothing = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/webm', digest: '00000000', done: true }, headers: key }), at)
    expect(nothing.status).toBe(409)
  })
  it('the bytes through the route where the host cannot sign, and a read back by signed URL', async () => {
    const noSign = setup({ assets: {
      async putPrivate(id, name) { return `private:${name}` },
      async privateUrl(id, stored) { return `https://storage.example.com/${id}/${stored}?read=1` },
    } })
    const b = await noSign.record.create({ title: 'T', people: PEOPLE })
    const at = P({ batch: b.id, slug: 'sam' })
    expect((await noSign.r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'audio/mp4', digest: 'deadbeef' }, headers: key }), at)).status).toBe(501)
    const put = await noSign.r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take?kind=raw&type=audio/mp4&seconds=12`, { method: 'PUT', raw: new Uint8Array([1, 2, 3]), headers: key }), at)
    expect((await put.json()).entry).toMatchObject({ raw: 'private:sam-raw.m4a', mime: 'audio/mp4', seconds: 12 })
    const read = await noSign.r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take?kind=raw`, { headers: key }), at)
    expect(read.status).toBe(302)
    expect(read.headers.get('location')).toBe(`https://storage.example.com/record-${b.id}/sam-raw.m4a?read=1`)
  })
  it('refuses a type the page cannot keep', async () => {
    const { r, record } = setup()
    const b = await record.create({ title: 'T', people: PEOPLE })
    const res = await r.RECORD_TAKE(req(`/api/record/${b.id}/sam/take`, { method: 'POST', body: { kind: 'raw', type: 'video/mp4', digest: 'deadbeef' }, headers: key }), P({ batch: b.id, slug: 'sam' }))
    expect(res.status).toBe(400)
  })
  it('a host with no recorder store answers 501', async () => {
    const r = createArtifactRoutes(testConfig({}))
    expect((await r.RECORD(req('/api/record', { method: 'POST', body: { people: PEOPLE }, headers: key }))).status).toBe(501)
  })
})
