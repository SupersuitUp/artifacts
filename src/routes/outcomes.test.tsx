// Send outcomes over HTTP (issue #12): the page records a CTA click through SEEN, under the same
// signature and beat as every other reader signal; GET /views carries the new facts and the
// outcome; GET /api/artifacts/<id> returns the page's goal.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createRecipientsRoutes } from './recipients-routes.js'
import { createArtifactRoutes } from './artifacts.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig, mintRenderToken } from '../artifacts/recipients.js'
import { ArtifactMarkdown } from '../artifacts/render.js'
import { memoryArtifactStore, testConfig } from './test-config.js'

const S = 's'.repeat(40)
const ID = 'abcd2345'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MD = 'Pick a time: [Book a call](https://cal.example.com/x "cta:book-call").'

async function setup(page: Record<string, unknown> = { id: ID, links: 'per-reader', markdown: MD, goal: { click: 'book-call' } }, outcomes?: { readSeconds?: number }) {
  const recipients = memoryRecipientsStore()
  const [ana] = await recipients.add(ID, [{ label: 'Ana' }])
  const routes = createRecipientsRoutes({ store: memoryArtifactStore([page as never]), recipients, recipientSecret: () => S, publishKey: () => 'k', pageUrl: (id) => `https://artifacts.example.com/${id}`,
    authed: (req) => req.headers.get('authorization') === 'Bearer k', ...(outcomes ? { outcomes } : {}) })
  const seen = (body: Record<string, unknown>) =>
    routes.SEEN(new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}/seen`, { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': SAFARI, 'content-type': 'application/json' } }), { params: Promise.resolve({ id: ID }) })
  const base = { rid: ana.rid, sig: ridSig(S, ID, ana.rid), session: 's1', device: 'd1' }
  const views = async (q = '') => (await routes.VIEWS(new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}/views${q}`, { headers: { authorization: 'Bearer k' } }), { params: Promise.resolve({ id: ID }) })).json()
  const open = async () => (await (await seen({ ...base, event: 'view', token: mintRenderToken(S, ID, ana.rid) })).json()).beat as string
  return { recipients, ana, seen, base, views, open }
}

describe('POST /seen with event: click', () => {
  it('records a named CTA for the reader, under the beat the view earned', async () => {
    const { recipients, seen, base, open } = await setup()
    const beat = await open()
    expect((await seen({ ...base, event: 'click', beat, cta: 'book-call' })).status).toBe(200)
    const [v] = await recipients.views(ID)
    expect(v.clicks?.map((c) => c.cta)).toEqual(['book-call'])
  })
  it('refuses a click without the beat, with a forged signature, a malformed id, or a CTA the page does not carry', async () => {
    const { recipients, seen, base, open } = await setup()
    const beat = await open()
    expect((await seen({ ...base, event: 'click', beat: '1'.repeat(16), cta: 'book-call' })).status).toBe(403)
    expect((await seen({ ...base, sig: '0'.repeat(16), event: 'click', beat, cta: 'book-call' })).status).toBe(403)
    expect((await seen({ ...base, event: 'click', beat, cta: 'Book Call' })).status).toBe(400)
    expect((await seen({ ...base, event: 'click', beat, cta: 'reply' })).status).toBe(400)
    const [v] = await recipients.views(ID)
    expect(v.clicks ?? []).toEqual([])
  })
  it('a revoked reader\'s click is 410 and records nothing', async () => {
    const { recipients, ana, seen, base, open } = await setup()
    const beat = await open()
    await recipients.revoke(ID, [ana.rid])
    expect((await seen({ ...base, event: 'click', beat, cta: 'book-call' })).status).toBe(410)
  })
})

describe('GET /views carries the new facts and the outcome', () => {
  it('a click on the goal CTA is acted and succeeded, with sessions, opens, lastOpenAt and the page goal', async () => {
    const { seen, base, views, open } = await setup()
    const beat = await open()
    await seen({ ...base, event: 'click', beat, cta: 'book-call' })
    const res = await views()
    expect(res.goal).toEqual({ click: 'book-call' })
    expect(res.thresholds).toEqual({ readSeconds: 30, returnGapMs: 3_600_000 })
    expect(res.recipients[0]).toMatchObject({ outcome: 'acted', succeeded: true, sessions: 1, clicks: [{ cta: 'book-call' }], opens: [{ device: 'd1', activeSeconds: 2 }] })
    expect(res.recipients[0].lastOpenAt).toEqual(res.recipients[0].firstOpenAt)
  })
  it('a page with no goal reads as read, and existing fields are unchanged', async () => {
    const { views, open } = await setup({ id: ID, links: 'per-reader', markdown: 'x' })
    await open()
    const res = await views()
    expect(res.goal).toBe('read')
    expect(res.recipients[0]).toMatchObject({ opened: true, activeSeconds: 2, cameBack: false, outcome: 'opened', succeeded: false, daysSinceSent: null })
  })
  it('a host passes its own read threshold, by config or by query', async () => {
    const { views, open } = await setup({ id: ID, links: 'per-reader', markdown: 'x' }, { readSeconds: 2 })
    await open()
    expect((await views()).recipients[0]).toMatchObject({ outcome: 'read', succeeded: true })
    expect((await views('?readSeconds=10')).recipients[0]).toMatchObject({ outcome: 'opened' })
    expect((await views('?readSeconds=-1')).recipients[0]).toMatchObject({ outcome: 'read' }) // ignored, config stands
  })
})

describe('the page returns its goal, and a CTA link carries its id', () => {
  it('GET /api/artifacts/<id> answers goal, read when absent', async () => {
    const store = memoryArtifactStore([{ id: ID, goal: 'respond' } as never, { id: 'open2345' }])
    const routes = createArtifactRoutes(testConfig({ store }))
    const get = async (id: string) => (await routes.GET(new NextRequest(`https://artifacts.example.com/api/artifacts/${id}`, { headers: { authorization: 'Bearer test-key' } }), { params: Promise.resolve({ id }) })).json()
    expect((await get(ID)).goal).toBe('respond')
    expect((await get('open2345')).goal).toBe('read')
  })
  it('a link titled cta:<id> renders data-artifact-cta and no title; an in-page CTA does not open a tab', () => {
    const html = renderToStaticMarkup(<ArtifactMarkdown markdown={`${MD}\n\n[Got it](#got-it "cta:ack") [Plain](https://example.com "A title")`} />)
    expect(html).toMatch(/<a href="https:\/\/cal\.example\.com\/x"[^>]*data-artifact-cta="book-call"/)
    expect(html).toMatch(/<a href="#got-it"(?![^>]*target=)[^>]*data-artifact-cta="ack"/)
    expect(html).not.toContain('cta:')
    expect(html.match(/data-artifact-cta=/g)).toHaveLength(2)
  })
})
