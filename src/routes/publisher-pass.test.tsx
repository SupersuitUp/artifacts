// A publisher pass is accepted wherever the publish key is, and nowhere it is not configured.
// Every publish-key handler is driven three ways: no auth (must be 401, proving the route is
// gated), the tenant key, and a pass; the pass must get exactly what the key gets.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes, type ArtifactRoutesConfig } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { mintPublisherPass } from '../artifacts/publisher.js'
import { mintPass, mintGrant } from '../artifacts/reader.js'

const HOST = 'artifacts.example.com'
const SECRET = 'pass-secret'
const rec: ArtifactRecord = {
  id: 'abc23456', title: 'T', summary: 'S', template: 'document', markdown: '# hi',
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', versions: [], views: 0,
}
const store = (): ArtifactStore => ({
  get: vi.fn(async (id: string) => (id === 'abc23456' ? rec : null)),
  save: vi.fn(async () => ({ id: 'abc23456', version: 1, created: true })),
  delete: vi.fn(async () => true),
  bumpViews: vi.fn(async () => {}),
  history: vi.fn(async () => []),
  setNote: vi.fn(async () => true),
}) as unknown as ArtifactStore

const build = (extra: Partial<ArtifactRoutesConfig> = {}) =>
  createArtifactRoutes({ store: store(), state: createMemoryStateStore(), brand: freedomDefault, siteUrl: `https://${HOST}`, publishKey: () => 'k', ...extra })

const optedIn = () => build({ publisherSecret: () => SECRET, publisherHost: HOST })

type Routes = ReturnType<typeof createArtifactRoutes>
const id = { params: Promise.resolve({ id: 'abc23456' }) }
const asset = { params: Promise.resolve({ id: 'abc23456', name: 'x.png' }) }
const h = (auth?: string, more: Record<string, string> = {}) => ({ ...(auth ? { authorization: auth } : {}), ...more })
const GOOD = `---\ntitle: T\nsummary: S\n---\n# hi`

// Every handler the publish key guards, with a fresh request per call.
const CALLS: Record<string, (r: Routes, auth?: string) => Promise<Response>> = {
  POST: (r, a) => r.POST(new NextRequest(`https://${HOST}/api/artifacts`, { method: 'POST', body: GOOD, headers: h(a, { 'content-type': 'text/markdown' }) })),
  GET: (r, a) => r.GET(new NextRequest(`https://${HOST}/api/artifacts/abc23456`, { headers: h(a) }), id),
  DELETE: (r, a) => r.DELETE(new NextRequest(`https://${HOST}/api/artifacts/abc23456`, { method: 'DELETE', headers: h(a) }), id),
  VERSIONS: (r, a) => r.VERSIONS(new NextRequest(`https://${HOST}/api/artifacts/abc23456/versions`, { headers: h(a) }), id),
  ACCESS: (r, a) => r.ACCESS(new NextRequest(`https://${HOST}/api/artifacts/abc23456/access`, { headers: h(a) }), id),
  READS: (r, a) => r.READS(new NextRequest(`https://${HOST}/api/artifacts/abc23456/reads`, { headers: h(a) }), id),
  PUT_ASSET: (r, a) => r.PUT_ASSET(new NextRequest(`https://${HOST}/api/artifacts/abc23456/assets/x.png`, { method: 'PUT', body: 'x', headers: h(a) }), asset),
  UPLOAD: (r, a) => r.UPLOAD(new NextRequest(`https://${HOST}/api/artifacts/abc23456/upload/x.png`, { method: 'POST', body: '{}', headers: h(a) }), asset),
  RESPONSES: (r, a) => r.RESPONSES(new NextRequest(`https://${HOST}/api/artifacts/abc23456/responses`, { headers: h(a) }), id),
  COMMENTS_FEED: (r, a) => r.COMMENTS_FEED(new NextRequest(`https://${HOST}/api/comments?since=2026-09-28T00:00:00Z`, { headers: h(a) })),
}

const now = () => Math.floor(Date.now() / 1000)
const who = { uid: 'uid9', email: 'sam@example.com', name: 'Sam Rivera' }

describe('publisher pass on every publish-key route', () => {
  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name}: a valid pass for this host gets exactly what the key gets`, async () => {
      const r = optedIn()
      expect((await call(r)).status, 'no auth').toBe(401)
      const withKey = (await call(r, 'Bearer k')).status
      expect(withKey).not.toBe(401)
      const pass = mintPublisherPass(SECRET, { ...who, host: HOST }, now() + 3600)
      expect((await call(r, `Bearer ${pass}`)).status).toBe(withKey)
    })
    it(`${name}: wrong host, expired, bad signature, reader pass and grant are refused`, async () => {
      const r = optedIn()
      const refused = [
        mintPublisherPass(SECRET, { ...who, host: 'artifacts.other.example' }, now() + 3600),
        mintPublisherPass(SECRET, { ...who, host: HOST }, now() - 1),
        mintPublisherPass('not-the-secret', { ...who, host: HOST }, now() + 3600),
        mintPass(SECRET, { ...who, member: true }, now() + 300),
        mintGrant(SECRET, { ...who, member: true }),
      ]
      for (const t of refused) expect((await call(r, `Bearer ${t}`)).status, t.slice(0, 2)).toBe(401)
    })
    it(`${name}: a host that did not opt in refuses a pass and still takes its key`, async () => {
      const pass = mintPublisherPass(SECRET, { ...who, host: HOST }, now() + 3600)
      for (const r of [build(), build({ publisherSecret: () => SECRET }), build({ publisherHost: HOST })]) {
        expect((await call(r, `Bearer ${pass}`)).status).toBe(401)
        expect((await call(r, 'Bearer k')).status).not.toBe(401)
      }
    })
  }
})
