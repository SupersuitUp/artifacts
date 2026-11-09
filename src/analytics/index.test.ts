// Artifact analytics' pure half: the hub's own stores (the module's in-memory recipients and state stores, and a page
// list shaped like createArtifactStore's) become one list of sends, and from it the Activity feed, Waiting on, the
// counts, one page's readers and one person's timeline. Firestore is never touched.
import { describe, expect, it } from 'vitest'
import { createMemoryStateStore, memoryRecipientsStore, type ArtifactListItem, type RecipientsStore } from '../artifacts/index.js'
import { activityFeed, countsOf, fetchSends, filterSends, heatOf, MAX_PAGES, OUTCOME_LABEL, outcomeBoard, pageUrl, parseFilters, timelineOf, waitingOn, type AnalyticsConfig, type HubStores } from './index.js'
import { OUTCOMES } from '../artifacts/index.js'

// The hub the tile reads: where its pages live, and after how many days an unopened send is waiting.
const cfg = (): AnalyticsConfig => ({ site: 'https://hub.example.com', pagePrefix: '/', quietDays: 3 })

const DAY = 86_400_000
// Every time below is relative to the real clock: the in-memory store stamps a new link with it.
const NOW = new Date()
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()

const item = (id: string, title: string, updatedAt: string, template: 'document' | 'broadcast' = 'document'): ArtifactListItem =>
  ({ id, title, summary: '', template, createdAt: updatedAt, updatedAt, views: 0 })

// Ada opens the plan four days ago, comes back, plays its clip and comments; Bo was sent it five days ago and never
// opened it; Cy's was sent yesterday. Bo opened the letter yesterday and pressed its CTA. The owner's own link is
// never a reader. An old page from 200 days ago is outside what is read. The plan's goal is `respond`; the letter's is
// `{ click: 'book' }`; a page with no goal is `read`.
async function hubOf(): Promise<HubStores & { recipients: RecipientsStore; ids: Record<string, string>; reads: string[]; got: string[] }> {
  const recipients = memoryRecipientsStore()
  const state = createMemoryStateStore()
  const ids: Record<string, string> = {}
  const [owner, ada, bo, cy] = await recipients.add('plan', [
    { label: 'Me', owner: true }, { label: 'Ada' }, { label: 'Bo', provenance: { actor: 'Sam', authority: 'by hand', at: ago(5), subject: 'p_bo000001' } }, { label: 'Cy' },
  ])
  Object.assign(ids, { owner: owner.rid, ada: ada.rid, bo: bo.rid, cy: cy.rid })
  await recipients.setSent!('plan', [ada.rid, bo.rid], ago(5))
  await recipients.setSent!('plan', [cy.rid], ago(1))
  await recipients.recordView({ artifactId: 'plan', rid: ada.rid, session: 's1', device: 'd1', at: ago(4), addSeconds: 40 })
  await recipients.recordView({ artifactId: 'plan', rid: ada.rid, session: 's2', device: 'd1', at: new Date(Date.parse(ago(4)) + 2 * 3_600_000).toISOString(), addSeconds: 20, play: 'clip.mp4' })
  await recipients.recordView({ artifactId: 'plan', rid: owner.rid, session: 's3', device: 'd9', at: ago(4), addSeconds: 50 })
  await state.append({ artifactId: 'plan', slot: 'comments', writer: { key: `r:${ada.rid}`, name: 'Ada' } as never, value: { body: 'Looks right.' } })
  const [bo2] = await recipients.add('letter', [{ label: 'Bo', provenance: { actor: 'Sam', authority: 'by hand', at: ago(2), subject: 'p_bo000001' } }])
  ids.bo2 = bo2.rid
  await recipients.setSent!('letter', [bo2.rid], ago(2))
  await recipients.recordView({ artifactId: 'letter', rid: bo2.rid, session: 's4', device: 'd2', at: ago(1), addSeconds: 30 })
  await recipients.recordView({ artifactId: 'letter', rid: bo2.rid, session: 's4', device: 'd2', at: ago(1), addSeconds: 0, click: 'book' })
  await recipients.add('old', [{ label: 'Ada' }])
  const list = {
    document: [item('plan', 'The plan', ago(5)), item('public', 'A public page', ago(3)), item('old', 'An old page', ago(200))],
    broadcast: [item('letter', 'The letter', ago(2), 'broadcast')],
  }
  const reads: string[] = []
  const watched = new Proxy(recipients, { get: (t, k) => {
    const v = (t as never)[k] as unknown
    return typeof v === 'function' ? (...a: unknown[]) => { reads.push(`${String(k)}:${String(a[0])}`); return (v as (...x: unknown[]) => unknown).apply(t, a) } : v
  } })
  const goals: Record<string, unknown> = { plan: 'respond', letter: { click: 'book' } }
  const got: string[] = []
  const get = async (id: string) => { got.push(id); return { id, ...(goals[id] ? { goal: goals[id] } : {}) } as never }
  return { ids, reads, got, recipients: watched, state, pages: { list: async (kind) => list[kind] ?? [], get } }
}

describe('fetchSends', () => {
  it('reads only pages published inside the lookback, at most MAX_PAGES, and only read methods', async () => {
    const h = await hubOf()
    const s = await fetchSends(cfg(), h, NOW)
    expect([...new Set(s.sends.map((x) => x.pageId))]).toEqual(['letter', 'plan'])
    expect(h.reads.some((r) => r.endsWith(':old'))).toBe(false)
    expect([...new Set(h.reads.map((r) => r.split(':')[0]))].sort()).toEqual(['get', 'views'])
    // The page record is read for its goal only where the page has readers.
    expect(h.got.sort()).toEqual(['letter', 'plan'])
    expect(s.scanned).toEqual({ pages: 3, lookbackDays: 90, capped: false })
    expect(MAX_PAGES).toBeGreaterThanOrEqual(30)
  })

  it('gives every send what the module reports, outcome included, under the page\'s goal, the owner left out', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    const ada = sends.find((x) => x.pageId === 'plan' && x.label === 'Ada')!
    expect(ada).toMatchObject({ opened: true, firstOpenAt: ago(4), cameBack: true, activeSeconds: 60, plays: 1, sentAt: ago(5), url: 'https://hub.example.com/plan', title: 'The plan' })
    expect(ada).toMatchObject({ goal: 'respond', outcome: 'acted', succeeded: true, sessions: 2, lastOpenAt: new Date(Date.parse(ago(4)) + 2 * 3_600_000).toISOString(), daysSinceSent: 5 })
    const bo = sends.find((x) => x.pageId === 'letter')!
    expect(bo).toMatchObject({ goal: { click: 'book' }, outcome: 'acted', succeeded: true, clicks: [expect.objectContaining({ cta: 'book' })] })
    expect(sends.find((x) => x.pageId === 'plan' && x.label === 'Bo')).toMatchObject({ outcome: 'not-opened', succeeded: false, daysSinceSent: 5 })
    expect(ada.comments).toEqual([expect.objectContaining({ text: 'Looks right.' })])
    expect(sends.some((x) => x.label === 'Me')).toBe(false)
  })

  it('flags a send not opened quietDays after it was sent, never one with no send recorded, and never a revoked one', async () => {
    const h = await hubOf()
    await h.recipients.revoke('plan', [h.ids.cy])
    const [dee] = await h.recipients.add('plan', [{ label: 'Dee' }])
    const later = new Date(NOW.getTime() + 4 * DAY + 60_000)
    const { sends } = await fetchSends(cfg(), h, later)
    const by = (l: string) => sends.find((x) => x.pageId === 'plan' && x.label === l)!
    expect(by('Bo')).toMatchObject({ opened: false, quiet: true, daysSinceSent: 9 })
    expect(by('Cy')).toMatchObject({ revoked: true, quiet: false })
    expect(sends.find((x) => x.rid === dee.rid)).toMatchObject({ sentAt: null, quiet: false, daysSinceSent: null })
  })

  it('groups a person by the link\'s person id, else by name; a shared link is its own', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    expect(new Set(sends.filter((x) => x.label === 'Bo').map((x) => x.personKey))).toEqual(new Set(['p_bo000001']))
    expect(sends.find((x) => x.label === 'Ada')!.personKey).toBe('name:ada')
  })
})

describe('the Activity feed', () => {
  it('is one line per event, newest first: opens with time read, came back and plays, and each comment', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    const all = activityFeed(sends, parseFilters({}), NOW)
    const f = { ...all, events: all.events.filter((e) => e.kind !== 'sent') }
    expect(f.events.map((e) => [e.kind, e.label, e.pageId])).toEqual([
      ['commented', 'Ada', 'plan'], ['clicked', 'Bo', 'letter'], ['opened', 'Bo', 'letter'], ['opened', 'Ada', 'plan'],
    ])
    expect(f.events[3]).toMatchObject({ at: ago(4), readSeconds: 60, cameBack: true, plays: 1, sessions: 2, lastOpenAt: new Date(Date.parse(ago(4)) + 2 * 3_600_000).toISOString() })
    expect(f.events[1]).toMatchObject({ cta: 'book' })
    expect(f.events[0]).toMatchObject({ text: 'Looks right.' })
    expect(f.more).toBe(false)
  })

  it('logs each send as its own line, dated by the recorded send, newest first beside the reads', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    const sent = activityFeed(sends, parseFilters({}), NOW).events.filter((e) => e.kind === 'sent')
    expect(sent.map((e) => [e.label, e.pageId, e.at, e.linkMade])).toEqual([
      ['Cy', 'plan', ago(1), false], ['Bo', 'letter', ago(2), false], ['Ada', 'plan', ago(5), false], ['Bo', 'plan', ago(5), false],
    ])
    const order = activityFeed(sends, parseFilters({ person: 'p_bo000001', page: 'letter' }), NOW).events.map((e) => e.kind)
    expect(order).toEqual(['clicked', 'opened', 'sent'])
  })

  it('dates a link with no recorded send by when it was made, and marks it, never calling it a send', async () => {
    const h = await hubOf()
    const [dee] = await h.recipients.add('letter', [{ label: 'Dee' }])
    void dee
    const { sends } = await fetchSends(cfg(), h, NOW)
    const line = activityFeed(sends, parseFilters({}), NOW).events.find((e) => e.kind === 'sent' && e.label === 'Dee')!
    expect(line).toMatchObject({ linkMade: true })
  })

  it('keeps the last 30 days and takes a limit, saying when there is more', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    expect(activityFeed(sends, parseFilters({ n: '2' }), NOW)).toMatchObject({ more: true })
    expect(activityFeed(sends, parseFilters({ n: '2' }), NOW).events).toHaveLength(2)
    expect(activityFeed(sends, parseFilters({}), new Date(NOW.getTime() + 31 * DAY)).events).toEqual([])
  })
})

describe('Waiting on', () => {
  it('lists the sends not opened after quietDays, newest send first, with the sent date', async () => {
    const h = await hubOf()
    const [eve] = await h.recipients.add('letter', [{ label: 'Eve' }])
    await h.recipients.setSent!('letter', [eve.rid], ago(4))
    const { sends } = await fetchSends(cfg(), h, NOW)
    expect(waitingOn(sends, parseFilters({})).items.map((x) => [x.label, x.pageId, x.sentAt])).toEqual([['Eve', 'letter', ago(4)], ['Bo', 'plan', ago(5)]])
    expect(waitingOn(sends, parseFilters({}), 1)).toMatchObject({ more: true })
  })
})

describe('filters, from the address', () => {
  it('narrow both lists by person, page, words, dates and not opened', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    const on = (q: Record<string, string>) => filterSends(sends, parseFilters(q)).map((x) => `${x.label}@${x.pageId}`).sort()
    expect(on({ person: 'p_bo000001' })).toEqual(['Bo@letter', 'Bo@plan'])
    expect(on({ page: 'letter' })).toEqual(['Bo@letter'])
    expect(on({ q: 'PLAN' })).toEqual(['Ada@plan', 'Bo@plan', 'Cy@plan'])
    expect(on({ q: 'cy' })).toEqual(['Cy@plan'])
    expect(on({ waiting: '1' })).toEqual(['Bo@plan', 'Cy@plan'])
    const day = (d: number) => ago(d).slice(0, 10)
    expect(on({ from: day(2) })).toEqual(['Bo@letter', 'Cy@plan'])
    expect(on({ to: day(3) })).toEqual(['Ada@plan', 'Bo@plan'])
    expect(activityFeed(sends, parseFilters({ from: day(2) }), NOW).events.filter((e) => e.kind !== 'sent').map((e) => e.label)).toEqual(['Bo', 'Bo'])
  })
  it('ignore what is not a filter', () => {
    expect(parseFilters({ from: 'soon', n: '-4', person: 'x'.repeat(300) })).toMatchObject({ from: null, limit: 30, person: null })
    expect(parseFilters({ n: '90' }).limit).toBe(90)
  })
})

describe('the outcome board', () => {
  it('puts every send in the column of the module\'s outcome, in the module\'s order, revoked links left out', async () => {
    const h = await hubOf()
    await h.recipients.revoke('plan', [h.ids.cy])
    const { sends } = await fetchSends(cfg(), h, NOW)
    const b = outcomeBoard(sends, parseFilters({}))
    expect(b.map((c) => c.outcome)).toEqual(['not-opened', 'opened', 'read', 'returned', 'acted'])
    expect(b.map((c) => c.sends.map((s) => `${s.label}@${s.pageId}`))).toEqual([['Bo@plan'], [], [], [], ['Bo@letter', 'Ada@plan']])
    expect(b.map((c) => c.count)).toEqual([1, 0, 0, 0, 2])
    expect(outcomeBoard(sends, parseFilters({ person: 'name:ada' }))[4].sends.map((s) => s.label)).toEqual(['Ada'])
    expect(outcomeBoard(sends, parseFilters({ n: '1' }))[4]).toMatchObject({ count: 2, more: true })
  })
  it('heats a Not opened send as it ages against quietDays', () => {
    expect([null, 0, 1, 3, 5, 6, 12].map((d) => heatOf(d, 3))).toEqual([0, 0, 1, 2, 2, 3, 3])
    expect(heatOf(1, 0)).toBe(3)
  })
})

describe('the counts, one page, one person', () => {
  it('counts the pages sent this week, the sends opened, and those waiting', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    expect(countsOf(sends, NOW)).toEqual({ pagesSentThisWeek: 2, sentThisWeek: 4, openedThisWeek: 2, waiting: 1, succeededThisWeek: 2 })
  })
  it('gives one person everything sent to them, newest send first, with what they did', async () => {
    const { sends } = await fetchSends(cfg(), await hubOf(), NOW)
    const t = timelineOf(sends, 'p_bo000001')!
    expect(t.label).toBe('Bo')
    expect(t.sends.map((x) => [x.pageId, x.opened])).toEqual([['letter', true], ['plan', false]])
    expect(timelineOf(sends, 'nobody')).toBeNull()
  })
})

describe('the hub config and the labels', () => {
  it('links a page under the hub\'s prefix', () => {
    expect(pageUrl({ ...cfg(), pagePrefix: '/a/' }, 'plan')).toBe('https://hub.example.com/a/plan')
  })
  it('names every outcome the module measures', () => {
    expect(Object.keys(OUTCOME_LABEL)).toEqual([...OUTCOMES])
  })
})
