// Where the beacon is mounted: on a reader's own link, never on the owner's preview, never on an
// ordinary page. The real QuietView renders nothing, so a stand-in leaves a mark to look for.
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
import { testConfig, memoryArtifactStore } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig, mintRenderToken } from '../artifacts/recipients.js'

const S = 's'.repeat(40)
const page = { id: 'abcd2345', title: 'T', summary: 'S', links: 'per-reader' as const, markdown: 'x' }
const props = (r?: string) => ({ params: Promise.resolve({ id: 'abcd2345' }), searchParams: Promise.resolve(r ? { r } : {}) })
async function setup() {
  const recipients = memoryRecipientsStore()
  const [ana, owner] = await recipients.add('abcd2345', [{ label: 'Ana' }, { label: 'Owner', owner: true }])
  const routes = createArtifactRoutes(testConfig({ store: memoryArtifactStore([page]), recipients, recipientSecret: () => S }))
  return { recipients, ana, owner, routes, link: (rid: string) => `${rid}.${ridSig(S, 'abcd2345', rid)}` }
}

describe('the quiet view on the page', () => {
  it('a reader\'s own link mounts it once, with a render token', async () => {
    const { ana, routes, link } = await setup()
    const html = renderToStaticMarkup(await routes.Page(props(link(ana.rid))))
    expect(html.match(/data-quiet-view=/g)).toHaveLength(1)
    expect(html).toContain(`data-quiet-view="${ana.rid}"`)
    expect(html).toMatch(/data-token="[0-9a-z]+\.[0-9a-f]{16}\.[0-9a-f]{16}"/)
  })
  it('the owner\'s rid does not mount it', async () => {
    const { owner, routes, link } = await setup()
    expect(renderToStaticMarkup(await routes.Page(props(link(owner.rid))))).not.toContain('data-quiet-view')
  })
  it('an ordinary page does not mount it', async () => {
    const routes = createArtifactRoutes(testConfig({ store: memoryArtifactStore([{ ...page, links: undefined } as never]), recipients: memoryRecipientsStore(), recipientSecret: () => S }))
    expect(renderToStaticMarkup(await routes.Page(props()))).not.toContain('data-quiet-view')
  })
  it('the routes factory carries SEEN, wired to the instance\'s recipients and secret', async () => {
    const { recipients, ana, routes } = await setup()
    const res = await routes.SEEN(new NextRequest('https://artifacts.example.com/api/artifacts/abcd2345/seen', {
      method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 Safari/604.1', 'content-type': 'application/json' },
      body: JSON.stringify({ rid: ana.rid, sig: ridSig(S, 'abcd2345', ana.rid), event: 'view', token: mintRenderToken(S, 'abcd2345', ana.rid), session: 's1', device: 'd1' }),
    }), { params: Promise.resolve({ id: 'abcd2345' }) })
    expect(res.status).toBe(200)
    expect(await recipients.views('abcd2345')).toHaveLength(1)
  })
})
