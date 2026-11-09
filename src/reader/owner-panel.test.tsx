// The page's owner panel (artifact hub admin center, task 4): "Owner view" in the page menu opens this page's slice of the
// Artifacts tile, and every button sends the SAME endpoint and payload as the agent's command it mirrors, read from
// freedom-dev's publish-artifact scripts:
//   recipients.mjs add --label L     POST /api/artifacts/<id>/recipients  { add: [{ label: L }] }
//   recipients.mjs revoke --rid R    POST /api/artifacts/<id>/recipients  { revoke: [R] }
//   recipients.mjs expires --at ISO  POST /api/artifacts/<id>/recipients  { expires: ISO }   (--keep: { expires: null })
//   recipients.mjs views             GET  /api/artifacts/<id>/views
//   publish.mjs --delete <file>      POST /api/artifacts?id=<id>&unpublish=1  (no body)
//   publish.mjs --delete --purge     DELETE /api/artifacts/<id>              (no body)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageMenu, menuItems, type PageMenuProps } from './page-menu.js'
import { ownerRequests, type OwnerView } from './owner-panel.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ID = 'abc23456'
const view: OwnerView = { id: ID, title: 'The Paper', url: `https://artifacts.example.com/${ID}`, home: 'https://artifacts.example.com/', perReader: true }
const props: PageMenuProps = { role: 'owner', name: 'Robin', share: { url: view.url, title: 'The Paper' }, comments: false, signIn: null, signOut: '/api/reader/leave', history: null, markdown: null, settings: null, ownerView: view }

const summary = (rid: string, label: string, over: Record<string, unknown> = {}) => ({
  rid, label, group: false, revoked: false, closesAt: null, sentAt: '2026-11-01T10:00:00Z', provenance: null, parent: null, forwardedBy: null, beforeSend: null,
  opened: false, firstOpenAt: null, cameBack: false, activeSeconds: 0, plays: 0, devices: 0, comments: [], lastOpenAt: null, sessions: 0, opens: [], clicks: [],
  goal: 'read', outcome: 'not-opened', succeeded: false, daysSinceSent: 8, ...over,
})
const VIEWS = { id: ID, expireAt: null, keep: false, goal: 'read', recipients: [
  summary('kim000000001', 'Kim', { opened: true, firstOpenAt: '2026-11-02T10:00:00Z', cameBack: true, activeSeconds: 95, devices: 1, sessions: 2, outcome: 'returned', comments: [{ id: 'c1', parent: null, at: '2026-11-02T10:05:00Z', text: 'Ship it.' }] }),
  summary('lee000000001', 'Lee'),
] }
const LISTING = { id: ID, expireAt: null, keep: false, recipients: [
  { rid: 'kim000000001', label: 'Kim', owner: false, revoked: false, addedAt: '2026-11-01T09:00:00Z', url: `${view.url}?r=kim000000001.0123456789abcdef` },
  { rid: 'lee000000001', label: 'Lee', owner: false, revoked: false, addedAt: '2026-11-01T09:00:00Z', url: `${view.url}?r=lee000000001.0123456789abcdef` },
] }
const VERSIONS = { id: ID, current: 2, versions: [{ version: 2, at: '2026-11-03T00:00:00Z', current: true, note: 'Tighter ending' }, { version: 1, at: '2026-11-01T00:00:00Z' }] }

let root: Root | null = null
let host: HTMLElement | null = null
let fetchMock: ReturnType<typeof vi.fn>
function stubFetch() {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = url.endsWith('/views') ? VIEWS : url.endsWith('/versions') ? VERSIONS : url.endsWith('/recipients') ? { ...LISTING, added: method === 'POST' ? [{ rid: 'ada000000001', label: 'Ada', url: `${view.url}?r=ada000000001.0123456789abcdef` }] : undefined } : { ok: true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
}
async function mount(p: PageMenuProps) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<PageMenu {...p} />))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})
const q = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)
async function openPanel() {
  await act(async () => q<HTMLButtonElement>('[data-page-menu-button]')!.click())
  await act(async () => q('[data-page-menu-item="owner-view"]')!.click())
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const posts = () => fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method && (i as RequestInit).method !== 'GET')
const call = (n = 0) => { const [url, init] = posts()[n] as [string, RequestInit]; return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) } }
async function click(sel: string) { await act(async () => { q<HTMLButtonElement>(sel)!.click(); await new Promise((r) => setTimeout(r, 0)) }) }
async function type(sel: string, value: string) {
  const el = q<HTMLInputElement>(sel)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ownerRequests: the CLI verbs, one each', () => {
  it('builds exactly what recipients.mjs and publish.mjs send', () => {
    expect(ownerRequests.add(ID, 'Ada')).toEqual({ url: `/api/artifacts/${ID}/recipients`, method: 'POST', body: { add: [{ label: 'Ada' }] } })
    expect(ownerRequests.revoke(ID, 'kim000000001')).toEqual({ url: `/api/artifacts/${ID}/recipients`, method: 'POST', body: { revoke: ['kim000000001'] } })
    expect(ownerRequests.expires(ID, '2026-12-01T23:59:00.000Z')).toEqual({ url: `/api/artifacts/${ID}/recipients`, method: 'POST', body: { expires: '2026-12-01T23:59:00.000Z' } })
    expect(ownerRequests.expires(ID, null)).toEqual({ url: `/api/artifacts/${ID}/recipients`, method: 'POST', body: { expires: null } })
    expect(ownerRequests.views(ID)).toEqual({ url: `/api/artifacts/${ID}/views`, method: 'GET' })
    expect(ownerRequests.unpublish(ID)).toEqual({ url: `/api/artifacts?id=${ID}&unpublish=1`, method: 'POST' })
    expect(ownerRequests.remove(ID)).toEqual({ url: `/api/artifacts/${ID}`, method: 'DELETE' })
  })
})

describe('Owner view in the page menu', () => {
  it('is an item only when the server hands the menu an owner view', () => {
    expect(menuItems(props)).toContain('owner-view')
    expect(menuItems({ ...props, ownerView: null })).not.toContain('owner-view')
    expect(menuItems({ ...props, ownerView: undefined, role: 'reader' })).not.toContain('owner-view')
  })
  it('opens the page\'s readers, opens, came back, comments and versions', async () => {
    stubFetch()
    await mount(props)
    await openPanel()
    expect(fetchMock.mock.calls.map(([u]) => u).sort()).toEqual([`/api/artifacts/${ID}/recipients`, `/api/artifacts/${ID}/versions`, `/api/artifacts/${ID}/views`])
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).credentials).toBe('same-origin')
    const panel = q('[data-owner-panel]')!
    expect([...panel.querySelectorAll('[data-reader]')].map((e) => e.getAttribute('data-reader'))).toEqual(['Kim', 'Lee'])
    expect(q('[data-reader="Kim"]')!.textContent).toContain('came back')
    expect(q('[data-reader="Kim"]')!.textContent).toContain('Ship it.')
    expect(q('[data-reader="Lee"]')!.textContent).toContain('Not opened')
    expect([...panel.querySelectorAll('[data-owner-version]')].map((e) => e.getAttribute('data-owner-version'))).toEqual(['2', '1'])
    expect(panel.textContent).toContain('Tighter ending')
  })
  it('new reader link: the add verb, with the name', async () => {
    stubFetch()
    await mount(props)
    await openPanel()
    await type('[data-owner-new-label]', 'Ada')
    await click('[data-owner-action="add"]')
    expect(call()).toEqual({ url: `/api/artifacts/${ID}/recipients`, method: 'POST', body: { add: [{ label: 'Ada' }] } })
    expect(q('[data-owner-new-link]')!.textContent).toContain('?r=ada000000001')
  })
  it('shut a link: the revoke verb with its rid; copy a link copies that reader\'s own link', async () => {
    stubFetch()
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await mount(props)
    await openPanel()
    await click('[data-reader="Kim"] [data-owner-action="copy"]')
    expect(writeText).toHaveBeenCalledWith(LISTING.recipients[0].url)
    await click('[data-reader="Kim"] [data-owner-action="revoke"]')
    expect(call()).toEqual({ url: `/api/artifacts/${ID}/recipients`, method: 'POST', body: { revoke: ['kim000000001'] } })
  })
  it('when links close: the expires verb with a time, and Keep with null', async () => {
    stubFetch()
    await mount(props)
    await openPanel()
    await type('[data-owner-expires-date]', '2099-12-01')
    await click('[data-owner-action="expires"]')
    const c = call()
    expect(c.url).toBe(`/api/artifacts/${ID}/recipients`)
    expect(c.body.expires).toBe(new Date('2099-12-01T23:59:00').toISOString())
    await click('[data-owner-action="keep"]')
    expect(call(1).body).toEqual({ expires: null })
  })
  it('unpublish and delete each ask first, then send the publish.mjs --delete and --purge calls', async () => {
    stubFetch()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    await mount(props)
    await openPanel()
    await click('[data-owner-action="unpublish"]')
    expect(posts()).toHaveLength(0)
    await click('[data-owner-confirm="unpublish"]')
    expect(call()).toEqual({ url: `/api/artifacts?id=${ID}&unpublish=1`, method: 'POST', body: undefined })
    await click('[data-owner-action="delete"]')
    expect(posts()).toHaveLength(1)
    await click('[data-owner-confirm="delete"]')
    expect(call(1)).toEqual({ url: `/api/artifacts/${ID}`, method: 'DELETE', body: undefined })
    expect(assign).toHaveBeenCalledWith(view.home)
  })
  it('opens the existing Share settings sheet from the panel', async () => {
    stubFetch()
    const settings = {
      endpoint: `/api/artifacts/${ID}/settings`, access: 'public' as const, levels: ['public' as const], password: false, link: view.url, list: null,
      comments: null, commentsVisible: 'owner' as const, gated: false, facts: [],
    }
    await mount({ ...props, settings })
    await openPanel()
    await click('[data-owner-action="share-settings"]')
    expect(q('[data-settings-sheet="share"]')).not.toBeNull()
    expect(q('[data-owner-panel]')).toBeNull()
  })
  it('a page without reader links offers no new link and no closing date', async () => {
    stubFetch()
    await mount({ ...props, ownerView: { ...view, perReader: false } })
    await openPanel()
    expect(q('[data-owner-action="add"]')).toBeNull()
    expect(q('[data-owner-action="expires"]')).toBeNull()
  })
})
