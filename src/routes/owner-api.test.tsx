// The owner's panel calls the same endpoints the agent's commands call (artifact hub admin center,
// task 2). Each answers the publish key as before, and now also the owner or an admin signed in by
// the reader grant: nobody signed in is 401, a signed-in reader who is not the owner is 403, and a
// change made with the grant must come from this host's own pages, so a cross-site form cannot
// delete or unpublish a page. Also: GET /api/activity (every page's opens, comments and clicks
// since a time, in one call), LIST's `readerLinks`, and a view counter that counts neither the
// owner nor a link-preview bot.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { memoryArtifactStore } from './test-config.js'
import { freedomDefault } from '../brand/pack.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { mintGrant, GRANT_COOKIE, type Reader } from '../artifacts/reader.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import type { StateEntry } from '../artifacts/state-store.js'

const SECRET = 'sekrit'
const RSECRET = 'r'.repeat(40)
const SITE = 'https://artifacts.example.com'
const ID = 'abcd2345' // per-reader
const DOC = 'efgh2345' // a plain document

const owner: Reader = { uid: 'u1', email: 'Robin@Example.com', name: 'Robin Vale', member: true }
const admin: Reader = { uid: 'u2', email: 'casey@example.com', name: 'Casey Admin', member: true }
const stranger: Reader = { uid: 'u3', email: 'dana@example.com', name: 'Dana Ruiz', member: true }

function world(opts: { ua?: string; cookieAs?: Reader | null; entries?: StateEntry[] } = {}) {
  const s = memoryArtifactStore([
    { id: ID, title: 'Per reader', links: 'per-reader', views: 0 },
    { id: DOC, title: 'Plain doc', views: 0, updatedAt: '2026-10-12T00:00:00.000Z' },
  ])
  const store = Object.assign(s, {
    bumpViews: vi.fn(async () => {}),
    history: vi.fn(async (id: string) => (s.pages.has(id) ? [{ version: 1, at: '2026-10-11T00:00:00.000Z', current: true as const }] : null)),
    setNote: vi.fn(async () => true),
    setUnpublished: vi.fn(async (id: string, at: string | null) => { const a = s.pages.get(id); if (!a) return false; if (at) a.unpublishedAt = at; return true }),
  })
  const recipients = memoryRecipientsStore()
  const entries = opts.entries ?? []
  const state = { entries: async (id: string) => entries.filter((e) => e.artifactId === id) } as never
  const readers = {
    allowList: vi.fn(async () => []), allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
    sessions: vi.fn(async () => []), flags: vi.fn(async () => []), acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  } as unknown as ReadersStore
  const cookies: Record<string, string> = opts.cookieAs ? { [GRANT_COOKIE]: mintGrant(SECRET, opts.cookieAs) } : {}
  const routes = createArtifactRoutes({
    store, brand: freedomDefault, siteUrl: SITE, publishKey: () => 'k', readerSecret: () => SECRET,
    recipients, recipientSecret: () => RSECRET, state, readers,
    ownerEmail: 'robin@example.com', admins: ['casey@example.com'],
    readCookie: async (n) => cookies[n], readHeader: async () => opts.ua ?? 'Mozilla/5.0 (iPhone)',
  })
  return { store, recipients, routes }
}

type Who = { key?: string; as?: Reader; origin?: string | null; site?: string; type?: string }
function rq(path: string, method: string, who: Who, body?: unknown) {
  const h: Record<string, string> = {}
  if (who.key) h.authorization = `Bearer ${who.key}`
  if (who.as) h.cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, who.as)}`
  if (method !== 'GET') {
    if (who.origin !== null) h.origin = who.origin ?? SITE
    if (who.site) h['sec-fetch-site'] = who.site
    h['content-type'] = who.type ?? 'application/json'
  }
  return new NextRequest(`${SITE}${path}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

type Call = (r: ReturnType<typeof world>['routes'], who: Who) => Promise<Response>
const call = (name: string, path: string, method: string, body?: unknown, id = ID): Call => (r, who) =>
  (r as unknown as Record<string, (q: NextRequest, c?: unknown) => Promise<Response>>)[name](rq(path, method, who, body), params(id))

const reads: [string, Call][] = [
  ['GET views', call('VIEWS', `/api/artifacts/${ID}/views`, 'GET')],
  ['GET recipients', call('RECIPIENTS', `/api/artifacts/${ID}/recipients`, 'GET')],
  ['GET versions', call('VERSIONS', `/api/artifacts/${ID}/versions`, 'GET')],
  ['GET reads', call('READS', `/api/artifacts/${ID}/reads`, 'GET')],
  ['GET responses', call('RESPONSES', `/api/artifacts/${ID}/responses`, 'GET')],
]
const writes: [string, Call][] = [
  ['POST recipients', call('RECIPIENTS', `/api/artifacts/${ID}/recipients`, 'POST', { add: [{ label: 'Dana' }] })],
  ['POST versions', call('VERSIONS', `/api/artifacts/${ID}/versions`, 'POST', { version: 1, note: 'first' })],
  ['POST unpublish', call('POST', `/api/artifacts?unpublish=1&id=${ID}`, 'POST')],
  ['DELETE', call('DELETE', `/api/artifacts/${ID}`, 'DELETE')],
]

describe('the owner panel endpoints take the publish key or the owner signed in', () => {
  for (const [name, fn] of [...reads, ...writes]) {
    it(`${name}: 401 with no key and no grant`, async () => {
      expect((await fn(world().routes, {})).status).toBe(401)
    })
    it(`${name}: 200 with the owner's grant, and with an admin's`, async () => {
      expect((await fn(world().routes, { as: owner })).status).toBe(200)
      expect((await fn(world().routes, { as: admin })).status).toBe(200)
    })
    it(`${name}: 403 for a signed-in reader who is not the owner`, async () => {
      expect((await fn(world().routes, { as: stranger })).status).toBe(403)
    })
    it(`${name}: the publish key still works`, async () => {
      expect((await fn(world().routes, { key: 'k' })).status).toBe(200)
    })
  }
  for (const [name, fn] of writes) {
    it(`${name}: with the grant, refused from another site`, async () => {
      expect((await fn(world().routes, { as: owner, origin: 'https://evil.example' })).status).toBe(403)
      expect((await fn(world().routes, { as: owner, origin: null, site: 'cross-site' })).status).toBe(403)
    })
  }
  it('DELETE with a cross-site grant leaves the page in place', async () => {
    const w = world()
    await call('DELETE', `/api/artifacts/${ID}`, 'DELETE')(w.routes, { as: owner, origin: 'https://evil.example' })
    expect(w.store.pages.has(ID)).toBe(true)
  })
  it('a POST with a body sent with the grant must be JSON, which a form cannot send', async () => {
    const fn = call('RECIPIENTS', `/api/artifacts/${ID}/recipients`, 'POST', { add: [{ label: 'Dana' }] })
    expect((await fn(world().routes, { as: owner, type: 'text/plain' })).status).toBe(415)
  })
})

describe('GET /api/activity: every page in one call', () => {
  const SENT = '2026-11-01T00:00:00.000Z'
  async function seeded(entries: (rid: string) => StateEntry[] = () => []) {
    let rid = ''
    const w0 = world()
    const [dana, me] = await w0.recipients.add(ID, [{ label: 'Dana' }, { label: 'Me', owner: true }])
    rid = dana.rid
    await w0.recipients.setSent!(ID, [dana.rid], SENT)
    await w0.recipients.recordView({ artifactId: ID, rid: dana.rid, session: 's1', device: 'd1', at: '2026-11-02T10:00:00.000Z', addSeconds: 2 })
    await w0.recipients.recordView({ artifactId: ID, rid: dana.rid, session: 's1', device: 'd1', at: '2026-11-02T10:01:00.000Z', addSeconds: 0, click: 'reply' })
    await w0.recipients.recordView({ artifactId: ID, rid: dana.rid, session: 's0', device: 'd0', at: '2026-10-20T10:00:00.000Z', addSeconds: 2 })
    await w0.recipients.recordView({ artifactId: ID, rid: me.rid, session: 's9', device: 'd9', at: '2026-11-03T10:00:00.000Z', addSeconds: 2 })
    const all = entries(rid)
    const state = { entries: async (id: string) => all.filter((e) => e.artifactId === id) } as never
    const routes = createArtifactRoutes({
      store: w0.store, brand: freedomDefault, siteUrl: SITE, publishKey: () => 'k', readerSecret: () => SECRET,
      recipients: w0.recipients, recipientSecret: () => RSECRET, state, ownerEmail: 'robin@example.com', admins: ['casey@example.com'],
      readCookie: async () => undefined,
    })
    return { routes, rid }
  }
  const comment = (artifactId: string, readerKey: string, name: string | null, at: string, body: string, extra: Record<string, unknown> = {}): StateEntry => ({
    id: `c-${at}`, artifactId, slot: 'comments', shape: 'many', readerKey, writer: { name, anonymous: false }, value: { body, ...extra }, at,
  })
  const get = (routes: ReturnType<typeof createArtifactRoutes>, q: string, who: Who = { key: 'k' }) =>
    (routes as unknown as { ACTIVITY: (r: NextRequest) => Promise<Response> }).ACTIVITY(rq(`/api/activity?${q}`, 'GET', who))

  it('answers 401 with nothing, 403 for a stranger, 200 for the key and the owner', async () => {
    const { routes } = await seeded()
    expect((await get(routes, 'since=2026-11-01T00:00:00Z', {})).status).toBe(401)
    expect((await get(routes, 'since=2026-11-01T00:00:00Z', { as: stranger })).status).toBe(403)
    expect((await get(routes, 'since=2026-11-01T00:00:00Z', { as: owner })).status).toBe(200)
    expect((await get(routes, 'since=2026-11-01T00:00:00Z')).status).toBe(200)
  })
  it('refuses a missing or malformed since', async () => {
    const { routes } = await seeded()
    expect((await get(routes, '')).status).toBe(400)
    expect((await get(routes, 'since=yesterday')).status).toBe(400)
  })
  it('opens, clicks and comments across pages since the time, newest first, never the owner', async () => {
    const { routes, rid } = await seeded((rid) => [
      comment(ID, `r:${rid}`, 'Dana', '2026-11-02T11:00:00.000Z', 'Looks right'),
      comment(DOC, 'u:x1', 'Sam Lee', '2026-11-04T09:00:00.000Z', 'One question'),
      comment(DOC, 'u:x1', 'Sam Lee', '2026-10-01T09:00:00.000Z', 'Too old'),
      comment(DOC, 'u:owner', 'Robin', '2026-11-05T09:00:00.000Z', 'My reply', { publisher: true }),
    ])
    const j = await (await get(routes, 'since=2026-11-01T00:00:00Z')).json()
    expect(j.events.map((e: { kind: string; artifactId: string }) => `${e.kind}:${e.artifactId}`)).toEqual([
      `comment:${DOC}`, `comment:${ID}`, `click:${ID}`, `open:${ID}`,
    ])
    expect(j.events[1]).toMatchObject({ kind: 'comment', reader: { rid, label: 'Dana' }, text: 'Looks right', title: 'Per reader', url: `${SITE}/${ID}` })
    expect(j.events[2]).toMatchObject({ kind: 'click', cta: 'reply', reader: { rid, label: 'Dana' } })
    expect(j.events[3]).toMatchObject({ kind: 'open', at: '2026-11-02T10:00:00.000Z', device: 'd1' })
    expect(j.events[0]).toMatchObject({ reader: { name: 'Sam Lee' } })
    expect(j).toMatchObject({ more: false, cursor: null })
  })
  it('is capped, and the cursor pages through the rest with nothing twice', async () => {
    const { routes } = await seeded((rid) => [
      comment(ID, `r:${rid}`, 'Dana', '2026-11-02T11:00:00.000Z', 'a'),
      comment(DOC, 'u:x1', 'Sam', '2026-11-04T09:00:00.000Z', 'b'),
    ])
    const first = await (await get(routes, 'since=2026-11-01T00:00:00Z&limit=3')).json()
    expect(first.events).toHaveLength(3)
    expect(first.more).toBe(true)
    expect(typeof first.cursor).toBe('string')
    const next = await (await get(routes, `since=2026-11-01T00:00:00Z&limit=3&cursor=${encodeURIComponent(first.cursor)}`)).json()
    expect(next.events).toHaveLength(1)
    expect(next.more).toBe(false)
    const all = [...first.events, ...next.events].map((e: { kind: string; at: string }) => `${e.kind}@${e.at}`)
    expect(new Set(all).size).toBe(4)
    expect((await get(routes, 'since=2026-11-01T00:00:00Z&limit=9999')).status).toBe(400)
    expect((await get(routes, 'since=2026-11-01T00:00:00Z&cursor=garbage')).status).toBe(400)
  })
})

describe('LIST says how many live reader links each page has', () => {
  it('counts readers not revoked and never the owner; a page with none says 0', async () => {
    const w = world()
    const [a] = await w.recipients.add(ID, [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'Me', owner: true }])
    await w.recipients.revoke(ID, [a.rid])
    const j = await (await w.routes.LIST(rq('/api/artifacts', 'GET', { key: 'k' }))).json()
    const by = Object.fromEntries(j.pages.map((p: { id: string; readerLinks: number }) => [p.id, p.readerLinks]))
    expect(by).toEqual({ [ID]: 2, [DOC]: 0 })
  })
})

describe('the view counter counts readers, not the owner or a preview bot', () => {
  const open = (r: ReturnType<typeof createArtifactRoutes>) => r.Page({ params: Promise.resolve({ id: DOC }), searchParams: Promise.resolve({}) })
  it('a visitor counts', async () => {
    const w = world()
    await open(w.routes)
    expect(w.store.bumpViews).toHaveBeenCalledTimes(1)
  })
  it('the owner signed in does not, nor an admin', async () => {
    for (const who of [owner, admin]) {
      const w = world({ cookieAs: who })
      await open(w.routes)
      expect(w.store.bumpViews).not.toHaveBeenCalled()
    }
  })
  it('a link-preview bot does not', async () => {
    for (const ua of ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Twitterbot/1.0']) {
      const w = world({ ua })
      await open(w.routes)
      expect(w.store.bumpViews).not.toHaveBeenCalled()
    }
  })
})
