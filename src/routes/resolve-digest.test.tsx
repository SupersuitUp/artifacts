// The resolve route feeds resolution digests (0.34.0): `onResolve` gets the whole thread and who
// resolved it, a reopen reaches it too, a throwing hook never costs the resolve, and a thread
// resolved before the hook was wired produces nothing.
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import { createMemoryStateStore, type Writer } from '../artifacts/state-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { mergeCommentsState } from '../artifacts/comments.js'
import { createResolveDigests, type DigestMessage, type ResolveEvent } from '../artifacts/resolve-digest.js'
import { createMemoryResolveDigestStore } from '../artifacts/resolve-digest-store.js'

const SECRET = 'sekrit'
const HOST = 'artifacts.example.com'
const t = '2026-10-12T00:00:00Z'
const merged = mergeCommentsState(undefined, 'signed-in', 'readers')
if (!merged.ok) throw new Error(merged.error)
const PAGE: ArtifactRecord = { id: 'rdg23456', title: 'The Paper', summary: 'S', template: 'document', markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 1, views: 0, comments: 'signed-in', commentsVisible: 'readers', state: merged.state }
const owner: Reader = { uid: 'u0', email: 'owner@example.com', name: 'Olive Owner', member: true }
const bo: Writer = { key: 'u:u5', uid: 'u5', email: 'bo@example.com', name: 'Bo Reader', anonymous: false }
const kim: Writer = { key: 'u:u6', uid: 'u6', email: 'kim@example.com', name: 'Kim Reader', anonymous: false }
const anchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs' }

afterEach(() => { vi.useRealTimers() })

async function build(onResolve?: (e: ResolveEvent) => void | Promise<void>) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'))
  const state = createMemoryStateStore()
  const add = async (writer: Writer, body: string, parent?: string) => {
    const r = await state.append({ artifactId: PAGE.id, slot: 'comments', writer, value: { anchor, body, version: 1, ...(parent ? { parent } : {}) } })
    if ('full' in r) throw new Error('full')
    return r.id
  }
  const a = await add(bo, 'Which river?')
  const reply = await add(kim, 'Same question', a)
  const b = await add(bo, 'Second one')
  vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'))
  const store = { get: vi.fn(async (id: string) => (id === PAGE.id ? PAGE : null)) } as unknown as ArtifactStore
  const routes = createArtifactRoutes({
    store, state, brand: freedomDefault, siteUrl: `https://${HOST}`, publishKey: () => 'k',
    readerSecret: () => SECRET, ownerEmail: 'owner@example.com', onResolve,
  })
  return { routes, ids: { a, reply, b } }
}
const params = { params: Promise.resolve({ id: PAGE.id }) }
const req = (body: unknown, headers: Record<string, string>) => new NextRequest(`https://${HOST}/api/artifacts/${PAGE.id}/resolve`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
})
const asOwner = { cookie: `${GRANT_COOKIE}=${mintGrant(SECRET, owner)}`, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' }

describe('RESOLVE tells onResolve', () => {
  it('the whole thread, the resolution and the signed-in owner who did it', async () => {
    const seen: ResolveEvent[] = []
    const { routes, ids } = await build((e) => { seen.push(e) })
    expect((await routes.RESOLVE(req({ entry: ids.reply, note: 'Named it.' }, asOwner), params)).status).toBe(200)
    expect(seen).toHaveLength(1)
    const e = seen[0]
    expect(e).toMatchObject({ artifactId: PAGE.id, title: 'The Paper', url: `https://${HOST}/${PAGE.id}`, actor: { email: 'owner@example.com', publisher: false }, resolution: { by: 'Olive', note: 'Named it.' } })
    expect(e.thread.id).toBe(ids.a)
    expect(e.thread.entries.map((x) => x.id)).toEqual([ids.a, ids.reply])
  })

  it('a reopen with resolution null, and the publish key as the publisher', async () => {
    const seen: ResolveEvent[] = []
    const { routes, ids } = await build((e) => { seen.push(e) })
    await routes.RESOLVE(req({ entry: ids.b, resolved: false }, { authorization: 'Bearer k' }), params)
    expect(seen[0]).toMatchObject({ resolution: null, actor: { publisher: true } })
    expect(seen[0].actor.email).toBeUndefined()
  })

  it('a hook that throws never costs the resolve', async () => {
    const { routes, ids } = await build(() => { throw new Error('mailer down') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await routes.RESOLVE(req({ entry: ids.a }, asOwner), params)).status).toBe(200)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('end to end: resolve through the route, flush, one email per reader', () => {
  it('Bo gets one digest of their two comments; Kim gets their reply only; the owner gets nothing', async () => {
    const dstore = createMemoryResolveDigestStore()
    const sent: DigestMessage[] = []
    const digests = createResolveDigests({ store: dstore, send: async (m) => { sent.push(m) }, secret: () => 'stop', siteUrl: `https://${HOST}`, brandName: 'Example Co', ownerEmail: 'owner@example.com' })
    const { routes, ids } = await build(digests.onResolve)
    await routes.RESOLVE(req({ entry: ids.a, note: 'Named it.' }, asOwner), params)
    await routes.RESOLVE(req({ entry: ids.b }, asOwner), params)
    expect((await digests.flush({ now: new Date('2026-10-12T12:05:00.000Z') })).sent).toEqual([])
    await digests.flush({ now: new Date('2026-10-12T12:10:00.000Z') })
    expect(sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      ['bo@example.com', 'Olive resolved 2 of your comments on The Paper'],
      ['kim@example.com', 'Olive resolved your comment on The Paper'],
    ])
    const kimMail = sent.find((m) => m.to === 'kim@example.com')!
    expect(kimMail.text).toContain('Same question')
    expect(kimMail.text).not.toContain('Which river?')
    expect(kimMail.text).toContain(`#comment-${ids.reply}`)
  })

  it('threads resolved before the hook was wired produce no digest', async () => {
    const { routes, ids } = await build()
    await routes.RESOLVE(req({ entry: ids.a }, asOwner), params)
    const dstore = createMemoryResolveDigestStore()
    const send = vi.fn()
    const digests = createResolveDigests({ store: dstore, send, secret: () => 'stop', siteUrl: `https://${HOST}`, brandName: 'Example Co' })
    expect((await digests.flush({ now: new Date('2026-10-13T00:00:00.000Z') })).due).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})
