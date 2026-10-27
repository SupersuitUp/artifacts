// Forward links (superlinks step 3, 0.56.0): a reader on a per-reader page makes a link to pass on,
// and the link remembers who made it, from which link, and when.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig, ridCookieName, parseRidParam } from '../artifacts/recipients.js'
import { perReaderGate } from './per-reader.js'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'

const S = 's'.repeat(40)
const RS = 'r'.repeat(40)
const ID = 'abcd2345'
const site = 'https://artifacts.example.com'
const tim: Reader = { uid: 'u-tim', email: 'tim@example.com', name: 'Tim', member: false }
const doc = (lines: string) => `---\ntitle: T\nsummary: S\n${lines}\n---\nBody.`

async function setup(forward: 'off' | 'signed-in' | 'open' | undefined) {
  const recipients = memoryRecipientsStore()
  const [timLink] = await recipients.add(ID, [{ label: 'Tim' }])
  const page = { id: ID, links: 'per-reader' as const, ...(forward ? { forward } : {}) }
  const routes = createArtifactRoutes(testConfig({
    store: memoryArtifactStore([page]), recipients: recipients as never, recipientSecret: () => S, readerSecret: () => RS,
    signInOrigin: site, ownerEmail: 'robin@example.com',
  }))
  const cookie = `${ridCookieName(ID)}=${timLink.rid}.${ridSig(S, ID, timLink.rid)}`
  const forwardReq = (o: { signedIn?: boolean; body?: unknown; link?: string | null } = {}) => routes.FORWARD(
    new NextRequest(`${site}/api/artifacts/${ID}/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: site, cookie: [o.link === null ? null : o.link ?? cookie, o.signedIn ? `${GRANT_COOKIE}=${mintGrant(RS, tim)}` : null].filter(Boolean).join('; ') },
      body: JSON.stringify(o.body ?? {}),
    }),
    { params: Promise.resolve({ id: ID }) },
  )
  return { recipients, timLink, forwardReq }
}

describe('forward: front matter', () => {
  it('takes off, signed-in or open, and refuses anything else by name', () => {
    for (const v of ['off', 'signed-in', 'open'] as const) {
      const r = parseArtifactSource(doc(`links: per-reader\nforward: ${v}`))
      expect(r.ok && r.meta.forward).toBe(v)
    }
    const bad = parseArtifactSource(doc('links: per-reader\nforward: anyone'))
    expect(bad).toEqual({ ok: false, error: 'forward must be off, signed-in or open' })
  })
  it('needs links: per-reader, since a public page is forwardable by its own address', () => {
    expect(parseArtifactSource(doc('forward: signed-in'))).toEqual({ ok: false, error: 'forward needs links: per-reader' })
  })
})

describe('POST /forward', () => {
  it('signed in, mints a forward with the parent, the forwarder and provenance', async () => {
    const { recipients, timLink, forwardReq } = await setup('signed-in')
    const res = await forwardReq({ signedIn: true, body: { to: 'Ana' } })
    expect(res.status).toBe(200)
    const { link } = await res.json()
    const rid = parseRidParam(new URL(link).searchParams.get('r'))!.rid
    const row = (await recipients.get(ID))!.recipients[rid]
    expect(row).toMatchObject({ label: 'Ana (from Tim)', parent: timLink.rid, group: true, forwardedBy: { uid: 'u-tim', email: 'tim@example.com', name: 'Tim' } })
    expect(row.provenance).toMatchObject({ actor: 'Tim (signed in as tim@example.com)', authority: "forwarded from Tim's link" })
  })
  it('without a name for who it is for, is labelled by the forwarder', async () => {
    const { recipients, forwardReq } = await setup('signed-in')
    const { link } = await (await forwardReq({ signedIn: true })).json()
    const rid = parseRidParam(new URL(link).searchParams.get('r'))!.rid
    expect((await recipients.get(ID))!.recipients[rid].label).toBe('From Tim')
  })
  it('signed out on a signed-in page, answers 401 with the way to sign in, and mints nothing', async () => {
    const { recipients, forwardReq } = await setup('signed-in')
    const res = await forwardReq()
    expect(res.status).toBe(401)
    expect((await res.json()).signIn).toContain(site)
    expect(Object.keys((await recipients.get(ID))!.recipients)).toHaveLength(1)
  })
  it('on an open page needs no sign-in, and the forwarder is the link it came from', async () => {
    const { recipients, timLink, forwardReq } = await setup('open')
    const { link } = await (await forwardReq()).json()
    const rid = parseRidParam(new URL(link).searchParams.get('r'))!.rid
    expect((await recipients.get(ID))!.recipients[rid]).toMatchObject({ parent: timLink.rid, forwardedBy: { rid: timLink.rid, label: 'Tim' } })
  })
  it('is 404 on a page with forward: off, with no forward line, with no link, or from a revoked link', async () => {
    expect((await (await setup('off')).forwardReq({ signedIn: true })).status).toBe(404)
    expect((await (await setup(undefined)).forwardReq({ signedIn: true })).status).toBe(404)
    expect((await (await setup('signed-in')).forwardReq({ signedIn: true, link: null })).status).toBe(404)
    const s = await setup('signed-in')
    await s.recipients.revoke(ID, [s.timLink.rid])
    expect((await s.forwardReq({ signedIn: true })).status).toBe(404)
  })
  it('refuses a malformed name for who it is for', async () => {
    const { forwardReq } = await setup('signed-in')
    expect((await forwardReq({ signedIn: true, body: { to: 'x'.repeat(61) } })).status).toBe(400)
    expect((await forwardReq({ signedIn: true, body: { to: 7 } })).status).toBe(400)
  })
  it('stops at 20 forwards from one reader on one page in a day', async () => {
    const { forwardReq } = await setup('signed-in')
    for (let i = 0; i < 20; i++) expect((await forwardReq({ signedIn: true })).status).toBe(200)
    expect((await forwardReq({ signedIn: true })).status).toBe(429)
  })
})

describe('a forward never outlives the link it came from', () => {
  it('revoking the parent shuts its forwards, and their forwards', async () => {
    const recipients = memoryRecipientsStore()
    const [tim] = await recipients.add(ID, [{ label: 'Tim' }])
    const [ana] = await recipients.add(ID, [{ label: 'Ana (from Tim)', group: true, parent: tim.rid }])
    const [ben] = await recipients.add(ID, [{ label: 'Ben (from Ana)', group: true, parent: ana.rid }])
    const link = (rid: string) => `${rid}.${ridSig(S, ID, rid)}`
    expect((await perReaderGate({ id: ID, param: link(ben.rid), cookie: undefined, secret: S, recipients })).state).toBe('open')
    await recipients.revoke(ID, [tim.rid])
    expect(await perReaderGate({ id: ID, param: link(ana.rid), cookie: undefined, secret: S, recipients })).toEqual({ state: 'shut', why: 'revoked' })
    expect(await perReaderGate({ id: ID, param: link(ben.rid), cookie: undefined, secret: S, recipients })).toEqual({ state: 'shut', why: 'revoked' })
  })
})

describe('the publisher sees the page travel', () => {
  it('GET /recipients and GET /views carry parent and forwardedBy, null on the publisher\'s own sends', async () => {
    const s = await setup('signed-in')
    await s.forwardReq({ signedIn: true, body: { to: 'Ana' } })
    const page = createArtifactRoutes(testConfig({ store: memoryArtifactStore([{ id: ID, links: 'per-reader', forward: 'signed-in' }]), recipients: s.recipients as never, recipientSecret: () => S }))
    const get = async (path: string) => (await (page as unknown as Record<string, (r: NextRequest, p: unknown) => Promise<Response>>)[path === 'views' ? 'VIEWS' : 'RECIPIENTS'](
      new NextRequest(`${site}/api/artifacts/${ID}/${path}`, { headers: { authorization: 'Bearer test-key' } }), { params: Promise.resolve({ id: ID }) })).json()
    for (const { recipients: rows } of [await get('recipients'), await get('views')]) {
      expect(rows.find((r: { label: string }) => r.label === 'Tim')).toMatchObject({ parent: null, forwardedBy: null })
      expect(rows.find((r: { label: string }) => r.label === 'Ana (from Tim)')).toMatchObject({ parent: s.timLink.rid, forwardedBy: { uid: 'u-tim', email: 'tim@example.com', name: 'Tim' } })
    }
  })
})

describe('Share on a per-reader page', () => {
  const items = (html: string) => /data-page-menu-items="([^"]*)"/.exec(html)?.[1].split(' ').filter(Boolean) ?? []
  async function rendered(forward: 'off' | 'signed-in' | 'open' | undefined) {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const recipients = memoryRecipientsStore()
    const [r] = await recipients.add(ID, [{ label: 'Tim' }])
    const routes = createArtifactRoutes(testConfig({
      store: memoryArtifactStore([{ id: ID, title: 'At the river', summary: 'Why.', markdown: 'Body.', links: 'per-reader', ...(forward ? { forward } : {}) }]),
      recipients: recipients as never, recipientSecret: () => S, readerSecret: () => RS, signInOrigin: site,
    }))
    return renderToStaticMarkup(await routes.Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ r: `${r.rid}.${ridSig(S, ID, r.rid)}` }) }))
  }
  it('makes a forward link, never the bare address that opens nothing, and says the name goes with it', async () => {
    for (const f of ['signed-in', 'open'] as const) {
      const html = await rendered(f)
      expect(items(html)).toContain('share')
      expect(html).toContain('data-page-menu-forward')
    }
    expect(await rendered('signed-in')).toContain('Your name goes with this link.')
  })
  it('is absent where the page says forward: off, or says nothing', async () => {
    expect(items(await rendered('off'))).not.toContain('share')
    expect(items(await rendered(undefined))).not.toContain('share')
  })
})

describe('acting on a thread or forward link needs sign-in; a personal link does not', async () => {
  const { mergeCommentsState } = await import('../artifacts/comments.js')
  const { createMemoryStateStore } = await import('../artifacts/state-store.js')
  async function build(forward: 'signed-in' | undefined) {
    const merged = mergeCommentsState(undefined, 'anyone', 'owner')
    if (!merged.ok) throw new Error(merged.error)
    const recipients = memoryRecipientsStore()
    const [named] = await recipients.add(ID, [{ label: 'Tim' }])
    const [thread] = await recipients.add(ID, [{ label: 'The board thread', group: true }])
    const [fwd] = await recipients.add(ID, [{ label: 'From Tim', group: true, parent: named.rid }])
    const state = createMemoryStateStore()
    const routes = createArtifactRoutes(testConfig({
      store: memoryArtifactStore([{ id: ID, markdown: 'The river runs north.', version: 2, links: 'per-reader', comments: 'anyone', commentsVisible: 'owner', state: merged.state, ...(forward ? { forward } : {}) }]),
      recipients: recipients as never, recipientSecret: () => S, readerSecret: () => RS, signInOrigin: site, state,
    }))
    const say = (rid: string, signedIn = false) => routes.STATE_POST(new NextRequest(`${site}/api/artifacts/${ID}/state`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: site, cookie: [`${ridCookieName(ID)}=${rid}.${ridSig(S, ID, rid)}`, signedIn ? `${GRANT_COOKIE}=${mintGrant(RS, tim)}` : null].filter(Boolean).join('; ') },
      body: JSON.stringify({ slot: 'comments', op: 'append', value: { anchor: { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs north.' }, body: 'Which river?', version: 2 } }),
    }), { params: Promise.resolve({ id: ID }) })
    return { named, thread, fwd, say, state }
  }
  it('a personal link comments with no sign-in, under its label', async () => {
    const b = await build('signed-in')
    expect((await b.say(b.named.rid)).status).toBe(200)
  })
  it('a forward link asks for sign-in, then files the note under the link and the signed-in name', async () => {
    const b = await build(undefined)
    const refused = await b.say(b.fwd.rid)
    expect(refused.status).toBe(401)
    expect((await refused.json()).signIn).toContain(site)
    expect((await b.say(b.fwd.rid, true)).status).toBe(200)
    const [e] = (await b.state.entries(ID)).filter((x) => x.slot === 'comments')
    expect(e.readerKey).toMatch(new RegExp(`^r:${b.fwd.rid}\\.[0-9a-f]{24}$`))
    expect(e.writer).toMatchObject({ name: 'Tim', email: 'tim@example.com' })
  })
  it('a thread link on a page with forward: on asks for sign-in; on a page without the line it does not', async () => {
    const on = await build('signed-in')
    expect((await on.say(on.thread.rid)).status).toBe(401)
    const off = await build(undefined)
    expect((await off.say(off.thread.rid)).status).toBe(200)
  })
})
