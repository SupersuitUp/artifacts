// `links: tracked` (0.70.0): every reader can have a link of their own that counts their opens,
// and the page's plain address still opens for anyone. Earned 2026-11-14, when a release page whose
// plain link had already been emailed to seven people was switched to `links: per-reader`: every
// one of those links became a sign-in door, and `links:` could not be set back.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
vi.mock('../reader/quiet-view.js', () => ({
  QuietView: (p: { rid: string; token: string }) => <i data-quiet-view={p.rid} data-token={p.token} />,
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { createRecipientsRoutes } from './recipients-routes.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { NO_LINK, UNAVAILABLE } from './per-reader.js'
import type { ArtifactRecord, ArtifactStore, SaveInput } from '../artifacts/store.js'

const S = 's'.repeat(40)
const ID = 'trak2345'
const page = { id: ID, title: 'Release 8.2', summary: 'What is new.', links: 'tracked' as const, markdown: 'The body anyone can read.' }
const props = (r?: string) => ({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(r ? { r } : {}) })
async function setup(seed: Partial<ArtifactRecord> = page) {
  const recipients = memoryRecipientsStore()
  const [ana] = await recipients.add(ID, [{ label: 'Ana', note: 'Thanks for the report.' }])
  const store = memoryArtifactStore([seed])
  const routes = createArtifactRoutes(testConfig({ store, recipients, recipientSecret: () => S }))
  return { recipients, ana, store, routes, link: (rid: string) => `${rid}.${ridSig(S, ID, rid)}` }
}

describe('front matter: links', () => {
  const src = (fm: string) => `---\ntitle: T\nsummary: S\n${fm}---\nbody\n`
  it('takes tracked and open, and still refuses any other value in words that name all three', () => {
    const t = parseArtifactSource(src('links: tracked\n'))
    expect(t.ok && t.meta.links).toBe('tracked')
    const o = parseArtifactSource(src('links: open\n'))
    expect(o.ok && o.meta.links).toBe('open')
    const bad = parseArtifactSource(src('links: everyone\n'))
    expect(!bad.ok && bad.error).toBe('links must be per-reader, tracked or open')
  })
  it('a tracked page stands alone like a per-reader one, and keeps public media', () => {
    for (const fm of ['links: tracked\npassword: day ones\n', 'links: tracked\naccess: freedom\n']) {
      const r = parseArtifactSource(src(fm))
      expect(!r.ok && r.error, fm).toMatch(/stand alone/)
    }
    const m = parseArtifactSource(src('links: tracked\nmedia: private\n'))
    expect(!m.ok && m.error).toMatch(/media: private needs links: per-reader/)
  })
  it('a broadcast or a file page cannot be made tracked or open: per-reader is what they are', () => {
    const b = parseArtifactSource('---\ntitle: T\nsummary: S\ntemplate: broadcast\nlinks: tracked\n---\nhi\n')
    expect(!b.ok && b.error).toMatch(/broadcast/)
  })
})

describe('the tracked page', () => {
  it('opens at its plain address for anyone: no door, the body, and no beacon', async () => {
    const { routes } = await setup()
    const html = renderToStaticMarkup(await routes.Page(props()))
    expect(html).toContain('The body anyone can read.')
    expect(html).not.toContain(NO_LINK)
    expect(html).not.toContain('data-quiet-view')
  })
  it('opens through a reader\'s own link as theirs: their note and one beacon with a render token', async () => {
    const { routes, ana, link } = await setup()
    const html = renderToStaticMarkup(await routes.Page(props(link(ana.rid))))
    expect(html).toContain('The body anyone can read.')
    expect(html).toContain('For Ana: Thanks for the report.')
    expect(html.match(/data-quiet-view=/g)).toHaveLength(1)
    expect(html).toContain(`data-quiet-view="${ana.rid}"`)
    expect(html).toMatch(/data-token="[0-9a-z]+\.[0-9a-f]{16}\.[0-9a-f]{16}"/)
  })
  it('a revoked or forged link still opens the page, untracked: the address is open', async () => {
    const { routes, recipients, ana, link } = await setup()
    await recipients.revoke(ID, [ana.rid])
    const revoked = renderToStaticMarkup(await routes.Page(props(link(ana.rid))))
    expect(revoked).toContain('The body anyone can read.')
    expect(revoked).not.toContain(UNAVAILABLE)
    expect(revoked).not.toContain('data-quiet-view')
    const forged = renderToStaticMarkup(await routes.Page(props(`${ana.rid}.0000000000000000`)))
    expect(forged).toContain('The body anyone can read.')
  })
  it('a host with no recipient secret still opens the page for everyone', async () => {
    const routes = createArtifactRoutes(testConfig({ store: memoryArtifactStore([page]) }))
    expect(renderToStaticMarkup(await routes.Page(props()))).toContain('The body anyone can read.')
  })
  it('the publish API says the page is tracked', async () => {
    const { routes } = await setup()
    const res = await (routes as unknown as { GET: (r: NextRequest, c: unknown) => Promise<Response> }).GET(
      new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}`, { headers: { authorization: 'Bearer test-key' } }), { params: Promise.resolve({ id: ID }) })
    expect(((await res.json()) as { share: { links: string } }).share.links).toBe('tracked')
  })
})

describe('reader links on a tracked page', () => {
  it('can be minted, like on a per-reader page', async () => {
    const recipients = memoryRecipientsStore()
    const r = createRecipientsRoutes({ store: memoryArtifactStore([page]), recipients, recipientSecret: () => S, publishKey: () => 'k',
      pageUrl: (id) => `https://artifacts.example.com/${id}`, authed: (req) => req.headers.get('authorization') === 'Bearer k' })
    const res = await (r as unknown as Record<string, (q: NextRequest, c: unknown) => Promise<Response>>).RECIPIENTS(
      new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}/recipients`, { method: 'POST', body: JSON.stringify({ add: [{ label: 'Bea' }] }), headers: { authorization: 'Bearer k' } }),
      { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { added: unknown[] }).added).toHaveLength(1)
  })
})

/** A store that saves what POST parses, settling `links` the way the Firestore store does. */
function savingStore(seed: Partial<ArtifactRecord>[]) {
  const base = memoryArtifactStore(seed)
  const save: ArtifactStore['save'] = async (input: SaveInput) => {
    const prev = base.pages.get(input.id!)!
    const links = input.meta.links === 'open' ? undefined : input.meta.links ?? prev.links
    base.pages.set(input.id!, { ...prev, ...input.meta, links, markdown: input.markdown } as ArtifactRecord)
    return { id: input.id!, version: 2, created: false }
  }
  return Object.assign(base, { save })
}
const publish = (text: string) => new NextRequest(`https://artifacts.example.com/api/artifacts?id=${ID}`, { method: 'POST', body: text, headers: { authorization: 'Bearer test-key' } })

describe('setting a per-reader page back', () => {
  const file = (fm: string) => `---\ntitle: Release 8.2\nsummary: What is new.\n${fm}---\nThe body anyone can read.\n`
  it('a republish with links: tracked opens the plain address, and the links already sent keep counting', async () => {
    const store = savingStore([{ ...page, links: 'per-reader' }])
    const recipients = memoryRecipientsStore()
    const [ana] = await recipients.add(ID, [{ label: 'Ana' }])
    const routes = createArtifactRoutes(testConfig({ store, recipients, recipientSecret: () => S }))
    expect(renderToStaticMarkup(await routes.Page(props()))).toContain(NO_LINK)
    const res = await routes.POST(publish(file('links: tracked\n')))
    expect(res.status).toBe(200)
    expect(store.pages.get(ID)?.links).toBe('tracked')
    expect(renderToStaticMarkup(await routes.Page(props()))).toContain('The body anyone can read.')
    const mine = renderToStaticMarkup(await routes.Page(props(`${ana.rid}.${ridSig(S, ID, ana.rid)}`)))
    expect(mine).toContain(`data-quiet-view="${ana.rid}"`)
  })
  it('a page that keeps private media is refused, in words, rather than opened with its media still private', async () => {
    const store = savingStore([{ ...page, links: 'per-reader', privateMedia: true }])
    const routes = createArtifactRoutes(testConfig({ store, recipients: memoryRecipientsStore(), recipientSecret: () => S,
      assets: { put: async () => '', privateUrl: async () => '', putPrivate: async () => '' } as never }))
    const res = await routes.POST(publish(file('links: tracked\n')))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/private media/)
    expect(store.pages.get(ID)?.links).toBe('per-reader')
  })
})
