import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { createRecipientsRoutes } from './recipients-routes.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { memoryArtifactStore } from './test-config.js'
import { parseRidParam, verifyRid } from '../artifacts/recipients.js'

const S = 's'.repeat(40)
function setup(page: Record<string, unknown> = { id: 'abcd2345', links: 'per-reader' }) {
  const recipients = memoryRecipientsStore()
  const comments: { slot: string; readerKey: string; at: string; value: unknown }[] = [{ slot: 'comments', readerKey: 'r:', at: '', value: {} }]
  const r = createRecipientsRoutes({ store: memoryArtifactStore([page]), recipients, recipientSecret: () => S, publishKey: () => 'k', pageUrl: (id) => `https://artifacts.example.com/${id}`,
    authed: (req) => req.headers.get('authorization') === 'Bearer k', state: { entries: async () => comments } as never })
  const call = (method: string, path: 'RECIPIENTS' | 'VIEWS', body?: unknown, key = 'k') => (r as unknown as Record<string, (q: NextRequest, c: unknown) => Promise<Response>>)[path](
    new NextRequest(`https://artifacts.example.com/api/artifacts/abcd2345/${path.toLowerCase()}`, { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id: 'abcd2345' }) })
  return { recipients, comments, call }
}

describe('recipients API', () => {
  it('needs the publish key', async () => {
    const { call } = setup()
    expect((await call('GET', 'RECIPIENTS', undefined, 'wrong')).status).toBe(401)
    expect((await call('GET', 'VIEWS', undefined, 'wrong')).status).toBe(401)
  })
  it('adds readers and answers each one its own working link', async () => {
    const { call } = setup()
    const res = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'Tim', note: 'Yours.' }, { label: 'Obedient Friends', group: true }] })).json()
    expect(res.added).toHaveLength(2)
    const p = parseRidParam(new URL(res.added[0].url).searchParams.get('r'))!
    expect(verifyRid(S, 'abcd2345', p.rid, p.sig)).toBe(true)
    expect(res.recipients.find((x: { label: string }) => x.label === 'Obedient Friends').group).toBe(true)
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
  it('refuses readers on a page that is not per-reader', async () => {
    const { call } = setup({ id: 'abcd2345' })
    expect((await call('POST', 'RECIPIENTS', { add: [{ label: 'A' }] })).status).toBe(409)
  })
  it('views answer one line per reader, with their comments', async () => {
    const { call, recipients, comments } = setup()
    const { added } = await (await call('POST', 'RECIPIENTS', { add: [{ label: 'Tim' }] })).json()
    await recipients.recordView({ artifactId: 'abcd2345', rid: added[0].rid, session: 's1', device: 'd1', at: '2026-10-11T10:00:00.000Z', addSeconds: 2 })
    comments.splice(0, 1, { slot: 'comments', readerKey: `r:${added[0].rid}`, at: '2026-10-11T10:01:00.000Z', value: { body: 'Beautiful' } })
    const v = await (await call('GET', 'VIEWS')).json()
    expect(v.recipients[0]).toMatchObject({ label: 'Tim', opened: true, comments: [{ text: 'Beautiful' }] })
  })
})
