// A broadcast is its own page kind (`template: broadcast`), not a document with extra flags: one
// message card (the sender's words, the media, the reader's own note), per-reader links and
// private media by nature, comments off and no narration by default, a 90-day life unless kept,
// and a list of its own. Documents render and list exactly as before.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes, BROADCAST_TTL_MS } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { ridSig, ridCookieName } from '../artifacts/recipients.js'
import { GRANT_COOKIE, mintGrant } from '../artifacts/reader.js'
import { UNAVAILABLE, NO_LINK } from './per-reader.js'
import type { ArtifactRecord, ArtifactStore, SaveInput } from '../artifacts/store.js'

const S = 's'.repeat(40)
const ID = 'bcst2345'
const site = 'https://artifacts.example.com'

describe('front matter: template: broadcast', () => {
  const src = (fm: string, body = 'Hello from the lake.') => `---\ntitle: At the lake\nsummary: A short one\ntemplate: broadcast\n${fm}---\n${body}\n`
  it('is its own kind, and implies per-reader links', () => {
    const r = parseArtifactSource(src(''))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.template).toBe('broadcast')
    expect(r.meta.links).toBe('per-reader')
    expect(r.meta.privateMedia).toBeUndefined()
  })
  it('implies private media wherever it carries media', () => {
    const r = parseArtifactSource(src('', '![sound: The lake](private:lake-1234abcd.mp4)'))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.privateMedia).toBe(true)
    const said = parseArtifactSource(src('links: per-reader\nmedia: private\n', '![A photo](lake.jpg)'))
    expect(said.ok && said.meta.privateMedia).toBe(true)
  })
  it('a remote URL alone is not private media: nothing would be stored privately', () => {
    const r = parseArtifactSource(src('', '![A view](https://cdn.example.com/view.jpg)'))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.privateMedia).toBeUndefined()
    const mixed = parseArtifactSource(src('', '![A view](https://cdn.example.com/view.jpg)\n\n![Mine](private:mine-1234abcd.jpg)'))
    expect(mixed.ok && mixed.meta.privateMedia).toBe(true)
  })
  it('refuses a local file without media: private, so the publisher never uploads it in public', () => {
    const r = parseArtifactSource(src('', '![A photo](lake.jpg)'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('media: private')
  })
  it('refuses access, password and comments_visible: readers, in words', () => {
    for (const fm of ['access: freedom\n', 'password: open sesame\n', 'comments: anyone\ncomments_visible: readers\n']) {
      const r = parseArtifactSource(src(fm))
      expect(r.ok, fm).toBe(false)
      if (!r.ok) expect(r.error).toContain('broadcast')
    }
  })
  it('still refuses a template it does not know', () => {
    const r = parseArtifactSource('---\ntitle: T\nsummary: S\ntemplate: poster\n---\nx\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('document or broadcast')
  })
})

/** A store that saves what POST parses, as the Firestore one does, enough for the publish route. */
function savingStore(seed: Partial<ArtifactRecord>[] = []) {
  const base = memoryArtifactStore(seed)
  let n = 0
  const save: ArtifactStore['save'] = async (input: SaveInput) => {
    const now = new Date().toISOString()
    const prev = input.id ? base.pages.get(input.id) : undefined
    if (input.id && !prev) return { notFound: true }
    const id = input.id ?? `bcs${'abcdefgh'[n++]}2345`
    const { links, privateMedia, template, title, summary, cover, narration, timings } = input.meta
    base.pages.set(id, { ...(prev ?? { createdAt: now, views: 0 }), id, title, summary, template, markdown: input.markdown, updatedAt: now,
      ...(links ? { links } : {}), ...(privateMedia ? { privateMedia } : {}), ...(cover ? { cover } : {}), ...(narration ? { narration } : {}), ...(timings ? { timings } : {}) } as ArtifactRecord)
    return { id, version: 1, created: !prev }
  }
  return Object.assign(base, { save })
}

const publish = (text: string, id?: string) =>
  new NextRequest(`${site}/api/artifacts${id ? `?id=${id}` : ''}`, { method: 'POST', body: text, headers: { authorization: 'Bearer test-key', 'content-type': 'text/markdown' } })
const BROADCAST = '---\ntitle: At the lake\nsummary: A short one\ntemplate: broadcast\nlinks: per-reader\n---\nHello from the lake.\n'
const DOCUMENT = '---\ntitle: A plan\nsummary: Three bets\n---\n## One\n\nWords.\n'

describe('the 90-day default', () => {
  it('a new broadcast expires 90 days after it is published', async () => {
    const recipients = memoryRecipientsStore()
    const r = createArtifactRoutes(testConfig({ store: savingStore(), recipients, recipientSecret: () => S }))
    const before = Date.now()
    const res = await r.POST(publish(BROADCAST))
    expect(res.status).toBe(201)
    const { id, expireAt } = (await res.json()) as { id: string; expireAt: string }
    const rec = await recipients.get(id)
    expect(rec?.keep).toBe(false)
    expect(rec?.expireAt).toBe(expireAt)
    const at = Date.parse(rec!.expireAt!)
    expect(at).toBeGreaterThanOrEqual(before + BROADCAST_TTL_MS)
    expect(at).toBeLessThanOrEqual(Date.now() + BROADCAST_TTL_MS)
    expect(BROADCAST_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000)
  })
  it('a republish never moves a date already set, and Keep holds', async () => {
    const recipients = memoryRecipientsStore()
    const store = savingStore()
    const r = createArtifactRoutes(testConfig({ store, recipients, recipientSecret: () => S }))
    const { id } = (await (await r.POST(publish(BROADCAST))).json()) as { id: string }
    await recipients.setExpiry(id, '2031-01-01T00:00:00.000Z')
    await r.POST(publish(BROADCAST, id))
    expect((await recipients.get(id))?.expireAt).toBe('2031-01-01T00:00:00.000Z')
    await recipients.setExpiry(id, null) // Keep
    const res = await r.POST(publish(BROADCAST, id))
    expect((await res.json()).expireAt).toBeNull()
    expect(await recipients.get(id)).toMatchObject({ keep: true, expireAt: null })
  })
  it('the kind is sticky: a republish that leaves the line out stays a broadcast; saying document is refused', async () => {
    const store = savingStore()
    const recipients = memoryRecipientsStore()
    const r = createArtifactRoutes(testConfig({ store, recipients, recipientSecret: () => S }))
    const { id } = (await (await r.POST(publish(BROADCAST))).json()) as { id: string }
    const bare = '---\ntitle: At the lake\nsummary: A short one\n---\nHello again.\n'
    expect((await r.POST(publish(bare, id))).status).toBe(200)
    expect(store.pages.get(id)?.template).toBe('broadcast')
    expect(store.pages.get(id)?.links).toBe('per-reader')
    const res = await r.POST(publish('---\ntitle: At the lake\nsummary: A short one\ntemplate: document\n---\nNow a doc.\n', id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('broadcast')
    expect(store.pages.get(id)?.markdown).toContain('Hello again.')
  })
  it('a document gets no date', async () => {
    const recipients = memoryRecipientsStore()
    const r = createArtifactRoutes(testConfig({ store: savingStore(), recipients, recipientSecret: () => S }))
    const res = await r.POST(publish(DOCUMENT))
    const body = (await res.json()) as { id: string; expireAt?: unknown }
    expect(body.expireAt).toBeUndefined()
    expect(await recipients.get(body.id)).toBeNull()
  })
})

const link = (rid: string) => `${rid}.${ridSig(S, ID, rid)}`
const props = (r?: string) => ({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(r ? { r } : {}) })
const card = (over: Partial<ArtifactRecord> = {}): Partial<ArtifactRecord> => ({
  id: ID, template: 'broadcast', title: 'At the lake', summary: 'A short one', links: 'per-reader', privateMedia: true,
  markdown: 'We finally made it up there.\n\n![sound: The lake](private:lake-1234abcd.mp4)\n\n## A heading\n\nOne\n\n## Two\n\nTwo\n\n## Three\n\nThree\n\n## Four\n\nFour',
  ...over,
})
async function routesWith(page: Partial<ArtifactRecord>, over: Record<string, unknown> = {}) {
  const recipients = memoryRecipientsStore()
  const [sam] = await recipients.add(ID, [{ label: 'Sam', note: 'You picked the spot.' }])
  const signer = vi.fn(async (_i: string, s: string) => `https://signed.example.com/${s}?sig=1`)
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ words: [{ w: 'We', s: 0, e: 1 }] })))
  const r = createArtifactRoutes(testConfig({
    store: memoryArtifactStore([page]), recipients, recipientSecret: () => S, owner: 'Robin',
    assets: { put: async () => '', privateUrl: signer } as never, ...over,
  }))
  return { r, recipients, sam, signer, fetchSpy }
}

describe('the message card', () => {
  it('draws one card: the sender, their words, the media, then the reader\'s note; no contents, no read-along, no menu', async () => {
    const { r, sam } = await routesWith(card({ narration: 'https://cdn.example.com/n.mp3', timings: 'https://cdn.example.com/t.json' }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const html = renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    expect(html).toContain('data-broadcast-card')
    expect(html).toContain('From Robin')
    expect(html).toContain('At the lake')
    const words = html.indexOf('We finally made it up there.')
    const media = html.indexOf('https://signed.example.com/lake-1234abcd.mp4?sig=1')
    const note = html.indexOf('You picked the spot.')
    expect(words).toBeGreaterThan(-1)
    expect(media).toBeGreaterThan(words)
    expect(note).toBeGreaterThan(media)
    // A video with sound: controls, started by the reader.
    expect(html).toMatch(/<video[^>]*lake-1234abcd\.mp4[^>]*controls/)
    // Nothing that only a document needs: no table of contents, no read-along, no page menu.
    expect(html).not.toContain('data-artifact-toc')
    expect(html).not.toContain('data-toc-slug')
    expect(html).not.toContain('data-follow-voice')
    expect(html).not.toContain('data-play-offer')
    expect(html).not.toContain('data-page-menu')
    expect(html).not.toContain('Version 1')
    expect(fetchSpy).not.toHaveBeenCalled() // the narration's timings are never even fetched
    fetchSpy.mockRestore()
  })
  it('has comments off by default: no comment layer at all, and the quiet view still reports', async () => {
    const { r, sam } = await routesWith(card(), { state: {} as never })
    const html = renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    expect(html).not.toContain('data-comment-layer')
    expect(html).not.toContain('data-comments-earlier')
    expect(html).toContain(sam.rid) // the quiet beacon carries the reader's own rid
  })
  it('a voice-note broadcast keeps its audio: the note is the sound', async () => {
    const { r, sam } = await routesWith(card({ markdown: 'Listen when you can.\n\n![Voice note](private:hello-1234abcd.m4a)' }))
    const html = renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    expect(html).toMatch(/<audio[^>]*src="https:\/\/signed\.example\.com\/hello-1234abcd\.m4a\?sig=1"[^>]*controls/)
    expect(html).not.toContain('data-follow-voice')
  })
  it('photos and a link card sit inside the same card', async () => {
    const { r, sam } = await routesWith(card({ markdown: 'Two from today.\n\n![First](private:a-1234abcd.jpg)\n\n```links\nhttps://example.com/trail | The trail we took\n```' }))
    const html = renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    const start = html.indexOf('data-broadcast-card')
    // React hoists an image preload into the head, so find the image element itself.
    expect(html.search(/<img[^>]*src="https:\/\/signed\.example\.com\/a-1234abcd\.jpg/)).toBeGreaterThan(start)
    expect(html.indexOf('data-artifact-links')).toBeGreaterThan(start)
  })
  it('the owner signed in sees the card with its media, and no reader note', async () => {
    const RS = 'rs'
    const owner = { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }
    const { r } = await routesWith(card(), { readerSecret: () => RS, ownerEmail: 'robin@example.com', readCookie: async (n: string) => (n === GRANT_COOKIE ? mintGrant(RS, owner) : undefined) })
    const html = renderToStaticMarkup(await r.Page(props()))
    expect(html).toContain('data-broadcast-card')
    expect(html).toContain('https://signed.example.com/lake-1234abcd.mp4?sig=1')
    expect(html).not.toContain('You picked the spot.')
    expect(html).not.toContain(NO_LINK)
  })
})

describe('unfurl fetchers never get a signed URL', () => {
  it('a known bot gets the card text only', async () => {
    const { r, sam, signer } = await routesWith(card(), { readHeader: async (n: string) => (n === 'user-agent' ? 'facebookexternalhit/1.1 Facebot Twitterbot/1.0' : undefined) })
    const html = renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    expect(signer).not.toHaveBeenCalled()
    expect(html).not.toContain('signed.example.com')
    expect(html).not.toContain('private:')
    expect(html).not.toMatch(/<video|<audio|<img/)
    expect(html).toContain('We finally made it up there.')
    expect(html).not.toContain(sam.rid) // no cookie, no beacon
  })
  it('a per-reader document served to a bot carries no signed URL either', async () => {
    const { r, sam, signer } = await routesWith(card({ template: 'document' }), { readHeader: async () => 'Slackbot-LinkExpanding 1.0' })
    const html = renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    expect(signer).not.toHaveBeenCalled()
    expect(html).not.toContain('signed.example.com')
  })
  it('a browser gets the media', async () => {
    const { r, sam, signer } = await routesWith(card(), { readHeader: async () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' })
    renderToStaticMarkup(await r.Page(props(link(sam.rid))))
    expect(signer).toHaveBeenCalledTimes(1)
  })
})

describe('a shut per-reader page answers 410', () => {
  const req = (q = '', cookie?: string) => new NextRequest(`${site}/${ID}${q}`, { headers: cookie ? { cookie } : {} })
  it('revoked or expired: 410 with the same quiet words', async () => {
    const { r, recipients, sam } = await routesWith(card())
    const [other] = await recipients.add(ID, [{ label: 'Lee' }])
    await recipients.revoke(ID, [sam.rid])
    const res = await r.shutPageResponse(req(`?r=${link(sam.rid)}`))
    expect(res?.status).toBe(410)
    expect(await res!.text()).toContain(UNAVAILABLE)
    expect(res!.headers.get('cache-control')).toBe('no-store')
    const byCookie = await r.shutPageResponse(req('', `${ridCookieName(ID)}=${link(sam.rid)}`))
    expect(byCookie?.status).toBe(410)
    expect(await r.shutPageResponse(req(`?r=${link(other.rid)}`))).toBeNull()
    await recipients.setExpiry(ID, '2020-01-01T00:00:00.000Z')
    expect((await r.shutPageResponse(req(`?r=${link(other.rid)}`)))?.status).toBe(410)
  })
  it('passes everything else through untouched: no link, a document, an unknown id, another path', async () => {
    const { r, sam } = await routesWith(card())
    expect(await r.shutPageResponse(req())).toBeNull()
    expect(await r.shutPageResponse(new NextRequest(`${site}/nope2345?r=${link(sam.rid)}`))).toBeNull()
    expect(await r.shutPageResponse(new NextRequest(`${site}/api/artifacts/${ID}?r=${link(sam.rid)}`))).toBeNull()
    const doc = await routesWith({ id: ID, title: 'Doc', summary: 'S', markdown: 'x' })
    expect(await doc.r.shutPageResponse(req(`?r=${link(sam.rid)}`))).toBeNull()
  })
  it('the page itself still says it quietly when nothing answered 410 first', async () => {
    const { r, recipients, sam } = await routesWith(card())
    await recipients.revoke(ID, [sam.rid])
    expect(renderToStaticMarkup(await r.Page(props(link(sam.rid))))).toContain(UNAVAILABLE)
  })
})

describe('DELETE removes the page\'s media too', () => {
  const del = (id: string) => [new NextRequest(`${site}/api/artifacts/${id}`, { method: 'DELETE', headers: { authorization: 'Bearer test-key' } }), { params: Promise.resolve({ id }) }] as const
  it('calls deletePage, then deletes the record', async () => {
    const order: string[] = []
    const store = memoryArtifactStore([card()])
    const del0 = store.delete
    store.delete = async (id: string) => { order.push('record'); return del0(id) }
    const deletePage = vi.fn(async () => { order.push('media'); return 3 })
    const r = createArtifactRoutes(testConfig({ store, assets: { put: async () => '', deletePage } as never }))
    const res = await r.DELETE(...del(ID))
    expect(res.status).toBe(200)
    expect(deletePage).toHaveBeenCalledWith(ID)
    expect(order).toEqual(['media', 'record'])
    expect(store.pages.has(ID)).toBe(false)
  })
  it('leaves nothing of the page: readers, their notes, views and comments go too, even on a kept broadcast', async () => {
    const store = memoryArtifactStore([card()])
    const recipients = memoryRecipientsStore()
    const [sam] = await recipients.add(ID, [{ label: 'Sam', note: 'You picked the spot.' }])
    await recipients.setExpiry(ID, null) // Keep
    await recipients.recordView({ artifactId: ID, rid: sam.rid, session: 's1', device: 'd1', at: '2026-10-11T00:00:00.000Z', addSeconds: 2 })
    const state = createMemoryStateStore()
    await state.append({ artifactId: ID, slot: 'comments', writer: { key: `r:${sam.rid}`, name: 'Sam', anonymous: true } as never, value: { body: 'So good.' } })
    const r = createArtifactRoutes(testConfig({ store, recipients, state, recipientSecret: () => S, assets: { put: async () => '', deletePage: async () => 1 } as never }))
    expect((await r.DELETE(...del(ID))).status).toBe(200)
    expect(store.pages.has(ID)).toBe(false)
    expect(await recipients.get(ID)).toBeNull()
    expect(await recipients.views(ID)).toEqual([])
    expect(await state.entries(ID)).toEqual([])
  })
  it('a bad id never reaches the bucket', async () => {
    const deletePage = vi.fn(async () => 0)
    const r = createArtifactRoutes(testConfig({ assets: { put: async () => '', deletePage } as never }))
    for (const id of ['', '../x', 'abcd2345/private', 'ABCD2345']) expect((await r.DELETE(...del(id))).status).toBe(404)
    expect((await r.DELETE(...del('zzzz2345'))).status).toBe(404) // well-formed, but no such page
    expect(deletePage).not.toHaveBeenCalled()
  })
  it('media that could not be removed keeps the record, so the delete can be run again', async () => {
    const store = memoryArtifactStore([card()])
    const r = createArtifactRoutes(testConfig({ store, assets: { put: async () => '', deletePage: async () => { throw new Error('bucket down') } } as never }))
    const res = await r.DELETE(...del(ID))
    expect(res.status).toBe(502)
    expect(store.pages.has(ID)).toBe(true)
  })
})

describe('the owner\'s lists: broadcasts apart from documents', () => {
  const pages: Partial<ArtifactRecord>[] = [
    { id: 'dcma2345', title: 'Doc A', updatedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'dcmb2345', title: 'Doc B (before kinds)', template: undefined as never, updatedAt: '2026-10-03T00:00:00.000Z' },
    { id: 'bcsa2345', title: 'Lake', template: 'broadcast', links: 'per-reader', updatedAt: '2026-10-02T00:00:00.000Z' },
  ]
  const list = (q: string, headers: Record<string, string> = { authorization: 'Bearer test-key' }) => new NextRequest(`${site}/api/artifacts${q}`, { headers })
  async function routes(over: Record<string, unknown> = {}) {
    const recipients = memoryRecipientsStore()
    const [, lee] = await recipients.add('bcsa2345', [{ label: 'Sam' }, { label: 'Lee' }, { label: 'Kit' }, { label: 'Robin', owner: true }])
    await recipients.revoke('bcsa2345', [lee.rid])
    await recipients.setExpiry('bcsa2345', '2027-01-01T00:00:00.000Z')
    return createArtifactRoutes(testConfig({ store: memoryArtifactStore(pages), recipients, recipientSecret: () => S, ...over }))
  }
  it('broadcasts list on their own, with their expiry and how many people each went to', async () => {
    const res = await (await routes()).LIST(list('?kind=broadcast'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { kind: string; pages: { id: string; expireAt: string; keep: boolean; readers: number; revoked: number; url: string }[] }
    expect(body.kind).toBe('broadcast')
    expect(body.pages.map((p) => p.id)).toEqual(['bcsa2345'])
    expect(body.pages[0]).toMatchObject({ expireAt: '2027-01-01T00:00:00.000Z', keep: false, readers: 2, revoked: 1, url: `${site}/bcsa2345` })
  })
  it('a recipients store that fails fails the list, rather than reading as sent to nobody', async () => {
    const recipients = { ...memoryRecipientsStore(), get: async () => { throw new Error('store down') } }
    const r = createArtifactRoutes(testConfig({ store: memoryArtifactStore(pages), recipients: recipients as never, recipientSecret: () => S }))
    await expect(r.LIST(list('?kind=broadcast'))).rejects.toThrow('store down')
  })
  it('documents list without a single broadcast, newest first, as they always were', async () => {
    const body = (await (await (await routes()).LIST(list(''))).json()) as { kind: string; pages: { id: string }[] }
    expect(body.kind).toBe('document')
    expect(body.pages.map((p) => p.id)).toEqual(['dcmb2345', 'dcma2345'])
    const named = (await (await (await routes()).LIST(list('?kind=document'))).json()) as { pages: { id: string }[] }
    expect(named.pages.map((p) => p.id)).toEqual(['dcmb2345', 'dcma2345'])
  })
  it('the owner and admins signed in may read them; nobody else', async () => {
    const RS = 'rs'
    const who = (email: string) => ({ cookie: `${GRANT_COOKIE}=${mintGrant(RS, { uid: 'u', email, name: 'N', member: true })}` })
    const r = await routes({ readerSecret: () => RS, ownerEmail: 'robin@example.com', admins: ['casey@example.com'] })
    expect((await r.LIST(list('?kind=broadcast', who('robin@example.com')))).status).toBe(200)
    expect((await r.LIST(list('?kind=broadcast', who('casey@example.com')))).status).toBe(200)
    expect((await r.LIST(list('?kind=broadcast', who('dana@example.com')))).status).toBe(401)
    expect((await r.LIST(list('?kind=broadcast', {}))).status).toBe(401)
    expect((await r.LIST(list('?kind=broadcast', { authorization: 'Bearer wrong' }))).status).toBe(401)
  })
  it('an unknown kind is refused, and a store that cannot list says so', async () => {
    expect((await (await routes()).LIST(list('?kind=poster'))).status).toBe(400)
    const bare = memoryArtifactStore(pages) as Partial<ArtifactStore>
    delete bare.list
    const r = createArtifactRoutes(testConfig({ store: bare as ArtifactStore }))
    expect((await r.LIST(list('?kind=broadcast'))).status).toBe(501)
  })
})

describe('documents are unaffected', () => {
  it('an ordinary page still draws the document reader, not the card', async () => {
    const r = createArtifactRoutes(testConfig({
      store: memoryArtifactStore([{ id: 'dcma2345', title: 'A plan', markdown: '## One\n\nA\n\n## Two\n\nB\n\n## Three\n\nC\n\n## Four\n\nD' }]),
    }))
    const html = renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: 'dcma2345' }) }))
    expect(html).not.toContain('data-broadcast')
    expect(html).toContain('data-artifact-toc')
    expect(html).toContain('data-page-menu')
    expect(html).toContain('Version 1')
  })
})
