import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { perReaderGate, withPrivateUrls, UNAVAILABLE, NO_LINK } from './per-reader.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { GRANT_COOKIE, mintGrant } from '../artifacts/reader.js'

const S = 's'.repeat(40)
async function seeded() {
  const recipients = memoryRecipientsStore()
  const [tim, ann] = await recipients.add('abcd2345', [{ label: 'Tim', note: 'You were there.' }, { label: 'Ann' }])
  return { recipients, tim, ann, link: (rid: string) => `${rid}.${ridSig(S, 'abcd2345', rid)}` }
}

describe('perReaderGate', () => {
  it('opens for a valid link, and for the cookie that link set', async () => {
    const { recipients, tim, link } = await seeded()
    const a = await perReaderGate({ id: 'abcd2345', param: link(tim.rid), cookie: undefined, secret: S, recipients })
    expect(a).toMatchObject({ state: 'open', label: 'Tim', note: 'You were there.', fromLink: true })
    const b = await perReaderGate({ id: 'abcd2345', param: undefined, cookie: link(tim.rid), secret: S, recipients })
    expect(b).toMatchObject({ state: 'open', fromLink: false })
  })
  it('is shut with no link, a forged link, a revoked rid, an expired page, or no secret', async () => {
    const { recipients, tim, ann, link } = await seeded()
    expect(await perReaderGate({ id: 'abcd2345', param: undefined, cookie: undefined, secret: S, recipients })).toEqual({ state: 'shut', why: 'no-link' })
    expect(await perReaderGate({ id: 'abcd2345', param: `${tim.rid}.0000000000000000`, cookie: undefined, secret: S, recipients })).toEqual({ state: 'shut', why: 'no-link' })
    await recipients.revoke('abcd2345', [tim.rid])
    expect(await perReaderGate({ id: 'abcd2345', param: link(tim.rid), cookie: undefined, secret: S, recipients })).toEqual({ state: 'shut', why: 'revoked' })
    expect((await perReaderGate({ id: 'abcd2345', param: link(ann.rid), cookie: undefined, secret: S, recipients })).state).toBe('open')
    await recipients.setExpiry('abcd2345', '2026-01-01T00:00:00.000Z')
    expect(await perReaderGate({ id: 'abcd2345', param: link(ann.rid), cookie: undefined, secret: S, recipients, now: Date.parse('2026-02-01') })).toEqual({ state: 'shut', why: 'expired' })
    expect(await perReaderGate({ id: 'abcd2345', param: link(ann.rid), cookie: undefined, secret: undefined, recipients })).toEqual({ state: 'shut', why: 'closed' })
  })
  it('never treats an empty secret as valid, even for a link signed with the empty string', async () => {
    const { recipients, tim } = await seeded()
    const forged = `${tim.rid}.${ridSig('', 'abcd2345', tim.rid)}`
    expect(await perReaderGate({ id: 'abcd2345', param: forged, cookie: undefined, secret: '', recipients })).toEqual({ state: 'shut', why: 'closed' })
  })
})

describe('withPrivateUrls', () => {
  it('rewrites only private: refs, through the signer', async () => {
    const md = '![sound: River](private:river-1234abcd.mp4)\n\n![Cover](https://cdn.example.com/c.jpg)'
    const out = await withPrivateUrls(md, 'abcd2345', async (_id, s) => `https://signed.example.com/${s}?sig=1`)
    expect(out).toContain('](https://signed.example.com/river-1234abcd.mp4?sig=1)')
    expect(out).toContain('](https://cdn.example.com/c.jpg)')
  })
  it('without a signer a private ref renders as nothing playable', async () => {
    expect(await withPrivateUrls('![x](private:a-1234abcd.mp4)', 'abcd2345', undefined)).not.toContain('private:')
  })
})

describe('the page', () => {
  const page = { id: 'abcd2345', title: 'At the river', summary: 'Why I sent it.', links: 'per-reader' as const, privateMedia: true as const, markdown: '![sound: River](private:river-1234abcd.mp4)' }
  const props = (r?: string) => ({ params: Promise.resolve({ id: 'abcd2345' }), searchParams: Promise.resolve(r ? { r } : {}) })
  const routes = (recipients: unknown, over = {}) => createArtifactRoutes(testConfig({
    store: memoryArtifactStore([page]), recipients: recipients as never, recipientSecret: () => S,
    assets: { put: async () => '', privateUrl: async (_i: string, s: string) => `https://signed.example.com/${s}` } as never, ...over,
  }))
  it('a revoked reader sees only that it is no longer available, and no media', async () => {
    const { recipients, tim, link } = await seeded()
    await recipients.revoke('abcd2345', [tim.rid])
    const html = renderToStaticMarkup(await routes(recipients).Page(props(link(tim.rid))))
    expect(html).toContain(UNAVAILABLE)
    expect(html).not.toContain('signed.example.com')
  })
  it('a valid reader sees their own note and the signed video, and never another reader\'s note', async () => {
    const { recipients, tim, ann, link } = await seeded()
    const r = routes(recipients)
    const timHtml = renderToStaticMarkup(await r.Page(props(link(tim.rid))))
    expect(timHtml).toContain('For Tim: You were there.')
    expect(timHtml).toContain('https://signed.example.com/river-1234abcd.mp4')
    const annHtml = renderToStaticMarkup(await r.Page(props(link(ann.rid))))
    expect(annHtml).not.toContain('You were there.')
    expect(annHtml).not.toContain(tim.rid)
  })
  it('no link, or no store, or no secret: shut to everyone', async () => {
    const { recipients, link, tim } = await seeded()
    expect(renderToStaticMarkup(await routes(recipients).Page(props()))).toContain(NO_LINK)
    expect(renderToStaticMarkup(await routes(undefined).Page(props(link(tim.rid))))).toContain(UNAVAILABLE)
    expect(renderToStaticMarkup(await routes(recipients, { recipientSecret: () => '' }).Page(props(link(tim.rid))))).toContain(UNAVAILABLE)
    expect(renderToStaticMarkup(await routes(recipients).Page(props(link(tim.rid))))).not.toContain(UNAVAILABLE)
  })
  it('the owner signed in gets through without a link, with media but no reader note', async () => {
    const { recipients } = await seeded()
    const RS = 'rs'
    const owner = { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }
    const r = routes(recipients, {
      readerSecret: () => RS, ownerEmail: 'robin@example.com',
      readCookie: async (n: string) => (n === GRANT_COOKIE ? mintGrant(RS, owner) : undefined),
    })
    const html = renderToStaticMarkup(await r.Page(props()))
    expect(html).not.toContain(NO_LINK)
    expect(html).toContain('https://signed.example.com/river-1234abcd.mp4')
    expect(html).not.toContain('You were there.')
  })
})
