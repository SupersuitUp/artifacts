import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { ANON_COOKIE } from './state-routes.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { createMemoryStateStore, type StateStore } from '../artifacts/state-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { unlockCookieName, keyHash } from '../artifacts/unlock.js'

const SECRET = 'sekrit'
const t = '2026-09-24T00:00:00Z'

const abc: ArtifactRecord = {
  id: 'abc23456', title: 'Vote', summary: 'S', template: 'document', markdown: '# vote',
  createdAt: t, updatedAt: t, versions: [], views: 0,
  state: { writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one', visibility: 'tally' }, notes: { shape: 'many' } } },
}
const def: ArtifactRecord = {
  id: 'def23456', title: 'Signed', summary: 'S', template: 'document', markdown: '# signed',
  createdAt: t, updatedAt: t, versions: [], views: 0,
  state: { writers: 'signed-in', visibility: 'private', slots: { vote: { shape: 'one' } } },
}
const ghj: ArtifactRecord = {
  id: 'ghj23456', title: 'Gated', summary: 'S', template: 'document', markdown: '# gated', access: 'invite',
  createdAt: t, updatedAt: t, versions: [], views: 0,
  state: { writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one' } } },
}
const pwd: ArtifactRecord = {
  id: 'pwd23456', title: 'Locked', summary: 'S', template: 'document', markdown: '# locked', password: 'sesame',
  createdAt: t, updatedAt: t, versions: [], views: 0,
  state: { writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one' } } },
}
const nostate: ArtifactRecord = {
  id: 'zzz99999', title: 'Plain', summary: 'S', template: 'document', markdown: '# plain',
  createdAt: t, updatedAt: t, versions: [], views: 0,
}

const RECORDS: Record<string, ArtifactRecord> = { abc23456: abc, def23456: def, ghj23456: ghj, pwd23456: pwd, zzz99999: nostate }

function fakeStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    get: vi.fn(async (id: string) => RECORDS[id] ?? null),
    save: vi.fn(async () => ({ id: 'abc23456', version: 2, created: false })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    ...overrides,
  } as ArtifactStore
}

function fakeReaders(): ReadersStore {
  return {
    allowList: vi.fn(async () => [{ email: 'sam@example.com', name: 'Sam' }]),
    allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
    sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  }
}

function buildRoutes(opts: { store?: ArtifactStore; state?: StateStore | null; readers?: ReadersStore } = {}) {
  const store = opts.store ?? fakeStore()
  const state = opts.state === null ? undefined : (opts.state ?? createMemoryStateStore())
  const readers = opts.readers ?? fakeReaders()
  const routes = createArtifactRoutes({
    store, state, readers, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readerSecret: () => SECRET, signInOrigin: 'https://accounts.example.com',
  })
  return { routes, store, state, readers }
}

const member: Reader = { uid: 'u1', email: 'jordan@example.com', name: 'Jordan Lee', member: true }
const listed: Reader = { uid: 'u3', email: 'sam@example.com', name: 'Sam Reader', member: false }
const outsider: Reader = { uid: 'u4', email: 'other@example.com', name: 'Other', member: false }

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const stateGet = (id: string, cookie?: string, extraHeaders: Record<string, string> = {}) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, { headers: { ...(cookie ? { cookie } : {}), ...extraHeaders } })
const statePost = (id: string, body: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extraHeaders },
  })

describe('STATE_GET', () => {
  it('1. a page with no state → 404; a host with no state store → 501', async () => {
    const { routes } = buildRoutes()
    const noState = await routes.STATE_GET(stateGet('zzz99999'), params('zzz99999'))
    expect(noState.status).toBe(404)
    expect(await noState.json()).toEqual({ error: 'this page takes no answers' })
    const { routes: noStore } = buildRoutes({ state: null })
    expect((await noStore.STATE_GET(stateGet('abc23456'), params('abc23456'))).status).toBe(501)
  })
})

describe('STATE_POST', () => {
  it('2. an unknown slot → 400', async () => {
    const { routes } = buildRoutes()
    const res = await routes.STATE_POST(statePost('abc23456', { slot: 'nope', op: 'set', value: 1 }), params('abc23456'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no slot named nope on this page' })
  })

  it('3. set on a many slot, or append on a one slot → 400', async () => {
    const { routes } = buildRoutes()
    const setMany = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'set', value: 1 }), params('abc23456'))
    expect(setMany.status).toBe(400)
    expect((await setMany.json()).error).toBe('slot notes takes append')
    const appendOne = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'append', value: 1 }), params('abc23456'))
    expect(appendOne.status).toBe(400)
    expect((await appendOne.json()).error).toBe('slot vote takes set')
  })

  it('4. an anonymous POST to a public/anyone page sets a cookie, and a GET with it shows vote.mine', async () => {
    const { routes } = buildRoutes()
    const res = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 'yes' }), params('abc23456'))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(new RegExp(`^${ANON_COOKIE}=[A-Za-z0-9]{24}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$`))
    const anonId = setCookie.split('=')[1].split(';')[0]
    const g = await routes.STATE_GET(stateGet('abc23456', `${ANON_COOKIE}=${anonId}`), params('abc23456'))
    expect((await g.json()).slots.vote.mine).toBe('yes')
  })

  it('5. the 31st anonymous write in one minute from one x-forwarded-for → 429', async () => {
    const { routes } = buildRoutes()
    const ip = { 'x-forwarded-for': '1.2.3.4' }
    let last
    for (let i = 0; i < 31; i++) {
      last = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: i }, undefined, ip), params('abc23456'))
    }
    expect(last!.status).toBe(429)
    expect(await last!.json()).toEqual({ error: 'too many answers from here; try again in a minute' })
  })

  it('6. an anonymous POST to a signed-in-only page → 401 with a sign-in link', async () => {
    const { routes } = buildRoutes()
    const res = await routes.STATE_POST(statePost('def23456', { slot: 'vote', op: 'set', value: 1 }), params('def23456'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('sign in to answer')
    expect(body.signIn).toBe('https://accounts.example.com/artifact/sign-in?to=https%3A%2F%2Fartifacts.example.com%2Fdef23456')
  })

  it('7. a gated page ignores its file\'s "anyone": anonymous 401, a signed-in non-listed reader 403, a listed reader 200', async () => {
    const { routes } = buildRoutes()
    const anon = await routes.STATE_POST(statePost('ghj23456', { slot: 'vote', op: 'set', value: 1 }), params('ghj23456'))
    expect(anon.status).toBe(401)
    const notListed = await routes.STATE_POST(
      statePost('ghj23456', { slot: 'vote', op: 'set', value: 1 }, `${GRANT_COOKIE}=${mintGrant(SECRET, outsider)}`), params('ghj23456'),
    )
    expect(notListed.status).toBe(403)
    const ok = await routes.STATE_POST(
      statePost('ghj23456', { slot: 'vote', op: 'set', value: 1 }, `${GRANT_COOKIE}=${mintGrant(SECRET, listed)}`), params('ghj23456'),
    )
    expect(ok.status).toBe(200)
  })

  it('8. a GET with both a valid grant and an anonymous cookie moves the answers and clears the cookie', async () => {
    const { routes } = buildRoutes()
    const anonRes = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 'anon-answer' }), params('abc23456'))
    const setCookie = anonRes.headers.get('set-cookie') ?? ''
    const anonId = setCookie.split('=')[1].split(';')[0]
    const cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}; ${ANON_COOKIE}=${anonId}`
    const res = await routes.STATE_GET(stateGet('abc23456', cookie), params('abc23456'))
    expect(res.status).toBe(200)
    expect((await res.json()).slots.vote.mine).toBe('anon-answer')
    const cleared = res.headers.get('set-cookie') ?? ''
    expect(cleared).toBe(`${ANON_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`)
  })

  it('9. the reader view never carries an email; reader is a first name or null; canWrite reflects the page', async () => {
    const { routes } = buildRoutes()
    const asListed = await routes.STATE_GET(stateGet('ghj23456', `${GRANT_COOKIE}=${mintGrant(SECRET, listed)}`), params('ghj23456'))
    const listedText = JSON.stringify(await asListed.json())
    expect(listedText).not.toContain('@example.com')
    expect(JSON.parse(listedText).reader).toEqual({ firstName: 'Sam' })
    const anonymous = await routes.STATE_GET(stateGet('def23456'), params('def23456'))
    const anonBody = await anonymous.json()
    expect(anonBody.reader).toBeNull()
    expect(anonBody.canWrite).toBe(false)
    const anyoneAnon = await routes.STATE_GET(stateGet('abc23456'), params('abc23456'))
    expect((await anyoneAnon.json()).canWrite).toBe(true)
  })

  it('10. a value over 8 KB → 400; a body over 16 KB → 413', async () => {
    const { routes } = buildRoutes()
    const big = await routes.STATE_POST(
      statePost('abc23456', { slot: 'notes', op: 'append', value: 'x'.repeat(8300) }), params('abc23456'),
    )
    expect(big.status).toBe(400)
    expect((await big.json()).error).toBe('value is over 8 KB')
    const huge = await routes.STATE_POST(
      statePost('abc23456', { slot: 'notes', op: 'append', value: 'x'.repeat(20000) }), params('abc23456'),
    )
    expect(huge.status).toBe(413)
  })

  it('11. op remove removes only the caller\'s entries', async () => {
    const { routes, state } = buildRoutes()
    const cookieA = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}`
    const cookieB = `${GRANT_COOKIE}=${mintGrant(SECRET, listed)}`
    await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: 'a1' }, cookieA), params('abc23456'))
    await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: 'b1' }, cookieB), params('abc23456'))
    await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'remove' }, cookieA), params('abc23456'))
    const left = await state!.entries('abc23456')
    expect(left.filter((e) => e.slot === 'notes').map((e) => e.value)).toEqual(['b1'])
  })

  it('12. append past 200 → 409', async () => {
    const { routes } = buildRoutes()
    const cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}`
    let last
    for (let i = 0; i < 201; i++) {
      last = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: i }, cookie), params('abc23456'))
    }
    expect(last!.status).toBe(409)
    expect(await last!.json()).toEqual({ error: 'you have left the most answers this page takes here' })
  })

  it('15. a password page: state GET without the unlock cookie → 403 "this page is locked"', async () => {
    const { routes } = buildRoutes()
    const res = await routes.STATE_GET(stateGet('pwd23456'), params('pwd23456'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'this page is locked' })
    const unlocked = await routes.STATE_GET(stateGet('pwd23456', `${unlockCookieName('pwd23456')}=${keyHash('pwd23456', 'sesame')}`), params('pwd23456'))
    expect(unlocked.status).toBe(200)
  })
})

describe('RESPONSES', () => {
  it('13. needs the publish key; GET carries emails; ?format=csv; DELETE removes a reader', async () => {
    const { routes, state } = buildRoutes()
    const cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}`
    await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: 'hello' }, cookie), params('abc23456'))
    const noKey = await routes.RESPONSES(new NextRequest('https://artifacts.example.com/api/artifacts/abc23456/responses'), params('abc23456'))
    expect(noKey.status).toBe(401)
    const authed = (path: string, init: RequestInit = {}) =>
      routes.RESPONSES(new NextRequest(`https://artifacts.example.com/api/artifacts/abc23456/responses${path}`, {
        ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: 'Bearer k' },
      }), params('abc23456'))
    const ok = await authed('')
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.id).toBe('abc23456')
    expect(body.responses[0]).toMatchObject({ slot: 'notes', value: 'hello', email: 'jordan@example.com' })
    const csv = await authed('?format=csv')
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('hello')
    const key = `u:${member.uid}`
    const del = await routes.RESPONSES(new NextRequest(`https://artifacts.example.com/api/artifacts/abc23456/responses?reader=${key}`, {
      method: 'DELETE', headers: { authorization: 'Bearer k' },
    }), params('abc23456'))
    expect(del.status).toBe(200)
    expect(await del.json()).toEqual({ removed: 1 })
    expect((await state!.entries('abc23456')).filter((e) => e.readerKey === key)).toHaveLength(0)
  })
})

describe('publish refuses a slot shape change', () => {
  it('14. changing a slot\'s shape on republish → 400 and store.save is not called', async () => {
    const store = fakeStore()
    const { routes } = buildRoutes({ store })
    const text = [
      '---',
      'title: Vote',
      'summary: S',
      'state:',
      '  writers: anyone',
      '  slots:',
      '    vote:',
      '      shape: many',
      '---',
      '# vote',
    ].join('\n')
    const res = await routes.POST(new NextRequest('https://artifacts.example.com/api/artifacts?id=abc23456', {
      method: 'POST', body: text, headers: { authorization: 'Bearer k', 'content-type': 'text/markdown' },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('slot "vote" changed shape from one to many; rename the slot instead')
    expect(store.save).not.toHaveBeenCalled()
  })
})
