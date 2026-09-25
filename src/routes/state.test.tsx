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
  state: {
    writers: 'anyone', visibility: 'private',
    slots: {
      vote: { shape: 'one', visibility: 'tally' }, notes: { shape: 'many' },
      pick: { shape: 'one', visibility: 'shared' }, board: { shape: 'many', visibility: 'shared' },
    },
  },
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
const anb: ArtifactRecord = {
  id: 'anb23456', title: 'Also anyone', summary: 'S', template: 'document', markdown: '# also',
  createdAt: t, updatedAt: t, versions: [], views: 0,
  state: { writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one' } } },
}

const RECORDS: Record<string, ArtifactRecord> = { abc23456: abc, def23456: def, ghj23456: ghj, pwd23456: pwd, zzz99999: nostate, anb23456: anb }

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

function buildRoutes(opts: { store?: ArtifactStore; state?: StateStore | null; readers?: ReadersStore; clientIp?: (req: NextRequest) => string } = {}) {
  const store = opts.store ?? fakeStore()
  const state = opts.state === null ? undefined : (opts.state ?? createMemoryStateStore())
  const readers = opts.readers ?? fakeReaders()
  const routes = createArtifactRoutes({
    store, state, readers, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readerSecret: () => SECRET, signInOrigin: 'https://accounts.example.com', clientIp: opts.clientIp,
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
    const res501 = await noStore.STATE_GET(stateGet('abc23456'), params('abc23456'))
    expect(res501.status).toBe(501)
    expect(await res501.json()).toEqual({ error: 'this host keeps no answers' })
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
    expect(await anon.json()).toEqual({
      error: 'sign in to answer',
      signIn: 'https://accounts.example.com/artifact/sign-in?to=https%3A%2F%2Fartifacts.example.com%2Fghj23456',
    })
    const notListed = await routes.STATE_POST(
      statePost('ghj23456', { slot: 'vote', op: 'set', value: 1 }, `${GRANT_COOKIE}=${mintGrant(SECRET, outsider)}`), params('ghj23456'),
    )
    expect(notListed.status).toBe(403)
    expect(await notListed.json()).toEqual({ error: 'this page is not open to you' })
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

describe('fix round 1', () => {
  it('shared slots never leak reader keys, raw one-entry ids, or emails', async () => {
    const { routes } = buildRoutes()
    const memberCookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}`
    const anonPickRes = await routes.STATE_POST(statePost('abc23456', { slot: 'pick', op: 'set', value: 'red' }), params('abc23456'))
    expect(anonPickRes.status).toBe(200)
    await routes.STATE_POST(statePost('abc23456', { slot: 'pick', op: 'set', value: 'blue' }, memberCookie), params('abc23456'))
    const boardRes = await routes.STATE_POST(statePost('abc23456', { slot: 'board', op: 'append', value: 'hi' }, memberCookie), params('abc23456'))
    expect(boardRes.status).toBe(200)
    const get = await routes.STATE_GET(stateGet('abc23456', memberCookie), params('abc23456'))
    const getBody = await get.json()
    const boardBody = await boardRes.json()
    for (const body of [getBody, boardBody]) {
      const text = JSON.stringify(body)
      expect(text).not.toContain('@')
      // No reader-key-shaped id (u:<uid> or a:<anonId>) and no raw "<page>__<slot>__..." id.
      expect(text).not.toMatch(/[au]:[A-Za-z0-9_-]/)
      expect(text).not.toContain('abc23456__pick__')
    }
    const picked = getBody.slots.pick.shared as { id: string }[]
    expect(picked).toHaveLength(2)
    for (const s of picked) expect(s.id).toMatch(/^[0-9a-f]{16}$/)
    const boarded = getBody.slots.board.shared as { id: string }[]
    expect(boarded).toHaveLength(1)
    // "many" ids are not reader-keyed, so they pass through unhashed.
    expect(boarded[0].id).not.toMatch(/^[0-9a-f]{16}$/)
  })

  it('signing in on one page moves the anonymous answers on every page, not just this one', async () => {
    const state = createMemoryStateStore()
    const { routes } = buildRoutes({ state })
    const first = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 'from-abc' }), params('abc23456'))
    const anonId = (first.headers.get('set-cookie') ?? '').split('=')[1].split(';')[0]
    const cookie = `${ANON_COOKIE}=${anonId}`
    await routes.STATE_POST(statePost('anb23456', { slot: 'vote', op: 'set', value: 'from-anb' }, cookie), params('anb23456'))
    const signInCookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}; ${cookie}`
    const res = await routes.STATE_GET(stateGet('abc23456', signInCookie), params('abc23456'))
    expect((await res.json()).slots.vote.mine).toBe('from-abc')
    const readerKey = `u:${member.uid}`
    expect((await state.entries('abc23456')).find((e) => e.slot === 'vote')?.readerKey).toBe(readerKey)
    expect((await state.entries('anb23456')).find((e) => e.slot === 'vote')?.readerKey).toBe(readerKey)
  })

  it('rate limiting honors a custom clientIp instead of x-forwarded-for', async () => {
    const { routes } = buildRoutes({ clientIp: () => 'pinned-ip' })
    let last
    for (let i = 0; i < 31; i++) {
      last = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: i }, undefined, { 'x-forwarded-for': `1.2.3.${i}` }), params('abc23456'))
    }
    expect(last!.status).toBe(429)
  })

  it('a body that parses to something other than an object → 400, never a 500', async () => {
    const { routes } = buildRoutes()
    for (const raw of ['null', '5', '[]', '"hi"', 'true']) {
      const res = await routes.STATE_POST(statePost('abc23456', raw), params('abc23456'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'body must be JSON' })
    }
  })

  it('a prototype-chain slot name never resolves through the prototype', async () => {
    const { routes } = buildRoutes()
    for (const slot of ['__proto__', 'constructor']) {
      const res = await routes.STATE_POST(statePost('abc23456', { slot, op: 'set', value: 1 }), params('abc23456'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: `no slot named ${slot} on this page` })
    }
  })

  it('a declared content-length over 16 KB is refused without reading the body', async () => {
    const { routes } = buildRoutes()
    const req = statePost('abc23456', { slot: 'vote', op: 'set', value: 1 }, undefined, { 'content-length': '999999' })
    const res = await routes.STATE_POST(req, params('abc23456'))
    expect(res.status).toBe(413)
  })

  it('a multibyte body over the byte cap is refused even though its character length is under it', async () => {
    const { routes } = buildRoutes()
    // Each character is 1 UTF-16 code unit but 3 UTF-8 bytes; raw.length would stay under 16 KB
    // while the actual byte size is nearly 3x that.
    const value = '中'.repeat(6000)
    const res = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value }), params('abc23456'))
    expect(res.status).toBe(413)
  })

  it('cannot dodge a shape change by publishing once without state in between', async () => {
    const state = createMemoryStateStore()
    // The page currently declares no state (its previous publish omitted it), but the answer
    // store still holds "many" entries from before that happened.
    await state.append({ artifactId: 'abc23456', slot: 'vote', writer: { key: 'a:zzzzzzzzzzzzzzzzzzzzzzzz', name: null, anonymous: true }, value: 'old' })
    const store = fakeStore({ get: vi.fn(async () => ({ ...abc, state: undefined })) })
    const { routes } = buildRoutes({ store, state })
    const text = [
      '---', 'title: Vote', 'summary: S', 'state:', '  writers: anyone', '  slots:', '    vote:', '      shape: one', '---', '# vote',
    ].join('\n')
    const res = await routes.POST(new NextRequest('https://artifacts.example.com/api/artifacts?id=abc23456', {
      method: 'POST', body: text, headers: { authorization: 'Bearer k', 'content-type': 'text/markdown' },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('slot "vote" changed shape from many to one; rename the slot instead')
    expect(store.save).not.toHaveBeenCalled()
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

describe('final review fixes', () => {
  const listedCookie = `${GRANT_COOKIE}=${mintGrant(SECRET, listed)}`

  it('1. a gated page refuses a listed reader who has not accepted the agreement, on GET and POST', async () => {
    const readers = fakeReaders()
    readers.acknowledged = vi.fn(async () => false)
    const { routes } = buildRoutes({ readers })
    const get = await routes.STATE_GET(stateGet('ghj23456', listedCookie), params('ghj23456'))
    expect(get.status).toBe(403)
    expect(await get.json()).toEqual({ error: 'accept the agreement first' })
    const post = await routes.STATE_POST(statePost('ghj23456', { slot: 'vote', op: 'set', value: 1 }, listedCookie), params('ghj23456'))
    expect(post.status).toBe(403)
    expect(await post.json()).toEqual({ error: 'accept the agreement first' })
    expect(readers.acknowledged).toHaveBeenCalledWith('ghj23456', listed.email)
    const { routes: acked } = buildRoutes()
    expect((await acked.STATE_GET(stateGet('ghj23456', listedCookie), params('ghj23456'))).status).toBe(200)
    expect((await acked.STATE_POST(statePost('ghj23456', { slot: 'vote', op: 'set', value: 1 }, listedCookie), params('ghj23456'))).status).toBe(200)
  })

  it('3. the publisher JSON and CSV carry the reader key, so DELETE ?reader= is usable', async () => {
    const { routes } = buildRoutes()
    const cookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}`
    await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: 'hello' }, cookie), params('abc23456'))
    const authed = (path: string) => routes.RESPONSES(new NextRequest(`https://artifacts.example.com/api/artifacts/abc23456/responses${path}`, {
      headers: { authorization: 'Bearer k' },
    }), params('abc23456'))
    expect((await (await authed('')).json()).responses[0].reader).toBe(`u:${member.uid}`)
    const lines = (await (await authed('?format=csv')).text()).split('\n')
    expect(lines[0]).toBe('slot,id,at,email,name,anonymous,reader,value')
    expect(lines[1]).toContain(`,false,u:${member.uid},`)
  })

  it('4. a slot at its page-wide cap refuses a new answer but still lets a reader replace their own', async () => {
    const memory = createMemoryStateStore()
    const full: StateStore = { ...memory, countSlot: async () => 2000 }
    const { routes } = buildRoutes({ state: full })
    const memberCookie = `${GRANT_COOKIE}=${mintGrant(SECRET, member)}`
    // The member already has a vote from before the slot filled up.
    await memory.set({ artifactId: 'abc23456', slot: 'vote', writer: { key: `u:${member.uid}`, uid: member.uid, name: member.name, anonymous: false }, value: 'old' })
    const replace = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 'new' }, memberCookie), params('abc23456'))
    expect(replace.status).toBe(200)
    expect((await replace.json()).slots.vote.mine).toBe('new')
    const refused = { error: 'this page is not taking more answers here' }
    const newOne = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 'x' }, listedCookie), params('abc23456'))
    expect(newOne.status).toBe(409)
    expect(await newOne.json()).toEqual(refused)
    const append = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: 'x' }, memberCookie), params('abc23456'))
    expect(append.status).toBe(409)
    expect(await append.json()).toEqual(refused)
  })

  it('7. a POST from a foreign Origin → 403; the site\'s own origin passes', async () => {
    const { routes } = buildRoutes()
    const foreign = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 1 }, undefined, { origin: 'https://evil.example.com' }), params('abc23456'))
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'wrong origin' })
    const same = await routes.STATE_POST(statePost('abc23456', { slot: 'vote', op: 'set', value: 1 }, undefined, { origin: 'https://artifacts.example.com' }), params('abc23456'))
    expect(same.status).toBe(200)
  })

  it('9. an anonymous remove with no cookie mints nothing and counts nothing; with a cookie it removes without counting', async () => {
    const memory = createMemoryStateStore()
    const counted = vi.fn(memory.countAnonWrite)
    const { routes, state } = buildRoutes({ state: { ...memory, countAnonWrite: counted } })
    const bare = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'remove' }), params('abc23456'))
    expect(bare.status).toBe(200)
    expect(bare.headers.get('set-cookie')).toBeNull()
    expect((await bare.json()).slots.notes.mine).toEqual([])
    expect(counted).not.toHaveBeenCalled()
    const first = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'append', value: 'n' }), params('abc23456'))
    const anonId = (first.headers.get('set-cookie') ?? '').split('=')[1].split(';')[0]
    expect(counted).toHaveBeenCalledTimes(1)
    const removed = await routes.STATE_POST(statePost('abc23456', { slot: 'notes', op: 'remove' }, `${ANON_COOKIE}=${anonId}`), params('abc23456'))
    expect(removed.status).toBe(200)
    expect(counted).toHaveBeenCalledTimes(1)
    expect((await state!.entries('abc23456')).filter((e) => e.slot === 'notes')).toHaveLength(0)
  })

  it('10. publishing state: to a host with no state store succeeds with a warning', async () => {
    const store = fakeStore()
    const { routes } = buildRoutes({ store, state: null })
    const text = ['---', 'title: Vote', 'summary: S', 'state:', '  slots:', '    vote:', '      shape: one', '---', '# vote'].join('\n')
    const res = await routes.POST(new NextRequest('https://artifacts.example.com/api/artifacts?id=abc23456', {
      method: 'POST', body: text, headers: { authorization: 'Bearer k', 'content-type': 'text/markdown' },
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).warning).toBe('this host keeps no answers; state: is stored but inert')
    const { routes: withState } = buildRoutes({ store: fakeStore() })
    const plain = await withState.POST(new NextRequest('https://artifacts.example.com/api/artifacts?id=abc23456', {
      method: 'POST', body: text, headers: { authorization: 'Bearer k', 'content-type': 'text/markdown' },
    }))
    expect((await plain.json()).warning).toBeUndefined()
  })
})

describe('rateKey', () => {
  it('5. is an HMAC keyed by the reader secret when set, else by the site URL; stable and 16 hex', async () => {
    const { rateKey } = await import('./state-routes.js')
    const site = 'https://artifacts.example.com'
    const plain = rateKey('1.2.3.4', site)
    expect(plain).toMatch(/^[0-9a-f]{16}$/)
    expect(rateKey('1.2.3.4', site)).toBe(plain)
    const keyed = rateKey('1.2.3.4', site, 'sekrit')
    expect(keyed).toMatch(/^[0-9a-f]{16}$/)
    expect(keyed).not.toBe(plain)
    expect(rateKey('1.2.3.4', site, 'other')).not.toBe(keyed)
    expect(rateKey('1.2.3.5', site, 'sekrit')).not.toBe(keyed)
    expect(rateKey('1.2.3.4', 'https://other.example.com', 'sekrit')).not.toBe(keyed)
  })
})
