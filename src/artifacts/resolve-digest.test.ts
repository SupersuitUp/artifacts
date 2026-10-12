// Resolution digests (0.34.0): who hears about a resolved thread, how resolutions batch into one
// email per reader per page per burst, the quiet window, reopening, sending once, and the stop link.
import { describe, it, expect, vi } from 'vitest'
import {
  composeDigest, createResolveDigests, emailKey, maskEmail, noticesFor, stopToken, verifyStopToken,
  type DigestMessage, type ResolveEvent,
} from './resolve-digest.js'
import { createMemoryResolveDigestStore } from './resolve-digest-store.js'
import type { StateEntry } from './state-store.js'

const SECRET = 'stop-sekrit'
const URL_ = 'https://artifacts.example.com/abc23456'
const T0 = Date.parse('2026-10-12T15:00:00.000Z')
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()

const sam = { uid: 'u3', email: 'Sam@Example.com', name: 'Sam Reader', anonymous: false }
const kim = { uid: 'u4', email: 'kim@example.com', name: 'Kim Other', anonymous: false }
const owner = { uid: 'u0', email: 'owner@example.com', name: 'Olive Owner', anonymous: false }
const admin = { uid: 'u9', email: 'admin@example.com', name: 'Ada Admin', anonymous: false }
const anon = { name: null, anonymous: true }

let n = 0
const entry = (writer: StateEntry['writer'], body: string, parent?: string, quote = 'the river runs north'): StateEntry => ({
  id: `c${++n}`, artifactId: 'abc23456', slot: 'comments', shape: 'many', readerKey: 'k', writer,
  value: { anchor: { kind: 'text', quote, prefix: '', suffix: '' }, body, version: 1, ...(parent ? { parent } : {}) }, at: iso(-100 + n),
})
/** A thread: a top comment by `writer`, then replies. */
const thread = (writer: StateEntry['writer'], body: string, replies: [StateEntry['writer'], string][] = []) => {
  const root = entry(writer, body)
  return [root, ...replies.map(([w, b]) => entry(w, b, root.id))]
}
const resolved = (entries: StateEntry[], at: string, o: Partial<ResolveEvent> & { note?: string; by?: string } = {}): ResolveEvent => ({
  artifactId: 'abc23456', title: "THE 'RIVER' PAPER", url: URL_, thread: { id: entries[0].id, entries },
  resolution: { at, by: o.by ?? 'Ann', ...(o.note ? { note: o.note } : {}) }, actor: o.actor ?? { email: 'ann@example.com', publisher: false }, at,
})
const reopened = (entries: StateEntry[], at: string): ResolveEvent => ({ ...resolved(entries, at), resolution: null })

function setup(over: { send?: (m: DigestMessage) => Promise<{ id?: string } | void> } = {}) {
  const store = createMemoryResolveDigestStore()
  const sent: DigestMessage[] = []
  const send = vi.fn(over.send ?? (async (m: DigestMessage) => { sent.push(m); return { id: `re_${sent.length}` } }))
  const digests = createResolveDigests({
    store, send, secret: () => SECRET, siteUrl: 'https://artifacts.example.com', brandName: 'Example Co', ownerName: 'Ann',
    ownerEmail: 'Owner@Example.com', admins: ['admin@example.com'],
  })
  return { store, sent, send, digests }
}
const at = (minutes: number) => ({ now: new Date(T0 + minutes * 60_000) })

describe('noticesFor: who hears about a resolved thread', () => {
  it('the signed-in writer of the top comment, with only their own comment', () => {
    const t = thread(sam, 'Which river?', [[kim, 'I wondered too'], [anon, 'me three']])
    const ns = noticesFor(resolved(t, iso(0), { note: 'Named it.' }))
    expect(ns.map((x) => x.email).sort()).toEqual(['kim@example.com', 'sam@example.com'])
    const s = ns.find((x) => x.email === 'sam@example.com')!
    expect(s.items.map((i) => i.body)).toEqual(['Which river?'])
    expect(s.items[0]).toMatchObject({ threadId: t[0].id, entryId: t[0].id, quote: 'the river runs north', note: 'Named it.', by: 'Ann' })
    // Kim's notice is for the reply Kim wrote, never for Sam's comment.
    expect(ns.find((x) => x.email === 'kim@example.com')!.items.map((i) => i.entryId)).toEqual([t[1].id])
  })

  it('nobody for a comment by an anonymous reader, and nothing on reopen', () => {
    const t = thread(anon, 'no address here')
    expect(noticesFor(resolved(t, iso(0)))).toEqual([])
    expect(noticesFor(reopened(thread(sam, 'x'), iso(0)))).toEqual([])
  })

  it('never the person resolving, the owner, or an admin, about their own comments', () => {
    const t = thread(owner, 'owner note', [[admin, 'admin reply'], [{ ...sam, email: 'resolver@example.com' }, 'my own'], [sam, 'Sam replied']])
    const ns = noticesFor(resolved(t, iso(0), { actor: { email: 'RESOLVER@example.com', publisher: false } }), { ownerEmail: 'OWNER@example.com', admins: ['Admin@example.com'] })
    expect(ns.map((x) => x.email)).toEqual(['sam@example.com'])
  })

  it('a writer with no address on record gets nothing', () => {
    expect(noticesFor(resolved(thread({ uid: 'u7', name: 'No Mail', anonymous: false }, 'hm'), iso(0)))).toEqual([])
  })
})

describe('batching: one email per reader per page per burst', () => {
  it('three threads resolved within the window make ONE digest listing all three', async () => {
    const { digests, sent, store } = setup()
    for (const [k, body] of ['one', 'two', 'three'].entries()) await digests.onResolve(resolved(thread(sam, body), iso(k)))
    expect(store.bursts()).toHaveLength(1)
    const r = await digests.flush(at(2 + 10))
    expect(r.sent).toHaveLength(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('sam@example.com')
    expect(sent[0].subject).toBe("Ann resolved 3 of your comments on THE 'RIVER' PAPER")
    expect(sent[0].text).toContain('"one"')
    expect(sent[0].text).toContain('"three"')
  })

  it('two readers on one page get one email each; one reader on two pages gets one per page', async () => {
    const { digests, sent } = setup()
    await digests.onResolve(resolved(thread(sam, 'a'), iso(0)))
    await digests.onResolve(resolved(thread(kim, 'b'), iso(0)))
    await digests.onResolve({ ...resolved(thread(sam, 'c'), iso(0)), artifactId: 'xyz23456', url: 'https://artifacts.example.com/xyz23456' })
    await digests.flush(at(10))
    expect(sent.map((m) => `${m.to} ${m.text.includes('xyz23456') ? 'xyz' : 'abc'}`).sort()).toEqual(['kim@example.com abc', 'sam@example.com abc', 'sam@example.com xyz'])
  })

  it('resolving the same thread again replaces its item rather than listing it twice', async () => {
    const { digests, sent } = setup()
    const t = thread(sam, 'Which river?')
    await digests.onResolve(resolved(t, iso(0), { note: 'first try' }))
    await digests.onResolve(resolved(t, iso(1), { note: 'Named it in paragraph two.' }))
    await digests.flush(at(11))
    expect(sent[0].subject).toBe("Ann resolved your comment on THE 'RIVER' PAPER")
    expect(sent[0].text).toContain('What changed: Named it in paragraph two.')
    expect(sent[0].text).not.toContain('first try')
  })
})

describe('the quiet window', () => {
  it('waits 10 minutes after the LAST resolution, and a new one restarts the wait', async () => {
    const { digests, sent } = setup()
    await digests.onResolve(resolved(thread(sam, 'one'), iso(0)))
    expect((await digests.flush(at(9))).sent).toHaveLength(0)
    await digests.onResolve(resolved(thread(sam, 'two'), iso(8)))
    expect((await digests.flush(at(12))).sent).toHaveLength(0)
    expect((await digests.flush(at(17.99))).sent).toHaveLength(0)
    expect((await digests.flush(at(18))).sent).toHaveLength(1)
    expect(sent[0].subject).toMatch(/^Ann resolved 2 of your comments/)
  })

  it('a burst that never goes quiet is still sent once its first resolution is 6 hours old', async () => {
    const { digests, sent } = setup()
    for (let m = 0; m <= 360; m += 5) await digests.onResolve(resolved(thread(sam, `c${m}`), iso(m)))
    await digests.flush(at(360))
    expect(sent).toHaveLength(1)
  })

  it('a resolution after a digest was claimed starts a new burst, sent on its own', async () => {
    const { digests, sent } = setup()
    await digests.onResolve(resolved(thread(sam, 'one'), iso(0)))
    await digests.flush(at(10))
    await digests.onResolve(resolved(thread(sam, 'two'), iso(11)))
    await digests.flush(at(21))
    expect(sent.map((m) => m.subject)).toEqual(Array(2).fill("Ann resolved your comment on THE 'RIVER' PAPER"))
  })
})

describe('reopening', () => {
  it('a thread reopened before the window closes drops out of the digest', async () => {
    const { digests, sent } = setup()
    const keep = thread(sam, 'keep me')
    const back = thread(sam, 'reopen me')
    await digests.onResolve(resolved(keep, iso(0)))
    await digests.onResolve(resolved(back, iso(1)))
    await digests.onResolve(reopened(back, iso(2)))
    await digests.flush(at(12))
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('keep me')
    expect(sent[0].text).not.toContain('reopen me')
  })

  it('a burst left with nothing in it sends nothing', async () => {
    const { digests, send, store } = setup()
    const t = thread(sam, 'only one')
    await digests.onResolve(resolved(t, iso(0)))
    await digests.onResolve(reopened(t, iso(1)))
    expect(store.bursts()).toEqual([])
    await digests.flush(at(30))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sent once', () => {
  it('a second flush, and two overlapping flushes, send each digest exactly once', async () => {
    const { digests, send } = setup()
    await digests.onResolve(resolved(thread(sam, 'a'), iso(0)))
    await digests.onResolve(resolved(thread(kim, 'b'), iso(0)))
    await Promise.all([digests.flush(at(10)), digests.flush(at(10))])
    await digests.flush(at(11))
    await digests.flush(at(60))
    expect(send).toHaveBeenCalledTimes(2)
    expect(new Set(send.mock.calls.map(([m]) => m.to))).toEqual(new Set(['sam@example.com', 'kim@example.com']))
  })

  it('a failed send is retried later with the SAME idempotency key, then never again once sent', async () => {
    let fail = true
    const { digests, send, store } = setup({ send: async () => { if (fail) throw new Error('provider down'); return { id: 're_1' } } })
    await digests.onResolve(resolved(thread(sam, 'a'), iso(0)))
    const first = await digests.flush(at(10))
    expect(first.failed).toEqual([{ id: expect.any(String), error: 'provider down' }])
    // Inside the back-off nothing is attempted.
    await digests.flush(at(12))
    expect(send).toHaveBeenCalledTimes(1)
    fail = false
    await digests.flush(at(16))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].idempotencyKey).toBe(send.mock.calls[1][0].idempotencyKey)
    expect(store.digests()[0]).toMatchObject({ status: 'sent', providerId: 're_1', attempts: 2 })
    await digests.flush(at(120))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('a run that died mid-send leaves a lease; the retry after it expires reuses the idempotency key', async () => {
    const { digests, send, store } = setup()
    await digests.onResolve(resolved(thread(sam, 'a'), iso(0)))
    // Simulate the crash: claim and lease, then nothing recorded.
    const [b] = await store.due(iso(10), iso(-360), 10)
    const d = await store.claim({ key: b.key, burstId: b.burstId, quietBefore: iso(10), maxBefore: iso(-360), now: iso(10) })
    await store.lease(d!.id, iso(10), iso(25))
    await digests.flush(at(20))
    expect(send).not.toHaveBeenCalled()
    await digests.flush(at(25))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].idempotencyKey).toBe(`resolve-digest/${d!.id}`)
  })

  it('only resolutions recorded through onResolve queue anything: there is no backfill', async () => {
    const { digests, send } = setup()
    // A page whose threads were resolved before digests were wired has nothing queued.
    expect((await digests.flush(at(60))).due).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the stop link', () => {
  it('every digest carries a signed stop link and the one-click headers', async () => {
    const { digests, sent } = setup()
    await digests.onResolve(resolved(thread(sam, 'a'), iso(0)))
    await digests.flush(at(10))
    const link = /Stop these emails for this page: (\S+)/.exec(sent[0].text)![1]
    expect(link).toMatch(/^https:\/\/artifacts\.example\.com\/api\/resolve-digest\/stop\?t=abc23456\./)
    expect(sent[0].html).toContain(link.replace(/&/g, '&amp;'))
    expect(sent[0].headers).toEqual({ 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(verifyStopToken(SECRET, new URL(link).searchParams.get('t'))).toEqual({ artifactId: 'abc23456', emailKey: emailKey('sam@example.com') })
  })

  it('a tampered or foreign token is refused', () => {
    const t = stopToken(SECRET, 'abc23456', 'sam@example.com')
    expect(verifyStopToken('other', t)).toBeNull()
    expect(verifyStopToken(SECRET, t.replace('abc23456', 'xyz23456'))).toBeNull()
    expect(verifyStopToken(SECRET, `${t.slice(0, -1)}A`)).toBeNull()
    expect(verifyStopToken(undefined, t)).toBeNull()
  })

  it('following it stops the waiting digest and every later one for that page, and only that page', async () => {
    const { digests, sent } = setup()
    await digests.onResolve(resolved(thread(sam, 'waiting'), iso(0)))
    const res = await digests.STOP(new Request(`https://artifacts.example.com/api/resolve-digest/stop?t=${stopToken(SECRET, 'abc23456', 'SAM@example.com')}`))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('no more emails')
    const r = await digests.flush(at(10))
    expect(r.skipped).toEqual([{ id: expect.any(String), reason: 'stopped' }])
    await digests.onResolve(resolved(thread(sam, 'later'), iso(20)))
    await digests.onResolve({ ...resolved(thread(sam, 'other page'), iso(20)), artifactId: 'xyz23456', url: 'https://artifacts.example.com/xyz23456' })
    await digests.flush(at(40))
    expect(sent.map((m) => m.text.includes('xyz23456'))).toEqual([true])
  })

  it('POST (the mail client\'s one-click) stops too, and a bad token is a 400 that stops nothing', async () => {
    const { digests, store } = setup()
    expect((await digests.STOP(new Request('https://artifacts.example.com/api/resolve-digest/stop?t=nope', { method: 'POST' }))).status).toBe(400)
    const res = await digests.STOP(new Request(`https://artifacts.example.com/api/resolve-digest/stop?t=${stopToken(SECRET, 'abc23456', 'sam@example.com')}`, { method: 'POST' }))
    expect(res.status).toBe(204)
    expect(await store.stopped('abc23456', emailKey('sam@example.com'))).toBe(true)
  })

  it('without a signing secret nothing is queued, since no email may go out without a stop link', async () => {
    const store = createMemoryResolveDigestStore()
    const d = createResolveDigests({ store, send: vi.fn(), secret: () => undefined, siteUrl: 'https://a.example.com', brandName: 'X' })
    await d.onResolve(resolved(thread(sam, 'a'), iso(0)))
    expect(store.bursts()).toEqual([])
  })
})

describe('dry run', () => {
  it('reports what would go out, masked, and changes nothing', async () => {
    const { digests, send, store } = setup()
    await digests.onResolve(resolved(thread(sam, 'a'), iso(0)))
    await digests.onResolve(resolved(thread(sam, 'b'), iso(1)))
    const r = await digests.flush({ ...at(11), dryRun: true })
    expect(r.wouldSend).toEqual([{ to: 's***@example.com', subject: "Ann resolved 2 of your comments on THE 'RIVER' PAPER", comments: 2, artifactId: 'abc23456', stopped: false }])
    expect(send).not.toHaveBeenCalled()
    expect(store.bursts()).toHaveLength(1)
    expect(store.digests()).toEqual([])
  })
})

describe('composeDigest', () => {
  const items = [
    { entryId: 'e1', threadId: 'e1', quote: 'the river runs north', body: 'Which river?', note: 'Named it.', by: 'the publisher', resolvedAt: iso(0) },
    { entryId: 'e2', threadId: 'e2', quote: null, body: 'This box <b>', note: null, by: 'the publisher', resolvedAt: iso(1) },
  ]
  const m = composeDigest({ name: 'Bo Sample', title: 'A Page', url: URL_, items }, { brandName: 'Example Co', ownerName: 'Ann', stopUrl: 'https://s.example.com/x' })

  it('greets by first name, reads "the publisher" as the owner, links each comment and the page', () => {
    expect(m.subject).toBe('Ann resolved 2 of your comments on A Page')
    expect(m.text).toMatch(/^Hi Bo,\n/)
    expect(m.text).toContain('On "the river runs north"')
    expect(m.text).toContain('On a box on the page')
    expect(m.text).toContain(`See it: ${URL_}#comment-e1`)
    expect(m.text).toContain(`Read the page: ${URL_}`)
    expect(m.html).toContain(`href="${URL_}#comment-e2"`)
    expect(m.html).toContain('This box &lt;b&gt;')
  })

  it('carries no em dash or en dash anywhere', () => {
    expect(`${m.subject}${m.text}${m.html}`).not.toMatch(/[—–]/)
  })

  it('names two different resolvers', () => {
    const two = composeDigest({ name: null, title: 'P', url: URL_, items: [{ ...items[0], by: 'Ann' }, { ...items[1], by: 'Wes' }] }, { brandName: 'Co', stopUrl: 'x' })
    expect(two.subject).toBe('Ann and Wes resolved 2 of your comments on P')
    expect(two.text).toMatch(/^Hi,\n/)
  })

  it('masks addresses in reports', () => { expect(maskEmail('Sam@Example.com')).toBe('s***@example.com') })
})
