import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { createRecipientsRoutes } from './recipients-routes.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { memoryArtifactStore } from './test-config.js'
import { parseRidParam, verifyRid } from '../artifacts/recipients.js'

const S = 's'.repeat(40)
function setup(page: Record<string, unknown> = { id: 'abcd2345', links: 'per-reader' }, secret = S) {
  const recipients = memoryRecipientsStore()
  const comments: { slot: string; readerKey: string; at: string; value: unknown }[] = [{ slot: 'comments', readerKey: 'r:', at: '', value: {} }]
  const r = createRecipientsRoutes({ store: memoryArtifactStore([page]), recipients, recipientSecret: () => secret, publishKey: () => 'k', pageUrl: (id) => `https://artifacts.example.com/${id}`,
    authed: (req) => req.headers.get('authorization') === 'Bearer k', state: { entries: async () => comments } as never })
  const call = (method: string, path: 'RECIPIENTS' | 'VIEWS', body?: unknown, key = 'k') => (r as unknown as Record<string, (q: NextRequest, c: unknown) => Promise<Response>>)[path](
    new NextRequest(`https://artifacts.example.com/api/artifacts/abcd2345/${path.toLowerCase()}`, { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id: 'abcd2345' }) })
  return { recipients, comments, call }
}

describe('recipients API', () => {
  it('a secret under 32 characters is treated as unset: the routes keep no per-reader links', async () => {
    const { call } = setup(undefined, 'too short')
    expect((await call('GET', 'RECIPIENTS')).status).toBe(501)
    expect((await call('POST', 'RECIPIENTS', { add: [{ label: 'A' }] })).status).toBe(501)
  })
  it('needs the publish key', async () => {
    const { call } = setup()
    expect((await call('GET', 'RECIPIENTS', undefined, 'wrong')).status).toBe(401)
    expect((await call('GET', 'VIEWS', undefined, 'wrong')).status).toBe(401)
  })
  it('adds readers and answers each one its own working link', async () => {
    const { call } = setup()
    const res = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'Reader A', note: 'Yours.' }, { label: 'Example Group', group: true }] })).json()
    expect(res.added).toHaveLength(2)
    const p = parseRidParam(new URL(res.added[0].url).searchParams.get('r'))!
    expect(verifyRid(S, 'abcd2345', p.rid, p.sig)).toBe(true)
    expect(res.recipients.find((x: { label: string }) => x.label === 'Example Group').group).toBe(true)
  })
  it('revokes one, then all, and Keep clears the expiry', async () => {
    const { call } = setup()
    const { added } = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'A' }, { label: 'B' }], expires: '2027-01-09T00:00:00.000Z' })).json()
    const one = await (await call('POST', 'RECIPIENTS', { revoke: [added[0].rid] })).json()
    expect(one.revoked).toEqual([added[0].rid])
    expect(one.recipients.filter((x: { revoked: boolean }) => x.revoked)).toHaveLength(1)
    const all = await (await call('POST', 'RECIPIENTS', { revoke: '*' })).json()
    expect(all.recipients.every((x: { revoked: boolean }) => x.revoked)).toBe(true)
    const kept = await (await call('POST', 'RECIPIENTS', { expires: null })).json()
    expect(kept).toMatchObject({ expireAt: null, keep: true })
  })
  it('views: a page with no readers yet answers 200 with none; a missing page or a bad id answers 404', async () => {
    const { call } = setup()
    const res = await call('GET', 'VIEWS')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'abcd2345', recipients: [] })
    const route = createRecipientsRoutes({ store: memoryArtifactStore([]), recipients: memoryRecipientsStore(), recipientSecret: () => S, publishKey: () => 'k', pageUrl: (id) => id, authed: () => true })
    const get = (id: string) => route.VIEWS(new NextRequest('https://a.example/x'), { params: Promise.resolve({ id }) })
    expect((await get('abcd2345')).status).toBe(404)
    expect((await get('../x')).status).toBe(404)
  })
  it('refuses readers on a page that is not per-reader', async () => {
    const { call } = setup({ id: 'abcd2345' })
    expect((await call('POST', 'RECIPIENTS', { add: [{ label: 'A' }] })).status).toBe(409)
  })
  it('views answer one line per reader, with their comments', async () => {
    const { call, recipients, comments } = setup()
    const { added } = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'Reader A' }] })).json()
    await recipients.recordView({ artifactId: 'abcd2345', rid: added[0].rid, session: 's1', device: 'd1', at: '2026-10-11T10:00:00.000Z', addSeconds: 2 })
    comments.splice(0, 1, { slot: 'comments', readerKey: `r:${added[0].rid}`, at: '2026-10-11T10:01:00.000Z', value: { body: 'Beautiful' } })
    const v = await (await call('GET', 'VIEWS')).json()
    expect(v.recipients[0]).toMatchObject({ label: 'Reader A', opened: true, comments: [{ text: 'Beautiful' }] })
  })
  it('refuses an empty label or a null element with 400, and an expiry in the past', async () => {
    const { call } = setup()
    expect((await call('POST', 'RECIPIENTS', { add: [{ label: '  ' }] })).status).toBe(400)
    expect((await call('POST', 'RECIPIENTS', { add: [null] })).status).toBe(400)
    expect((await call('POST', 'RECIPIENTS', { expires: '2020-01-01T00:00:00.000Z' })).status).toBe(400)
    expect((await call('POST', 'RECIPIENTS', { expires: 'nonsense' })).status).toBe(400)
  })
  it('a reader is added with a feedback window, one reader\'s window is moved, and the listing and views carry it', async () => {
    const { call } = setup()
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const later = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const made = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'Reader A', closes: soon }, { label: 'Reader B' }] })).json()
    expect(made.recipients.map((x: { closesAt: string | null }) => x.closesAt)).toEqual([soon, null])
    const moved = await (await call('POST', 'RECIPIENTS', { closes: { rids: [made.added[0].rid], at: later } })).json()
    expect(moved.windowed).toEqual([made.added[0].rid])
    expect(moved.recipients[0].closesAt).toBe(later)
    expect(moved.recipients[1].closesAt).toBeNull()
    const v = await (await call('GET', 'VIEWS')).json()
    expect(v.recipients[0].closesAt).toBe(later)
  })
  it('an owner added with a window gets none: their link would offer Share and then be refused', async () => {
    const { call } = setup()
    const past = '2020-01-01T00:00:00.000Z'
    const made = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'Robin', owner: true, closes: past }, { label: 'Reader A', closes: past }] })).json()
    expect(made.recipients.map((x: { owner: boolean; closesAt: string | null }) => [x.owner, x.closesAt])).toEqual([[true, null], [false, past]])
  })
  it('refuses a window that is not a time, in words', async () => {
    const { call } = setup()
    expect((await call('POST', 'RECIPIENTS', { add: [{ label: 'C', closes: 'friday' }] })).status).toBe(400)
    expect((await call('POST', 'RECIPIENTS', { closes: { rids: '*', at: 'never' } })).status).toBe(400)
    expect((await call('POST', 'RECIPIENTS', { closes: { rids: 'everyone', at: null } })).status).toBe(400)
  })
})
