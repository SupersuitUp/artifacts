// Send outcomes (issue #12): a page's goal, the per-reader facts under the before-send rule, CTA
// clicks, and the one outcome a host draws each send in.
import { describe, it, expect } from 'vitest'
import { parseArtifactSource } from './front-matter.js'
import { parseGoal, ctasIn, OUTCOME_READ_SECONDS, OUTCOME_RETURN_GAP_MS, OUTCOME_THRESHOLDS, OUTCOMES } from './goal.js'
import { memoryRecipientsStore, summarizeViews, type ViewDoc } from './recipients-store.js'

const doc = (lines: string, body = 'Body.') => `---\ntitle: T\nsummary: S\n${lines}\n---\n${body}`

describe('a page goal (front matter `goal:`)', () => {
  it('takes read, respond and ack, and leaves it out when absent (read is the default)', () => {
    for (const g of ['read', 'respond'] as const) {
      const p = parseArtifactSource(doc(`goal: ${g}`))
      expect(p.ok && p.meta.goal).toBe(g)
    }
    const ack = parseArtifactSource(doc('goal: ack', '[Got it](#got-it "cta:ack")'))
    expect(ack.ok && ack.meta.goal).toBe('ack')
    const none = parseArtifactSource(doc(''))
    expect(none.ok && none.meta.goal).toBeUndefined()
  })
  it('takes { click: <cta id> } when the page carries a link marked with that CTA', () => {
    const p = parseArtifactSource(doc('goal:\n  click: book-call', 'Pick a time: [Book a call](https://cal.example.com/x "cta:book-call").'))
    expect(p.ok && p.meta.goal).toEqual({ click: 'book-call' })
  })
  it('refuses an unknown goal with a clear message', () => {
    const p = parseArtifactSource(doc('goal: buy'))
    expect(p).toEqual({ ok: false, error: 'goal must be read, respond, ack, or { click: <cta id> }' })
    expect(parseArtifactSource(doc('goal:\n  click: Book Call')).ok).toBe(false)
    expect(parseArtifactSource(doc('goal:\n  click: x\n  extra: y')).ok).toBe(false)
    expect(parseGoal(['read']).ok).toBe(false)
  })
  it('refuses a click goal naming a CTA the page does not carry, and ack with no ack link', () => {
    expect(parseArtifactSource(doc('goal:\n  click: book-call'))).toEqual({ ok: false, error: 'goal names a CTA the page does not carry: book-call (mark a link with "cta:book-call")' })
    expect(parseArtifactSource(doc('goal: ack'))).toEqual({ ok: false, error: 'goal: ack needs a link marked "cta:ack" for the reader to press' })
  })
  it('refuses a malformed CTA id in a link title, so a CTA can never silently record nothing', () => {
    const p = parseArtifactSource(doc('', '[Go](https://example.com "cta:Book Call")'))
    expect(p.ok).toBe(false)
  })
  it('ctasIn reads every CTA id from link titles, once each', () => {
    expect(ctasIn('[a](https://x.example.com "cta:one") [b](#b \'cta:two\') [c](https://y.example.com "cta:one") [d](https://z.example.com "plain title")')).toEqual(['one', 'two'])
  })
})

describe('the thresholds are named and exported', () => {
  it('read is 30 active seconds, returned is a second open an hour or more after the first', () => {
    expect(OUTCOME_READ_SECONDS).toBe(30)
    expect(OUTCOME_RETURN_GAP_MS).toBe(3_600_000)
    expect(OUTCOME_THRESHOLDS).toEqual({ readSeconds: 30, returnGapMs: 3_600_000 })
    expect(OUTCOMES).toEqual(['not-opened', 'opened', 'read', 'returned', 'acted'])
  })
})

describe('a click is stored per session, with its time', () => {
  it('recordView keeps each click; an old view with no clicks reads as none', async () => {
    const s = memoryRecipientsStore()
    await s.recordView({ artifactId: 'p', rid: 'aaaaaaaaaaaa', session: 's1', device: 'd1', at: '2026-11-01T10:00:00.000Z', addSeconds: 2 })
    await s.recordView({ artifactId: 'p', rid: 'aaaaaaaaaaaa', session: 's1', device: 'd1', at: '2026-11-01T10:00:09.000Z', addSeconds: 0, click: 'book-call' })
    const [v] = await s.views('p')
    expect(v.clicks).toEqual([{ cta: 'book-call', at: '2026-11-01T10:00:09.000Z' }])
    expect(v.activeSeconds).toBe(2)
  })
})

describe('summarizeViews: per-reader facts and the outcome', () => {
  const SENT = '2026-11-01T09:00:00.000Z'
  const rec = (sentAt: string | undefined = SENT) => ({ expireAt: null, keep: false, recipients: {
    aaaaaaaaaaaa: { rid: 'aaaaaaaaaaaa', label: 'Reader A', addedAt: 'x', ...(sentAt ? { sentAt } : {}) },
  } })
  const v = (session: string, device: string, firstAt: string, secs: number, clicks?: { cta: string; at: string }[]): ViewDoc =>
    ({ artifactId: 'p', rid: 'aaaaaaaaaaaa', session, device, firstAt, lastAt: firstAt, activeSeconds: secs, plays: {}, ...(clicks ? { clicks } : {}) })
  const now = new Date('2026-11-04T12:00:00.000Z')
  const one = (views: ViewDoc[], o: Parameters<typeof summarizeViews>[3] = {}, comments: Parameters<typeof summarizeViews>[2] = [], r = rec()) =>
    summarizeViews(r, views, comments, { now, ...o })[0]

  it('carries lastOpenAt, sessions and each open, all under the before-send rule', () => {
    const s = one([
      v('pre', 'dsender', '2026-11-01T08:59:00.000Z', 600),
      v('s1', 'dreader', '2026-11-01T10:00:00.000Z', 12),
      v('s2', 'dreader', '2026-11-02T10:00:00.000Z', 8),
    ])
    expect(s).toMatchObject({ sessions: 2, lastOpenAt: '2026-11-02T10:00:00.000Z', opens: [
      { at: '2026-11-01T10:00:00.000Z', activeSeconds: 12, device: 'dreader' },
      { at: '2026-11-02T10:00:00.000Z', activeSeconds: 8, device: 'dreader' },
    ] })
  })
  it('a render before the send is never the reader: not opened, no open, no click, no success', () => {
    const s = one([v('pre', 'dsender', '2026-11-01T08:59:00.000Z', 600, [{ cta: 'book-call', at: '2026-11-01T08:59:30.000Z' }]),
      v('later', 'dsender', '2026-11-01T11:00:00.000Z', 300)], { goal: { click: 'book-call' } })
    expect(s).toMatchObject({ opened: false, sessions: 0, lastOpenAt: null, opens: [], clicks: [], outcome: 'not-opened', succeeded: false })
  })
  it('a reader nobody has seen is not-opened, with the days since the send', () => {
    expect(one([])).toMatchObject({ outcome: 'not-opened', succeeded: false, sentAt: SENT, daysSinceSent: 3 })
    expect(one([], {}, [], rec(''))).toMatchObject({ sentAt: null, daysSinceSent: null })
  })
  it('opened under the read threshold is opened; at it, read', () => {
    expect(one([v('s1', 'd1', '2026-11-01T10:00:00.000Z', 29)])).toMatchObject({ outcome: 'opened', succeeded: false })
    expect(one([v('s1', 'd1', '2026-11-01T10:00:00.000Z', 30)])).toMatchObject({ outcome: 'read', succeeded: true, goal: 'read' })
  })
  it('a second session on a known device, an hour or more later, is returned', () => {
    expect(one([v('s1', 'd1', '2026-11-01T10:00:00.000Z', 40), v('s2', 'd1', '2026-11-01T12:00:00.000Z', 5)])).toMatchObject({ outcome: 'returned', succeeded: true })
    // Two sessions minutes apart are one sitting, not a return.
    expect(one([v('s1', 'd1', '2026-11-01T10:00:00.000Z', 40), v('s2', 'd1', '2026-11-01T10:10:00.000Z', 5)])).toMatchObject({ outcome: 'read' })
  })
  it('a host passes its own thresholds', () => {
    const views = [v('s1', 'd1', '2026-11-01T10:00:00.000Z', 40), v('s2', 'd1', '2026-11-01T10:10:00.000Z', 5)]
    expect(one(views, { thresholds: { readSeconds: 60 } })).toMatchObject({ outcome: 'opened', succeeded: false })
    expect(one(views, { thresholds: { returnGapMs: 60_000 } })).toMatchObject({ outcome: 'returned' })
  })
  it('goal respond: a comment by that reader after the send is acted; none, or only one before the send, is not', () => {
    const views = [v('s1', 'd1', '2026-11-01T10:00:00.000Z', 40)]
    const after = [{ readerKey: 'r:aaaaaaaaaaaa', at: '2026-11-01T10:01:00.000Z', text: 'Yes' }]
    const before = [{ readerKey: 'r:aaaaaaaaaaaa', at: '2026-11-01T08:59:30.000Z', text: 'test' }]
    expect(one(views, { goal: 'respond' }, after)).toMatchObject({ outcome: 'acted', succeeded: true, goal: 'respond' })
    expect(one(views, { goal: 'respond' })).toMatchObject({ outcome: 'read', succeeded: false })
    expect(one(views, { goal: 'respond' }, before)).toMatchObject({ outcome: 'read', succeeded: false })
  })
  it('goal ack: the reader pressing the ack CTA is acted', () => {
    const acked = [v('s1', 'd1', '2026-11-01T10:00:00.000Z', 5, [{ cta: 'ack', at: '2026-11-01T10:00:04.000Z' }])]
    expect(one(acked, { goal: 'ack' })).toMatchObject({ outcome: 'acted', succeeded: true, clicks: [{ cta: 'ack', at: '2026-11-01T10:00:04.000Z' }] })
    expect(one([v('s1', 'd1', '2026-11-01T10:00:00.000Z', 90)], { goal: 'ack' })).toMatchObject({ outcome: 'read', succeeded: false })
  })
  it('goal click: that CTA clicked is acted; another CTA is not', () => {
    const booked = [v('s1', 'd1', '2026-11-01T10:00:00.000Z', 5, [{ cta: 'book-call', at: '2026-11-01T10:00:04.000Z' }])]
    expect(one(booked, { goal: { click: 'book-call' } })).toMatchObject({ outcome: 'acted', succeeded: true })
    expect(one(booked, { goal: { click: 'reply' } })).toMatchObject({ outcome: 'opened', succeeded: false })
  })
  it('goal read: a click never makes it acted, and reading is the success', () => {
    const s = one([v('s1', 'd1', '2026-11-01T10:00:00.000Z', 35, [{ cta: 'book-call', at: '2026-11-01T10:00:04.000Z' }])])
    expect(s).toMatchObject({ outcome: 'read', succeeded: true, goal: 'read' })
  })
  it('existing fields are unchanged, and a call with no options still works', () => {
    const [s] = summarizeViews(rec(), [v('s1', 'd1', '2026-11-01T10:00:00.000Z', 35)], [])
    expect(s).toMatchObject({ opened: true, firstOpenAt: '2026-11-01T10:00:00.000Z', cameBack: false, activeSeconds: 35, plays: 0, devices: 1, comments: [], beforeSend: { sessions: 0 } })
    expect(typeof s.daysSinceSent).toBe('number')
  })
})
