// Shared comments through the state API: who may write, what a comment must look like, replies one
// level deep, editing and deleting only your own, and the owner reading everything with names.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { FEEDBACK_CLOSED, NAME_NEEDED, mergeCommentsState, type CommentsMode, type CommentsVisible } from '../artifacts/comments.js'

const SECRET = 'sekrit'
const t = '2026-09-28T00:00:00Z'
const page = (id: string, comments: CommentsMode, visible: CommentsVisible, extra: Partial<ArtifactRecord> = {}): ArtifactRecord => {
  const merged = mergeCommentsState(extra.state, comments, visible)
  if (!merged.ok) throw new Error(merged.error)
  return {
    id, title: 'Page', summary: 'S', template: 'document', markdown: 'The river runs north.', createdAt: t, updatedAt: t, version: 2, views: 0,
    comments, commentsVisible: visible, ...extra, ...(merged.state ? { state: merged.state } : {}),
  }
}
const RECORDS: Record<string, ArtifactRecord> = {
  // Anyone may comment; only the owner sees the comments (the default).
  cmt23456: page('cmt23456', 'anyone', 'owner'),
  // Signed-in readers only, and every reader sees the thread.
  cmr23456: page('cmr23456', 'signed-in', 'readers'),
  // Comments off, but the page takes votes from anyone.
  cxf23456: page('cxf23456', 'off', 'owner', { state: { writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one' } } } }),
  // Gated: `anyone` is forced to signed-in.
  cmg23456: page('cmg23456', 'anyone', 'readers', { access: 'invite' }),
  // Comments from anyone beside votes from signed-in readers only.
  prr23456: page('prr23456', 'anyone', 'owner', { links: 'per-reader' }),
  // Per-reader, and every note carries a name: `comment_name: required`.
  prn23456: page('prn23456', 'anyone', 'owner', { links: 'per-reader', commentName: 'required' }),
  cmv23456: page('cmv23456', 'anyone', 'owner', { state: { writers: 'signed-in', visibility: 'private', slots: { vote: { shape: 'one' } } } }),
}

function fakeStore(): ArtifactStore {
  return {
    get: vi.fn(async (id: string) => RECORDS[id] ?? null),
    save: vi.fn(async () => ({ id: 'cmt23456', version: 2, created: false })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
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
function build(as: Reader | null = null, keepsAnswers = true, extra: Partial<Parameters<typeof createArtifactRoutes>[0]> = {}) {
  const state = createMemoryStateStore()
  const routes = createArtifactRoutes({
    readCookie: async (name) => (name === GRANT_COOKIE && as ? mintGrant(SECRET, as) : undefined),
    store: fakeStore(), state: keepsAnswers ? state : undefined, readers: fakeReaders(), brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readerSecret: () => SECRET, signInOrigin: 'https://accounts.example.com', ownerEmail: 'Owner@Example.com', admins: ['Admin@Example.com'], ...extra,
  })
  return { routes, state }
}

const owner: Reader = { uid: 'u0', email: 'owner@example.com', name: 'Olive Owner', member: true }
const sam: Reader = { uid: 'u3', email: 'sam@example.com', name: 'Sam Reader', member: false }
const admin: Reader = { uid: 'u9', email: 'admin@example.com', name: 'Ada Admin', member: true }
const jo: Reader = { uid: 'u5', email: 'jo@example.com', name: 'Jo Other', member: true }
const grant = (r: Reader) => `${GRANT_COOKIE}=${mintGrant(SECRET, r)}`

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (id: string, cookie?: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, { headers: cookie ? { cookie } : {} })
const post = (id: string, body: unknown, cookie?: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
  })
const responses = (id: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/responses`, { headers: { authorization: 'Bearer k' } })

const anchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs north.' }
const comment = (body: string, extra: Record<string, unknown> = {}) => ({ slot: 'comments', op: 'append', value: { anchor, body, version: 2, ...extra } })
const anonCookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]
type Body = { slots: Record<string, { mine: { id: string; value: { body: string } }[]; shared?: { id: string; name: string; value: { body: string } }[] }>; owner?: boolean }

describe('shared comments on the state API', () => {
  it('an anonymous reader comments on a comments: anyone page, and reads it back as theirs', async () => {
    const { routes } = build()
    const res = await routes.STATE_POST(post('cmt23456', comment('Which river?')), params('cmt23456'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.slots.comments.mine.map((e) => e.value.body)).toEqual(['Which river?'])
    // Owner-only visibility: a reader sees no shared list.
    expect(body.slots.comments.shared).toBeUndefined()
  })

  it('a malformed comment is refused by the server even with the UI bypassed', async () => {
    const { routes } = build()
    for (const bad of [
      { slot: 'comments', op: 'append', value: 'loose text' },
      { slot: 'comments', op: 'append', value: { body: 'no anchor', version: 2 } },
      comment('x'.repeat(4001)),
      comment('fine', { version: 0 }),
      comment('fine', { name: 'Olive Owner' }),
    ]) {
      const res = await routes.STATE_POST(post('cmt23456', bad), params('cmt23456'))
      expect(res.status).toBe(400)
    }
  })

  it('comments: off refuses a shared comment as an undeclared slot, whatever the client sends', async () => {
    const { routes } = build()
    const res = await routes.STATE_POST(post('cxf23456', comment('sneaking in')), params('cxf23456'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no slot named comments on this page' })
  })

  it('comments: signed-in refuses an anonymous comment, and takes a signed-in one', async () => {
    const { routes } = build()
    expect((await routes.STATE_POST(post('cmr23456', comment('anon')), params('cmr23456'))).status).toBe(401)
    expect((await routes.STATE_POST(post('cmr23456', comment('signed'), grant(sam)), params('cmr23456'))).status).toBe(200)
  })

  it('a gated page forces signed-in: `comments: anyone` still refuses an anonymous comment', async () => {
    const { routes } = build()
    expect((await routes.STATE_POST(post('cmg23456', comment('anon')), params('cmg23456'))).status).toBe(401)
    expect((await routes.STATE_POST(post('cmg23456', comment('listed'), grant(sam)), params('cmg23456'))).status).toBe(200)
  })

  it('the comments slot names its own writers: anyone may comment where only signed-in readers may vote', async () => {
    const { routes } = build()
    expect((await routes.STATE_POST(post('cmv23456', comment('anon comment')), params('cmv23456'))).status).toBe(200)
    expect((await routes.STATE_POST(post('cmv23456', { slot: 'vote', op: 'set', value: 'yes' }), params('cmv23456'))).status).toBe(401)
  })
})

describe('replies, one level deep', () => {
  it('a reader replies to a comment they can see; a reply to a reply is refused', async () => {
    const { routes } = build()
    const first = (await (await routes.STATE_POST(post('cmr23456', comment('Top'), grant(sam)), params('cmr23456'))).json()) as Body
    const topId = first.slots.comments.mine[0].id
    const r = await routes.STATE_POST(post('cmr23456', comment('Reply', { parent: topId }), grant(jo)), params('cmr23456'))
    expect(r.status).toBe(200)
    const replyId = ((await r.json()) as Body).slots.comments.mine[0].id
    const deep = await routes.STATE_POST(post('cmr23456', comment('Deeper', { parent: replyId }), grant(sam)), params('cmr23456'))
    expect(deep.status).toBe(400)
    expect(((await deep.json()) as { error: string }).error).toMatch(/one level/)
  })

  it('on an owner-only page a reader cannot reply to another reader\'s comment, which they cannot see', async () => {
    const { routes } = build()
    const first = (await (await routes.STATE_POST(post('cmt23456', comment('Top'), grant(sam)), params('cmt23456'))).json()) as Body
    const topId = first.slots.comments.mine[0].id
    const r = await routes.STATE_POST(post('cmt23456', comment('Reply', { parent: topId }), grant(jo)), params('cmt23456'))
    expect(r.status).toBe(400)
    // The owner can, and so can the comment's own writer.
    expect((await routes.STATE_POST(post('cmt23456', comment('Owner reply', { parent: topId }), grant(owner)), params('cmt23456'))).status).toBe(200)
    expect((await routes.STATE_POST(post('cmt23456', comment('Adding', { parent: topId }), grant(sam)), params('cmt23456'))).status).toBe(200)
  })
})

describe('editing and deleting your own comment only', () => {
  it('a writer replaces their own comment; another reader and an anonymous reader are refused', async () => {
    const { routes, state } = build()
    const first = (await (await routes.STATE_POST(post('cmr23456', comment('Tpyo'), grant(sam)), params('cmr23456'))).json()) as Body
    const id = first.slots.comments.mine[0].id
    const edit = await routes.STATE_POST(post('cmr23456', { slot: 'comments', op: 'replace', entry: id, value: { anchor, body: 'Typo', version: 2 } }, grant(sam)), params('cmr23456'))
    expect(edit.status).toBe(200)
    expect(((await edit.json()) as Body).slots.comments.mine[0].value.body).toBe('Typo')
    const other = await routes.STATE_POST(post('cmr23456', { slot: 'comments', op: 'replace', entry: id, value: { anchor, body: 'Hijacked', version: 2 } }, grant(jo)), params('cmr23456'))
    expect(other.status).toBe(404)
    const anon = await routes.STATE_POST(post('cmt23456', { slot: 'comments', op: 'replace', entry: id, value: { anchor, body: 'Hijacked', version: 2 } }), params('cmt23456'))
    expect(anon.status).toBe(404)
    expect((await state.entries('cmr23456')).map((e) => (e.value as { body: string }).body)).toEqual(['Typo'])
  })

  it('an edit may not turn a comment into a reply or a reply into a comment', async () => {
    const { routes } = build()
    const top = (await (await routes.STATE_POST(post('cmr23456', comment('Top'), grant(sam)), params('cmr23456'))).json()) as Body
    const topId = top.slots.comments.mine[0].id
    const other = (await (await routes.STATE_POST(post('cmr23456', comment('Other'), grant(sam)), params('cmr23456'))).json()) as Body
    const otherId = other.slots.comments.mine.find((e) => e.value.body === 'Other')!.id
    const res = await routes.STATE_POST(post('cmr23456', { slot: 'comments', op: 'replace', entry: otherId, value: { anchor, body: 'Other', version: 2, parent: topId } }, grant(sam)), params('cmr23456'))
    expect(res.status).toBe(400)
  })

  it('a writer deletes their own; deleting someone else\'s is refused and leaves it in place', async () => {
    const { routes, state } = build()
    const first = (await (await routes.STATE_POST(post('cmr23456', comment('Mine'), grant(sam)), params('cmr23456'))).json()) as Body
    const id = first.slots.comments.mine[0].id
    const other = await routes.STATE_POST(post('cmr23456', { slot: 'comments', op: 'remove', entry: id }, grant(jo)), params('cmr23456'))
    expect(other.status).toBe(404)
    const anonPost = await routes.STATE_POST(post('cmt23456', comment('anon')), params('cmt23456'))
    const anonCookie = anonCookieOf(anonPost)
    const anon = await routes.STATE_POST(post('cmr23456', { slot: 'comments', op: 'remove', entry: id }, anonCookie), params('cmr23456'))
    expect(anon.status).toBe(401)
    expect(await state.entries('cmr23456')).toHaveLength(1)
    const mine = await routes.STATE_POST(post('cmr23456', { slot: 'comments', op: 'remove', entry: id }, grant(sam)), params('cmr23456'))
    expect(mine.status).toBe(200)
    expect(await state.entries('cmr23456')).toHaveLength(0)
  })
})

describe('the owner', () => {
  it('signed in as the owner sees every comment with full names, on an owner-only page', async () => {
    const { routes } = build()
    await routes.STATE_POST(post('cmt23456', comment('From Sam'), grant(sam)), params('cmt23456'))
    await routes.STATE_POST(post('cmt23456', comment('From Jo'), grant(jo)), params('cmt23456'))
    await routes.STATE_POST(post('cmt23456', comment('From nobody')), params('cmt23456'))
    const asOwner = (await (await routes.STATE_GET(get('cmt23456', grant(owner)), params('cmt23456'))).json()) as Body
    expect(asOwner.owner).toBe(true)
    // Three writes inside one millisecond tie on time; the order among them is the store's.
    expect(asOwner.slots.comments.shared!.map((e) => [e.name, e.value.body]).sort()).toEqual([
      ['Jo Other', 'From Jo'], ['Sam Reader', 'From Sam'], ['a reader', 'From nobody'],
    ])
    // A reader on the same page sees only their own, and is not told they are the owner.
    const asSam = (await (await routes.STATE_GET(get('cmt23456', grant(sam)), params('cmt23456'))).json()) as Body
    expect(asSam.owner).toBeUndefined()
    expect(asSam.slots.comments.shared).toBeUndefined()
    expect(asSam.slots.comments.mine.map((e) => e.value.body)).toEqual(['From Sam'])
  })

  it('an admin, like the owner, sees every comment with names, so a link to one opens', async () => {
    const { routes } = build()
    await routes.STATE_POST(post('cmt23456', comment('From Sam'), grant(sam)), params('cmt23456'))
    const asAdmin = (await (await routes.STATE_GET(get('cmt23456', grant(admin)), params('cmt23456'))).json()) as Body
    expect(asAdmin.owner).toBe(true)
    expect(asAdmin.slots.comments.shared!.map((e) => [e.name, e.value.body])).toEqual([['Sam Reader', 'From Sam']])
  })

  it('the owner sees the name an anonymous reader declared, not "a reader"', async () => {
    const { routes } = build()
    await routes.STATE_POST(post('cmt23456', comment('Signed', { by: 'Ada Lovelace' })), params('cmt23456'))
    const asOwner = (await (await routes.STATE_GET(get('cmt23456', grant(owner)), params('cmt23456'))).json()) as Body
    expect(asOwner.slots.comments.shared!.map((e) => e.name)).toEqual(['Ada Lovelace'])
  })

  it('/responses carries the comments slot for the publisher', async () => {
    const { routes } = build()
    await routes.STATE_POST(post('cmt23456', comment('For the record'), grant(sam)), params('cmt23456'))
    const r = (await (await routes.RESPONSES(responses('cmt23456'), params('cmt23456'))).json()) as { responses: { slot: string; value: { body: string }; email: string }[] }
    expect(r.responses).toHaveLength(1)
    expect(r.responses[0]).toMatchObject({ slot: 'comments', email: 'sam@example.com', value: { body: 'For the record' } })
  })
})

describe('the page tells the comment layer what this reader may do', () => {
  const layer = async (id: string, as: Reader | null, keepsAnswers = true) => {
    const { routes } = build(as, keepsAnswers)
    const html = renderToStaticMarkup(await routes.Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))
    const m = /data-comment-layer="([^"]+)" data-comment-can-share="(yes|no)"/.exec(html)
    return m ? [m[1], m[2]] : null
  }
  it('comments: anyone lets anyone share; comments: off lets nobody', async () => {
    expect(await layer('cmt23456', null)).toEqual(['anyone', 'yes'])
    expect(await layer('cxf23456', sam)).toEqual(['off', 'no'])
  })
  it('comments: signed-in shares only for a signed-in reader', async () => {
    expect(await layer('cmr23456', null)).toEqual(['signed-in', 'no'])
    expect(await layer('cmr23456', sam)).toEqual(['signed-in', 'yes'])
  })
  it('a host that keeps no answers takes no shared comments, whatever the page says', async () => {
    expect(await layer('cmt23456', sam, false)).toEqual(['off', 'no'])
  })
  it('a gated page draws the layer for the reader let in, who may share', async () => {
    expect(await layer('cmg23456', sam)).toEqual(['anyone', 'yes'])
  })
})

describe('comments through a per-reader link', () => {
  const RS = 'r'.repeat(40)
  async function setup() {
    const recipients = memoryRecipientsStore()
    const [ada] = await recipients.add('prr23456', [{ label: 'Reader A' }])
    const [bea] = await recipients.add('prr23456', [{ label: 'Reader B' }])
    const { routes, state } = build(null, true, { recipients, recipientSecret: () => RS })
    const cookie = (r: { rid: string }) => `artifact_r_prr23456=${r.rid}.${ridSig(RS, 'prr23456', r.rid)}`
    return { recipients, routes, state, ada, bea, cookie }
  }
  it('a comment through a valid link is written as that reader, by label', async () => {
    const { recipients, routes, state, ada, cookie } = await setup()
    expect((await routes.STATE_POST(post('prr23456', comment('This moved me.'), cookie(ada)), params('prr23456'))).status).toBe(200)
    const [e] = (await state.entries('prr23456')).filter((x) => x.slot === 'comments')
    expect(e.readerKey).toBe(`r:${ada.rid}`)
    expect(e.writer.name).toBe('Reader A')
    await recipients.revoke('prr23456', [ada.rid])
    expect((await routes.STATE_POST(post('prr23456', comment('Again.'), cookie(ada)), params('prr23456'))).status).toBe(403)
  })
  it('after a reload the reader still sees their own comment as theirs, and can remove it', async () => {
    const { routes, ada, bea, cookie } = await setup()
    await routes.STATE_POST(post('prr23456', comment('Mine.'), cookie(ada)), params('prr23456'))
    const mine = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    expect(mine.canWrite).toBe(true)
    expect(JSON.stringify(mine.slots.comments.mine)).toContain('Mine.')
    const other = await (await routes.STATE_GET(get('prr23456', cookie(bea)), params('prr23456'))).json()
    expect(JSON.stringify(other.slots.comments.mine ?? [])).not.toContain('Mine.')
    const id = mine.slots.comments.mine[0].id
    expect((await routes.STATE_POST(post('prr23456', { slot: 'comments', op: 'remove', entry: id }, cookie(bea)), params('prr23456'))).status).toBe(404)
    expect((await routes.STATE_POST(post('prr23456', { slot: 'comments', op: 'remove', entry: id }, cookie(ada)), params('prr23456'))).status).toBe(200)
  })
  const reply = (id: string, body: unknown, key = 'k') => new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/reply`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  it('the publisher replies once to a reader\'s comment; that reader sees it and no other reader ever does', async () => {
    const { routes, state, ada, bea, cookie } = await setup()
    await routes.STATE_POST(post('prr23456', comment('Which river?'), cookie(ada)), params('prr23456'))
    await routes.STATE_POST(post('prr23456', comment('Reader B asks too.'), cookie(bea)), params('prr23456'))
    const [mine] = (await state.entries('prr23456')).filter((x) => x.readerKey === `r:${ada.rid}`)
    const first = await routes.REPLY(reply('prr23456', { entry: mine.id, body: 'Named the river in the second paragraph.', by: 'Robin', quote: 'river' }), params('prr23456'))
    expect(first.status).toBe(200)
    const made = await first.json()
    expect(made).toMatchObject({ id: 'prr23456', parent: mine.id, existing: false })
    const again = await (await routes.REPLY(reply('prr23456', { entry: mine.id, body: 'A different answer.' }), params('prr23456'))).json()
    expect(again).toEqual({ id: 'prr23456', entry: made.entry, parent: mine.id, existing: true })
    const adaView = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    expect(adaView.slots.comments.shared).toHaveLength(1)
    expect(adaView.slots.comments.shared[0]).toMatchObject({ id: made.entry, name: 'Robin', mine: false, value: { body: 'Named the river in the second paragraph.', parent: mine.id, publisher: true, anchor: { kind: 'text', quote: 'river' } } })
    const beaView = await (await routes.STATE_GET(get('prr23456', cookie(bea)), params('prr23456'))).json()
    expect(beaView.slots.comments.shared).toBeUndefined()
    expect(JSON.stringify(beaView)).not.toContain('Named the river')
  })
  it('a reply is not held to a reader\'s feedback window: it lands after that reader\'s window closed, with no name needed', async () => {
    const { recipients, routes, state, ada, bea, cookie } = await setup()
    await routes.STATE_POST(post('prr23456', comment('Which river?'), cookie(ada)), params('prr23456'))
    const [mine] = (await state.entries('prr23456')).filter((x) => x.readerKey === `r:${ada.rid}`)
    await recipients.setCloses!('prr23456', [ada.rid], new Date(Date.now() - 60_000).toISOString())
    const r = await routes.REPLY(reply('prr23456', { entry: mine.id, body: 'Fixed.' }), params('prr23456'))
    expect(r.status).toBe(200)
    const view = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    expect(view.slots.comments.shared).toHaveLength(1)
    expect(view.slots.comments.shared[0].name).toBe('the publisher')
    // A reply to a reply answers the thread, and a reader of another thread still sees nothing.
    const again = await (await routes.REPLY(reply('prr23456', { entry: (await r.json()).entry, body: 'More.' }), params('prr23456'))).json()
    expect(again).toMatchObject({ parent: mine.id, existing: true })
    const beaView = await (await routes.STATE_GET(get('prr23456', cookie(bea)), params('prr23456'))).json()
    expect(beaView.slots.comments.shared).toBeUndefined()
  })
  it('a reply needs the publish key, a real comment and some words; a reader cannot mark a comment as the publisher\'s', async () => {
    const { routes, state, ada, cookie } = await setup()
    await routes.STATE_POST(post('prr23456', comment('Which river?'), cookie(ada)), params('prr23456'))
    const [mine] = (await state.entries('prr23456')).filter((x) => x.slot === 'comments')
    expect((await routes.REPLY(reply('prr23456', { entry: mine.id, body: 'x' }, 'wrong'), params('prr23456'))).status).toBe(401)
    expect((await routes.REPLY(reply('prr23456', { entry: 'nope', body: 'x' }), params('prr23456'))).status).toBe(404)
    expect((await routes.REPLY(reply('prr23456', { entry: mine.id, body: '   ' }), params('prr23456'))).status).toBe(400)
    expect((await routes.REPLY(reply('prr23456', { entry: mine.id, body: 'x', extra: 1 }), params('prr23456'))).status).toBe(400)
    const c = comment('Pretending.') as { value: Record<string, unknown> }
    expect((await routes.STATE_POST(post('prr23456', { ...c, value: { ...c.value, publisher: true } }, cookie(ada)), params('prr23456'))).status).toBe(400)
  })
  it('after a reader\'s feedback window closes, a new comment is refused in words and the earlier one is still theirs to read', async () => {
    const { recipients, routes, ada, bea, cookie } = await setup()
    expect((await routes.STATE_POST(post('prr23456', comment('Before the close.'), cookie(ada)), params('prr23456'))).status).toBe(200)
    await recipients.setCloses!('prr23456', [ada.rid], new Date(Date.now() - 60_000).toISOString())
    const late = await routes.STATE_POST(post('prr23456', comment('Too late.'), cookie(ada)), params('prr23456'))
    expect(late.status).toBe(403)
    expect(await late.json()).toEqual({ error: FEEDBACK_CLOSED, closed: true })
    const view = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    expect(JSON.stringify(view.slots.comments.mine)).toContain('Before the close.')
    expect(view.feedback.closed).toBe(true)
    // Another reader's window is their own.
    expect((await routes.STATE_POST(post('prr23456', comment('Still open.'), cookie(bea)), params('prr23456'))).status).toBe(200)
  })
  it('an open window says when it closes, and a window that cannot be read as a time is closed', async () => {
    const { recipients, routes, ada, cookie } = await setup()
    const at = new Date(Date.now() + 86_400_000).toISOString()
    await recipients.setCloses!('prr23456', [ada.rid], at)
    const open = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    expect(open.feedback).toEqual({ closesAt: at, closed: false })
    await recipients.setCloses!('prr23456', [ada.rid], 'not-a-time')
    expect((await routes.STATE_POST(post('prr23456', comment('Any.'), cookie(ada)), params('prr23456'))).status).toBe(403)
    const bad = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    expect(bad.feedback).toEqual({ closesAt: 'not-a-time', closed: true })
  })
  it('a closed window still lets the reader remove their own earlier comment', async () => {
    const { recipients, routes, ada, cookie } = await setup()
    await routes.STATE_POST(post('prr23456', comment('Mine.'), cookie(ada)), params('prr23456'))
    await recipients.setCloses!('prr23456', [ada.rid], new Date(Date.now() - 60_000).toISOString())
    const mine = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
    const id = mine.slots.comments.mine[0].id
    expect((await routes.STATE_POST(post('prr23456', { slot: 'comments', op: 'remove', entry: id }, cookie(ada)), params('prr23456'))).status).toBe(200)
  })
  it('the signed-in owner and an admin reach the page\'s answers with no link, and their comments are theirs', async () => {
    const { routes, state } = await setup()
    for (const who of [owner, admin]) {
      expect((await routes.STATE_GET(get('prr23456', grant(who)), params('prr23456'))).status).toBe(200)
      expect((await routes.STATE_POST(post('prr23456', comment(`From ${who.name}.`), grant(who)), params('prr23456'))).status).toBe(200)
    }
    const keys = (await state.entries('prr23456')).filter((x) => x.slot === 'comments').map((x) => x.readerKey)
    expect(keys).toHaveLength(2)
    expect(keys.some((k) => k.startsWith('r:'))).toBe(false)
  })
  it('a signed-in stranger still needs a link', async () => {
    const { routes } = await setup()
    expect((await routes.STATE_GET(get('prr23456', grant(sam)), params('prr23456'))).status).toBe(403)
  })
  it('a page with no valid link answers nothing', async () => {
    const { routes } = await setup()
    expect((await routes.STATE_GET(get('prr23456'), params('prr23456'))).status).toBe(403)
  })
  it('reader A never sees reader B\'s comment, even when the page says readers may', async () => {
    const { routes, state, ada, bea, cookie } = await setup()
    RECORDS.prr23456 = page('prr23456', 'anyone', 'readers', { links: 'per-reader' })
    try {
      await routes.STATE_POST(post('prr23456', comment('Reader B private note.'), cookie(bea)), params('prr23456'))
      const view = await (await routes.STATE_GET(get('prr23456', cookie(ada)), params('prr23456'))).json()
      expect(view.slots.comments.mine).toEqual([])
      expect(view.slots.comments.shared).toBeUndefined()
      expect(JSON.stringify(view)).not.toContain('Reader B private note.')
      expect((await state.entries('prr23456')).filter((x) => x.slot === 'comments')).toHaveLength(1)
    } finally { RECORDS.prr23456 = page('prr23456', 'anyone', 'owner', { links: 'per-reader' }) }
  })
})

describe('comment_name: required', () => {
  const RS = 'r'.repeat(40)
  async function named() {
    const recipients = memoryRecipientsStore()
    const [ada] = await recipients.add('prn23456', [{ label: 'Reader A' }])
    const [anyone] = await recipients.add('prn23456', [{ label: 'Anyone with the link', group: true }])
    const [plainGroup] = await recipients.add('prr23456', [{ label: 'A group', group: true }])
    const { routes, state } = build(null, true, { recipients, recipientSecret: () => RS })
    const cookie = (id: string, r: { rid: string }) => `artifact_r_${id}=${r.rid}.${ridSig(RS, id, r.rid)}`
    return { routes, state, ada, anyone, plainGroup, cookie }
  }
  const withBy = (text: string, by: string) => { const c = comment(text) as { value: Record<string, unknown> }; return { ...c, value: { ...c.value, by } } }

  it('an open link takes no comment without a first name, and keeps the name its writer typed', async () => {
    const { routes, state, anyone, cookie } = await named()
    const bare = await routes.STATE_POST(post('prn23456', comment('No name.'), cookie('prn23456', anyone)), params('prn23456'))
    expect(bare.status).toBe(400)
    expect(await bare.json()).toEqual({ error: NAME_NEEDED, needsName: true })
    expect((await routes.STATE_POST(post('prn23456', withBy('From Kit.', 'Kit'), cookie('prn23456', anyone)), params('prn23456'))).status).toBe(200)
    const [e] = (await state.entries('prn23456')).filter((x) => x.slot === 'comments')
    expect((e.value as { by?: string }).by).toBe('Kit')
  })
  it('a named link never stores a typed name: the label is who they are', async () => {
    const { routes, state, ada, cookie } = await named()
    expect((await routes.STATE_POST(post('prn23456', withBy('Signed as someone else.', 'Somebody Else'), cookie('prn23456', ada)), params('prn23456'))).status).toBe(200)
    const [e] = (await state.entries('prn23456')).filter((x) => x.slot === 'comments')
    expect((e.value as { by?: string }).by).toBeUndefined()
    expect(e.writer.name).toBe('Reader A')
  })
  it('a page without the line is unchanged: a group link comments with no name', async () => {
    const { routes, plainGroup, cookie } = await named()
    expect((await routes.STATE_POST(post('prr23456', comment('No name, as before.'), cookie('prr23456', plainGroup)), params('prr23456'))).status).toBe(200)
  })
})

describe('a group link under comment_name: required: each browser is its own reader', () => {
  const RS = 'r'.repeat(40)
  const withBy = (text: string, by: string) => { const c = comment(text) as { value: Record<string, unknown> }; return { ...c, value: { ...c.value, by } } }
  const reply = (id: string, body: unknown) => new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/reply`, {
    method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const feed = () => new NextRequest('https://artifacts.example.com/api/comments?since=2020-01-01T00:00:00Z', { headers: { authorization: 'Bearer k' } })
  /** Two people open one group link in two browsers and each leaves a note. `page` is the page id. */
  async function twoBrowsers(page: string) {
    const recipients = memoryRecipientsStore()
    const [link] = await recipients.add(page, [{ label: 'Anyone with the link', group: true }])
    const { routes, state } = build(null, true, { recipients, recipientSecret: () => RS })
    const rid = `artifact_r_${page}=${link.rid}.${ridSig(RS, page, link.rid)}`
    const first = await routes.STATE_POST(post(page, withBy('From Kit.', 'Kit'), rid), params(page))
    const second = await routes.STATE_POST(post(page, withBy('From Robin.', 'Robin'), rid), params(page))
    expect([first.status, second.status]).toEqual([200, 200])
    const kit = [rid, anonCookieOf(first)].filter(Boolean).join('; ')
    const robin = [rid, anonCookieOf(second)].filter(Boolean).join('; ')
    const view = async (cookie: string) => (await (await routes.STATE_GET(get(page, cookie), params(page))).json()) as Body
    return { routes, state, link, rid, first, second, kit, robin, view }
  }

  it('each browser is handed its own id, and sees only its own note', async () => {
    const { first, second, kit, robin, view } = await twoBrowsers('prn23456')
    expect(anonCookieOf(first)).toMatch(/^artifact_anon=[A-Za-z0-9]{24}$/)
    expect(anonCookieOf(second)).toMatch(/^artifact_anon=[A-Za-z0-9]{24}$/)
    expect(anonCookieOf(first)).not.toBe(anonCookieOf(second))
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    expect(((await first.json()) as Body).slots.comments.mine.map((m) => m.value.body)).toEqual(['From Kit.'])
    expect(((await second.json()) as Body).slots.comments.mine.map((m) => m.value.body)).toEqual(['From Robin.'])
    expect((await view(kit)).slots.comments.mine.map((m) => m.value.body)).toEqual(['From Kit.'])
    const r = await view(robin)
    expect(r.slots.comments.mine.map((m) => m.value.body)).toEqual(['From Robin.'])
    expect(JSON.stringify(r)).not.toContain('From Kit.')
  })
  it('a browser with the link and no id yet is shown nobody\'s notes', async () => {
    const { rid, view } = await twoBrowsers('prn23456')
    const fresh = await view(rid)
    expect(fresh.slots.comments.mine).toEqual([])
    expect(JSON.stringify(fresh)).not.toMatch(/From Kit|From Robin/)
  })
  it('neither can edit or delete the other\'s note, with their own id, a made-up id or none', async () => {
    const { routes, state, rid, kit, robin, view } = await twoBrowsers('prn23456')
    const kitNote = (await view(kit)).slots.comments.mine[0].id
    const edit = { slot: 'comments', op: 'replace', entry: kitNote, value: { anchor, body: 'Rewritten by someone else.', version: 2, by: 'Robin' } }
    const remove = { slot: 'comments', op: 'remove', entry: kitNote }
    for (const cookie of [robin, `${rid}; artifact_anon=${'x'.repeat(24)}`, rid]) {
      expect((await routes.STATE_POST(post('prn23456', edit, cookie), params('prn23456'))).status).toBe(404)
      expect((await routes.STATE_POST(post('prn23456', remove, cookie), params('prn23456'))).status).toBe(404)
    }
    expect((await state.entries('prn23456')).map((e) => (e.value as { body: string }).body).sort()).toEqual(['From Kit.', 'From Robin.'])
    // Their own still edits and deletes.
    expect((await routes.STATE_POST(post('prn23456', { ...edit, value: { ...edit.value, body: 'Kit, again.', by: 'Kit' } }, kit), params('prn23456'))).status).toBe(200)
    expect((await routes.STATE_POST(post('prn23456', remove, kit), params('prn23456'))).status).toBe(200)
  })
  it('one cannot reply in the other\'s thread: a comment they were never shown', async () => {
    const { routes, kit, robin, view } = await twoBrowsers('prn23456')
    const kitNote = (await view(kit)).slots.comments.mine[0].id
    const res = await routes.STATE_POST(post('prn23456', comment('Butting in.', { by: 'Robin', parent: kitNote }), robin), params('prn23456'))
    expect(res.status).toBe(400)
  })
  it('a publisher reply to one is in that browser\'s view and never in the other\'s', async () => {
    const { routes, kit, robin, rid, view } = await twoBrowsers('prn23456')
    const kitNote = (await view(kit)).slots.comments.mine[0].id
    expect((await routes.REPLY(reply('prn23456', { entry: kitNote, body: 'Fixed for Kit.' }), params('prn23456'))).status).toBe(200)
    expect((await view(kit)).slots.comments.shared?.map((s) => s.value.body)).toEqual(['Fixed for Kit.'])
    expect(JSON.stringify(await view(robin))).not.toContain('Fixed for Kit.')
    expect(JSON.stringify(await view(rid))).not.toContain('Fixed for Kit.')
  })
  it('the stored key is the link\'s rid and an id derived on the server, never the cookie itself', async () => {
    const { state, link, kit } = await twoBrowsers('prn23456')
    const keys = (await state.entries('prn23456')).map((e) => e.readerKey)
    expect(new Set(keys).size).toBe(2)
    const anon = /artifact_anon=([A-Za-z0-9]{24})/.exec(kit)![1]
    for (const k of keys) {
      expect(k).toMatch(new RegExp(`^r:${link.rid}\\.[0-9a-f]{24}$`))
      expect(k).not.toContain(anon)
    }
  })
  it('the feed row names the link\'s rid and label for both, with the name each typed', async () => {
    const { routes, link } = await twoBrowsers('prn23456')
    const { comments } = (await (await routes.COMMENTS_FEED(feed())).json()) as { comments: { reader: unknown; by: string | null }[] }
    expect(comments.map((c) => c.reader)).toEqual([{ rid: link.rid, label: 'Anyone with the link' }, { rid: link.rid, label: 'Anyone with the link' }])
    expect(comments.map((c) => c.by).sort()).toEqual(['Kit', 'Robin'])
  })
  it('the window is still the link\'s: closed for one browser is closed for every browser on it', async () => {
    const recipients = memoryRecipientsStore()
    const [link] = await recipients.add('prn23456', [{ label: 'Anyone with the link', group: true, closesAt: '2020-01-01T00:00:00.000Z' }])
    const { routes } = build(null, true, { recipients, recipientSecret: () => RS })
    const cookie = `artifact_r_prn23456=${link.rid}.${ridSig(RS, 'prn23456', link.rid)}`
    for (const c of [cookie, `${cookie}; artifact_anon=${'k'.repeat(24)}`]) {
      const res = await routes.STATE_POST(post('prn23456', withBy('Too late.', 'Kit'), c), params('prn23456'))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: FEEDBACK_CLOSED, closed: true })
      expect(res.headers.get('set-cookie')).toBeNull()
    }
  })
  it('a named link on the same page is still one reader, keyed by its rid, and is handed no id', async () => {
    const recipients = memoryRecipientsStore()
    const [ada] = await recipients.add('prn23456', [{ label: 'Reader A' }])
    const { routes, state } = build(null, true, { recipients, recipientSecret: () => RS })
    const cookie = `artifact_r_prn23456=${ada.rid}.${ridSig(RS, 'prn23456', ada.rid)}`
    const res = await routes.STATE_POST(post('prn23456', comment('Mine.'), cookie), params('prn23456'))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((await state.entries('prn23456')).map((e) => e.readerKey)).toEqual([`r:${ada.rid}`])
    const again = (await (await routes.STATE_GET(get('prn23456', `${cookie}; artifact_anon=${'z'.repeat(24)}`), params('prn23456'))).json()) as Body
    expect(again.slots.comments.mine.map((m) => m.value.body)).toEqual(['Mine.'])
  })
  it('without the line a group link is one shared reader, as in 0.39: no id, one key, each sees and can remove the other\'s', async () => {
    const { routes, state, link, first, second, rid, view } = await twoBrowsers('prr23456')
    expect(first.headers.get('set-cookie')).toBeNull()
    expect(second.headers.get('set-cookie')).toBeNull()
    expect((await state.entries('prr23456')).map((e) => e.readerKey)).toEqual([`r:${link.rid}`, `r:${link.rid}`])
    const shared = await view(`${rid}; artifact_anon=${'q'.repeat(24)}`)
    expect(shared.slots.comments.mine.map((m) => m.value.body).sort()).toEqual(['From Kit.', 'From Robin.'])
    expect((await routes.STATE_POST(post('prr23456', { slot: 'comments', op: 'remove', entry: shared.slots.comments.mine[0].id }, rid), params('prr23456'))).status).toBe(200)
  })
})
