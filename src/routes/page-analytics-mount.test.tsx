// Where the page analytics mounts, and as whom: never without a key, never for the owner or an
// admin (signed in, previewing as a reader, or on the owner's own link), never for a link-preview
// fetcher; identified only on a gated page or a per-reader link. A stand-in renders the plan.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
vi.mock('../reader/page-analytics.js', () => ({
  PageAnalytics: (p: { plan: unknown }) => <i data-analytics={JSON.stringify(p.plan)} />,
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes, type ArtifactRoutesConfig } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { mintGrant, GRANT_COOKIE, type Reader } from '../artifacts/reader.js'
import type { ReadersStore } from '../artifacts/readers-store.js'

const S = 's'.repeat(40)
const SECRET = 'sekrit'
const analytics = { posthogKey: 'phc_test', tenant: 'example' }
const owner: Reader = { uid: 'u0', email: 'robin@example.com', name: 'Robin', member: true }
const member: Reader = { uid: 'u1', email: 'jordan@example.com', name: 'Jordan Lee', member: true }
const props = (sp: Record<string, string> = {}) => ({ params: Promise.resolve({ id: 'abcd2345' }), searchParams: Promise.resolve(sp) })
const readers = {
  allowList: async () => [], allow: async () => [], touchSession: async () => {}, flag: async () => {},
  sessions: async () => [], flags: async () => [], acknowledged: async () => true, acknowledge: async () => {}, acks: async () => [],
} as unknown as ReadersStore

function plans(html: string) {
  return [...html.matchAll(/data-analytics="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')))
}
async function render(page: Record<string, unknown>, over: Partial<ArtifactRoutesConfig> = {}, { who, ua, sp }: { who?: Reader; ua?: string; sp?: Record<string, string> } = {}) {
  const routes = createArtifactRoutes(testConfig({
    store: memoryArtifactStore([{ id: 'abcd2345', markdown: 'body', ...page }]),
    analytics, readers, readerSecret: () => SECRET, ownerEmail: owner.email,
    readCookie: async (name) => (name === GRANT_COOKIE && who ? mintGrant(SECRET, who) : undefined),
    readHeader: async (name) => (name === 'user-agent' ? ua : undefined),
    ...over,
  }))
  return plans(renderToStaticMarkup(await routes.Page(props(sp))))
}

describe('page analytics on the page', () => {
  it('a host with no key mounts nothing', async () => {
    expect(await render({}, { analytics: undefined })).toEqual([])
  })
  it('a public page mounts it once, anonymous, even for a signed-in reader', async () => {
    const [plan, more] = await render({}, {}, { who: member })
    expect(more).toBeUndefined()
    expect(plan).toMatchObject({ key: 'phc_test', kind: 'public', pageId: 'abcd2345', tenant: 'example', identity: null })
  })
  it('a password page opened by its key stays anonymous', async () => {
    const [plan] = await render({ password: 'pw' }, {}, { sp: { key: 'pw' } })
    expect(plan).toMatchObject({ kind: 'password', identity: null })
  })
  it('the owner never mounts it: signed in, or previewing as a reader', async () => {
    expect(await render({}, {}, { who: owner })).toEqual([])
    expect(await render({}, {}, { who: owner, sp: { as: 'reader' } })).toEqual([])
  })
  it('a link-preview fetcher never gets it', async () => {
    expect(await render({}, {}, { ua: 'facebookexternalhit/1.1' })).toEqual([])
  })
  it('a gated page identifies the signed-in reader by email; the owner is not recorded', async () => {
    const [plan] = await render({ access: 'freedom' }, {}, { who: member })
    expect(plan).toMatchObject({ kind: 'gated', identity: { distinctId: 'jordan@example.com', email: 'jordan@example.com', name: 'Jordan Lee' } })
    expect(await render({ access: 'freedom' }, {}, { who: owner })).toEqual([])
  })
  it('a per-reader link identifies by recipient id and label; the owner\'s own link does not mount it', async () => {
    const recipients = memoryRecipientsStore()
    const [ana, own] = await recipients.add('abcd2345', [{ label: 'Ana' }, { label: 'Owner', owner: true }])
    const link = (rid: string) => `${rid}.${ridSig(S, 'abcd2345', rid)}`
    const over = { recipients, recipientSecret: () => S }
    const [plan] = await render({ links: 'per-reader' }, over, { sp: { r: link(ana.rid) } })
    expect(plan).toMatchObject({ kind: 'per-reader', identity: { distinctId: `recipient:${ana.rid}`, name: 'Ana' } })
    expect(JSON.stringify(plan)).not.toContain('@')
    expect(await render({ links: 'per-reader' }, over, { sp: { r: link(own.rid) } })).toEqual([])
  })
})
