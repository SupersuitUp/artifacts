// Voice memos through the routes: who may upload a recording, who may have it transcribed, the
// host with no transcriber (404, so the browser is the floor), the hourly limit, both browsers'
// recording types end to end, the key never reaching an answer, and recordings played back only
// through signed URLs issued beside the comment or note they belong to.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import type { ArtifactAssets } from '../artifacts/assets.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { createMemoryPersonalStore, personalAudioDir } from '../artifacts/personal-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { mergeCommentsState, type CommentsMode } from '../artifacts/comments.js'
import { deepgramTranscriber, type Transcriber } from '../artifacts/transcribe.js'
import { TRANSCRIBE_PER_HOUR } from './voice-routes.js'

const SECRET = 'sekrit'
const KEY = 'svc-key-4b3a29f81c'
const t = '2026-09-28T00:00:00Z'
const page = (id: string, comments: CommentsMode, extra: Partial<ArtifactRecord> = {}): ArtifactRecord => {
  const merged = mergeCommentsState(extra.state, comments, 'readers')
  if (!merged.ok) throw new Error(merged.error)
  return {
    id, title: 'Page', summary: 'S', template: 'document', markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 2, views: 0,
    comments, commentsVisible: 'readers', ...extra, ...(merged.state ? { state: merged.state } : {}),
  }
}
const RECORDS: Record<string, ArtifactRecord> = {
  vany2345: page('vany2345', 'anyone'),
  vsgn2345: page('vsgn2345', 'signed-in'),
  vxff2345: page('vxff2345', 'off'),
}
const sam: Reader = { uid: 'u3', email: 'sam@example.com', name: 'Sam Reader', member: false }
const jo: Reader = { uid: 'u5', email: 'jo@example.com', name: 'Jo Other', member: true }
const grant = (r: Reader) => `${GRANT_COOKIE}=${mintGrant(SECRET, r)}`
const MEMO = 'Zq3xY7abcDEF12345'

function fakeAssets(stored: Map<string, Buffer>) {
  return {
    put: vi.fn(async () => 'https://cdn.example.com/x.png'),
    signAudioUpload: vi.fn(async (id: string, path: string, type: string) => ({ uploadUrl: `https://bucket.example.com/put/${id}/${path}`, headers: { 'content-type': type } })),
    audioSize: vi.fn(async (id: string, path: string) => stored.get(`${id}/${path}`)?.length ?? null),
    readAudio: vi.fn(async (id: string, path: string) => stored.get(`${id}/${path}`) ?? null),
    audioUrl: vi.fn(async (id: string, path: string) => `https://bucket.example.com/get/${id}/${path}?sig=1`),
  } satisfies ArtifactAssets
}

function build(opts: { transcribe?: Transcriber | null } = {}) {
  const stored = new Map<string, Buffer>()
  const state = createMemoryStateStore()
  const personal = createMemoryPersonalStore()
  const assets = fakeAssets(stored)
  const transcribe = opts.transcribe === null ? undefined : (opts.transcribe ?? vi.fn<Transcriber>(async (_b, mime) => ({ text: `heard ${mime}` })))
  const store = { get: vi.fn(async (id: string) => RECORDS[id] ?? null), save: vi.fn(), delete: vi.fn(), bumpViews: vi.fn(async () => {}) } as unknown as ArtifactStore
  const readers = {
    allowList: vi.fn(async () => []), allow: vi.fn(), touchSession: vi.fn(), flag: vi.fn(), sessions: vi.fn(), flags: vi.fn(),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(), acks: vi.fn(),
  } as unknown as ReadersStore
  const routes = createArtifactRoutes({
    store, state, personal, readers, assets, transcribe, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readerSecret: () => SECRET, signInOrigin: 'https://accounts.example.com',
  })
  return { routes, stored, assets, transcribe, state, personal }
}

const upload = (id: string, name: string, body: unknown, cookie?: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/uploads/${name}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
  })
const transcribeReq = (id: string, asset: unknown, cookie?: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/transcribe`, {
    method: 'POST', body: JSON.stringify({ asset }), headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
  })
const nameParams = (id: string, name: string) => ({ params: Promise.resolve({ id, name }) })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('uploading a voice memo', () => {
  it('a reader who may comment gets a signed URL for comments/<memo>, without the publish key', async () => {
    const { routes, assets } = build()
    const r = await routes.UPLOAD(upload('vany2345', `${MEMO}.webm`, { audio: 'comment' }), nameParams('vany2345', `${MEMO}.webm`))
    expect(r.status).toBe(201)
    const b = await r.json()
    expect(b.path).toBe(`comments/${MEMO}.webm`)
    expect(b.uploadUrl).toContain(`comments/${MEMO}.webm`)
    expect(assets.signAudioUpload).toHaveBeenCalledWith('vany2345', `comments/${MEMO}.webm`, 'audio/webm')
  })

  it('iPhone recordings go up as audio/mp4 under .m4a', async () => {
    const { routes, assets } = build()
    const r = await routes.UPLOAD(upload('vany2345', `${MEMO}.m4a`, { audio: 'comment' }), nameParams('vany2345', `${MEMO}.m4a`))
    expect(r.status).toBe(201)
    expect(assets.signAudioUpload).toHaveBeenCalledWith('vany2345', `comments/${MEMO}.m4a`, 'audio/mp4')
  })

  it('refuses a type the page does not take, and a name that is a path', async () => {
    const { routes } = build()
    for (const name of [`${MEMO}.wav`, `${MEMO}.mp4`, `${MEMO}.png`, 'short.webm', '..%2Fx.webm']) {
      const r = await routes.UPLOAD(upload('vany2345', name, { audio: 'comment' }), nameParams('vany2345', name))
      expect(r.status, name).toBe(400)
    }
  })

  it('refuses a reader who may not comment: signed-in-only page while anonymous, comments off, a foreign origin', async () => {
    const { routes } = build()
    expect((await routes.UPLOAD(upload('vsgn2345', `${MEMO}.webm`, { audio: 'comment' }), nameParams('vsgn2345', `${MEMO}.webm`))).status).toBe(401)
    expect((await routes.UPLOAD(upload('vxff2345', `${MEMO}.webm`, { audio: 'comment' }, grant(sam)), nameParams('vxff2345', `${MEMO}.webm`))).status).toBe(403)
    const foreign = new NextRequest(`https://artifacts.example.com/api/artifacts/vany2345/uploads/${MEMO}.webm`, {
      method: 'POST', body: JSON.stringify({ audio: 'comment' }), headers: { origin: 'https://evil.example.net' },
    })
    expect((await routes.UPLOAD(foreign, nameParams('vany2345', `${MEMO}.webm`))).status).toBe(403)
    // And signed in, the signed-in page takes it.
    expect((await routes.UPLOAD(upload('vsgn2345', `${MEMO}.webm`, { audio: 'comment' }, grant(sam)), nameParams('vsgn2345', `${MEMO}.webm`))).status).toBe(201)
  })

  it('a personal recording needs a signed-in reader and lands in their own directory', async () => {
    const { routes } = build()
    const anon = await routes.UPLOAD(upload('vxff2345', `${MEMO}.webm`, { audio: 'personal' }), nameParams('vxff2345', `${MEMO}.webm`))
    expect(anon.status).toBe(401)
    expect((await anon.json()).device).toBe(true)
    const r = await routes.UPLOAD(upload('vxff2345', `${MEMO}.webm`, { audio: 'personal' }, grant(sam)), nameParams('vxff2345', `${MEMO}.webm`))
    expect(r.status).toBe(201)
    expect((await r.json()).path).toBe(`personal/${personalAudioDir(sam.uid)}/${MEMO}.webm`)
  })

  it('done confirms the bytes arrived and are under 4 MB', async () => {
    const { routes, stored } = build()
    const done = () => routes.UPLOAD(upload('vany2345', `${MEMO}.webm`, { audio: 'comment', done: true }), nameParams('vany2345', `${MEMO}.webm`))
    expect((await done()).status).toBe(409)
    stored.set(`vany2345/comments/${MEMO}.webm`, Buffer.alloc(5 * 1024 * 1024))
    expect((await done()).status).toBe(413)
    stored.set(`vany2345/comments/${MEMO}.webm`, Buffer.from('ok'))
    const r = await done()
    expect(r.status).toBe(201)
    expect((await r.json()).path).toBe(`comments/${MEMO}.webm`)
  })

  it('the publisher\'s own upload still needs the publish key', async () => {
    const { routes } = build()
    const r = await routes.UPLOAD(upload('vany2345', 'cover.webp', { digest: '0123abcd' }), nameParams('vany2345', 'cover.webp'))
    expect(r.status).toBe(401)
  })
})

describe('transcribing a voice memo', () => {
  it('answers 404 when the host passed no transcriber, so the browser keeps its own transcript', async () => {
    const { routes } = build({ transcribe: null })
    const r = await routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`), idParams('vany2345'))
    expect(r.status).toBe(404)
  })

  it('sends a comment recording to the host transcriber with the type its extension names, webm and m4a both', async () => {
    const { routes, stored, transcribe } = build()
    stored.set(`vany2345/comments/${MEMO}.webm`, Buffer.from('chrome'))
    stored.set(`vany2345/comments/${MEMO}.m4a`, Buffer.from('iphone'))
    const a = await routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`), idParams('vany2345'))
    expect(a.status).toBe(200)
    expect(await a.json()).toEqual({ text: 'heard audio/webm' })
    const b = await routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.m4a`), idParams('vany2345'))
    expect(await b.json()).toEqual({ text: 'heard audio/mp4' })
    const blob = (transcribe as ReturnType<typeof vi.fn>).mock.calls[1][0] as Blob
    expect(blob.type).toBe('audio/mp4')
    expect(blob.size).toBe('iphone'.length)
  })

  it('refuses a reader who cannot write comments, and a path that is not an uploaded recording', async () => {
    const { routes, stored } = build()
    stored.set(`vsgn2345/comments/${MEMO}.webm`, Buffer.from('x'))
    expect((await routes.TRANSCRIBE(transcribeReq('vsgn2345', `comments/${MEMO}.webm`), idParams('vsgn2345'))).status).toBe(401)
    expect((await routes.TRANSCRIBE(transcribeReq('vxff2345', `comments/${MEMO}.webm`, grant(sam)), idParams('vxff2345'))).status).toBe(403)
    for (const bad of ['cover.png', `comments/../x.webm`, 'https://cdn.example.com/a.webm', 7, null])
      expect((await routes.TRANSCRIBE(transcribeReq('vany2345', bad), idParams('vany2345'))).status, String(bad)).toBe(400)
  })

  it('transcribes a personal recording only for the reader it belongs to', async () => {
    const { routes, stored } = build()
    const path = `personal/${personalAudioDir(sam.uid)}/${MEMO}.webm`
    stored.set(`vxff2345/${path}`, Buffer.from('mine'))
    expect((await routes.TRANSCRIBE(transcribeReq('vxff2345', path), idParams('vxff2345'))).status).toBe(401)
    expect((await routes.TRANSCRIBE(transcribeReq('vxff2345', path, grant(jo)), idParams('vxff2345'))).status).toBe(404)
    expect((await routes.TRANSCRIBE(transcribeReq('vxff2345', path, grant(sam)), idParams('vxff2345'))).status).toBe(200)
  })

  it(`stops at ${TRANSCRIBE_PER_HOUR} an hour per reader per page`, async () => {
    const { routes, stored } = build()
    stored.set(`vany2345/comments/${MEMO}.webm`, Buffer.from('x'))
    for (let i = 0; i < TRANSCRIBE_PER_HOUR; i++)
      expect((await routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`, grant(sam)), idParams('vany2345'))).status).toBe(200)
    expect((await routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`, grant(sam)), idParams('vany2345'))).status).toBe(429)
    // Another reader has their own count.
    expect((await routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`, grant(jo)), idParams('vany2345'))).status).toBe(200)
  })

  it('never answers with the service key, whatever the transcriber threw or the service said', async () => {
    const throwing = build({ transcribe: async () => { throw new Error(`upstream refused Token ${KEY}`) } })
    throwing.stored.set(`vany2345/comments/${MEMO}.webm`, Buffer.from('x'))
    const r1 = await throwing.routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`), idParams('vany2345'))
    expect(r1.status).toBe(502)
    expect(await r1.text()).not.toContain(KEY)

    // The real adapter against a service that echoes the credential in its refusal.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`bad credentials ${KEY}`, { status: 401 })))
    try {
      const real = build({ transcribe: deepgramTranscriber(KEY) })
      real.stored.set(`vany2345/comments/${MEMO}.webm`, Buffer.from('x'))
      const r2 = await real.routes.TRANSCRIBE(transcribeReq('vany2345', `comments/${MEMO}.webm`), idParams('vany2345'))
      expect(r2.status).toBe(502)
      expect(await r2.text()).not.toContain(KEY)
      // And the page a reader loads carries no trace of it.
      const html = renderToStaticMarkup(await real.routes.Page({ params: Promise.resolve({ id: 'vany2345' }), searchParams: Promise.resolve({}) }))
      expect(html).not.toContain(KEY)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('recordings are played through signed URLs beside what they belong to', () => {
  const anchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs north.' }
  const post = (id: string, body: unknown, cookie?: string) =>
    new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
    })

  it('a shared comment with a recording carries a play URL to readers and to the publisher', async () => {
    const { routes } = build()
    const r = await routes.STATE_POST(post('vany2345', { slot: 'comments', op: 'append', value: { anchor, body: '', version: 2, audio: `comments/${MEMO}.webm`, transcript: 'host' } }, grant(sam)), idParams('vany2345'))
    expect(r.status).toBe(200)
    const view = await r.json()
    expect(view.slots.comments.shared[0].audioUrl).toBe(`https://bucket.example.com/get/vany2345/comments/${MEMO}.webm?sig=1`)
    const resp = await routes.RESPONSES(new NextRequest('https://artifacts.example.com/api/artifacts/vany2345/responses', { headers: { authorization: 'Bearer k' } }), idParams('vany2345'))
    expect((await resp.json()).responses[0].audioUrl).toContain(`comments/${MEMO}.webm`)
  })

  it('a comment cannot name a recording that is not a comment\'s: a personal one would be signed for the publisher', async () => {
    const { routes } = build()
    const personal = `personal/${personalAudioDir(sam.uid)}/${MEMO}.webm`
    for (const audio of [personal, `other/${MEMO}.webm`, `${MEMO}.webm`]) {
      const r = await routes.STATE_POST(post('vany2345', { slot: 'comments', op: 'append', value: { anchor, body: 'x', version: 2, audio } }, grant(sam)), idParams('vany2345'))
      expect(r.status, audio).toBe(400)
    }
  })

  it('a personal note names only its own reader\'s recording, and gets a play URL only on /personal', async () => {
    const { routes } = build()
    const mine = `personal/${personalAudioDir(sam.uid)}/${MEMO}.webm`
    const theirs = `personal/${personalAudioDir(jo.uid)}/${MEMO}.webm`
    const note = (audio: string) => new NextRequest('https://artifacts.example.com/api/artifacts/vxff2345/personal', {
      method: 'POST', body: JSON.stringify({ value: { anchor, body: '', version: 2, audio } }), headers: { 'content-type': 'application/json', cookie: grant(sam) },
    })
    expect((await routes.PERSONAL_POST(note(theirs), idParams('vxff2345'))).status).toBe(400)
    expect((await routes.PERSONAL_POST(note(`comments/${MEMO}.webm`), idParams('vxff2345'))).status).toBe(400)
    const r = await routes.PERSONAL_POST(note(mine), idParams('vxff2345'))
    expect(r.status).toBe(200)
    expect((await r.json()).notes[0].audioUrl).toBe(`https://bucket.example.com/get/vxff2345/${mine}?sig=1`)
  })
})
