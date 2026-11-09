// Artifact analytics, the rule, pure: a hub read through this package's OWN stores becomes one list of SENDS (one per
// reader link on a page), and from it the Activity feed, Waiting on, the counts on top, the outcome board, one page's
// readers and one person's timeline. Every number a send carries is the module's: `summarizeViews` is the function the
// hub's GET /api/artifacts/<id>/views answers with, so a dashboard never counts an open differently from the hub (a
// render before the send stays out, the owner stays out). Nothing here touches Firestore or writes; the stores are
// passed in by the app that shows it (a continent app's Artifacts tile, a hub's owner view).
//
// The summary also carries each send's OUTCOME under the page's goal (not-opened, opened, read, returned, acted),
// whether it SUCCEEDED, daysSinceSent, lastOpenAt, sessions, each open and each CTA click, all passed through as the
// module gives them; the only thing this file adds is the heat of an unopened card (heatOf), a picture of
// daysSinceSent against the config's quietDays. The screen that draws all of it is `ArtifactsTile` in `./owner`.
//
// WHAT THE MODULE CANNOT ANSWER, and so this does not draw:
// - Any read by time window across pages: the stores answer one page at a time. So this reads the pages PUBLISHED in
//   the last LOOKBACK_DAYS, at most MAX_PAGES of them, newest first, and says so on the screen. An open on an older
//   page is not seen. Re-deriving either from the raw view sessions would re-implement the hub's before-send rule.
import { ARTIFACT_KINDS, COMMENTS_SLOT, DEFAULT_GOAL, OUTCOMES, summarizeViews, type ArtifactGoal, type ArtifactListItem, type ArtifactStore, type Outcome, type RecipientSummary, type RecipientsStore, type StateStore } from '../artifacts/index.js'

/** The hub a dashboard reads: its public address and page prefix (for links), and after how many days an unopened send
 *  is waiting. A continent's `artifacts` config is one. */
export interface AnalyticsConfig { site: string; pagePrefix: string; quietDays: number }

/** What each of the module's outcomes is called on the screen. */
export const OUTCOME_LABEL: Record<Outcome, string> = { 'not-opened': 'Not opened', opened: 'Opened', read: 'Read', returned: 'Came back', acted: 'Acted' }

const DAY = 86_400_000
/** The feed shows this many days. */
export const FEED_DAYS = 30
/** Pages published this many days back are read; older ones are not. */
export const LOOKBACK_DAYS = 90
/** At most this many pages are read on one open, newest first. */
export const MAX_PAGES = 60
/** Lines on one screen of the feed or of Waiting on, until "load more". */
export const PAGE_SIZE = 30

/** The hub's stores this tile reads, and only the read methods of each. */
export interface HubStores {
  /** `list` for the pages, `get` for a page's goal (only for a page with readers). */
  pages: Pick<ArtifactStore, 'list' | 'get'>
  recipients: Pick<RecipientsStore, 'get' | 'views'>
  /** Readers' comments; without it no comment is seen. */
  state?: Pick<StateStore, 'entries'> | null
}

/** One reader link on one page, with what the module reports it did. */
export interface Send {
  pageId: string; title: string; url: string
  rid: string; label: string
  /** The link's person id when it carries one (provenance.subject), else the name; a shared link is its own. */
  personKey: string
  group: boolean; revoked: boolean
  /** From the link's provenance, as the module returns it: the funnel and stage it was sent for, the sender's opaque
   *  person id for the reader, and who minted it. Null when the link was made without one. */
  funnel: string | null; fromStage: string | null; subject: string | null; sender: string | null
  /** When the sender recorded the send, or null when none was recorded. */
  sentAt: string | null
  addedAt: string
  /** What the send is dated by: sentAt, else when the link was made. */
  sentFrom: string
  opened: boolean; firstOpenAt: string | null; cameBack: boolean
  activeSeconds: number; plays: number; devices: number
  comments: { at: string; text: string }[]
  /** The module's: whole days since the recorded send, or null when no send was recorded. */
  daysSinceSent: number | null
  /** The module's: when the last session began, how many sessions, and when each began. */
  lastOpenAt: string | null; sessions: number; opens: { at: string; activeSeconds: number }[]
  /** The module's: each press of a CTA on the page. */
  clicks: { cta: string; at: string }[]
  /** The page's goal, and the module's outcome under it and whether that met the goal. */
  goal: ArtifactGoal; outcome: Outcome; succeeded: boolean
  /** Not opened, not revoked, and daysSinceSent at least quietDays. A send with no recorded send never is. */
  quiet: boolean
}
export interface Sends { fetchedAt: string; quietDays: number; sends: Send[]; scanned: { pages: number; lookbackDays: number; capped: boolean } }

export interface FeedEvent {
  kind: 'sent' | 'opened' | 'commented' | 'clicked'; at: string
  pageId: string; title: string; url: string; personKey: string; label: string
  /** On an open: the module's totals for that send. */
  readSeconds?: number; cameBack?: boolean; plays?: number; sessions?: number; lastOpenAt?: string | null
  /** On a click: the CTA's id. */
  cta?: string
  /** On a comment: its words. */
  text?: string
  /** On a send: true when no send was recorded and the line is dated by when the link was made; and whether the link is
   *  a shared (group) one, which counts as one send to the group. */
  linkMade?: boolean; group?: boolean
}

export interface Filters { q: string | null; person: string | null; page: string | null; from: string | null; to: string | null; waiting: boolean; limit: number }

export const pageUrl = (cfg: Pick<AnalyticsConfig, 'site' | 'pagePrefix'>, id: string) => `${cfg.site}${cfg.pagePrefix}${encodeURIComponent(id)}`

/** One reader's line from the module (summarizeViews, the same line GET /views answers with) as a Send on `page`.
 *  `addedAt` is when the link was made (the recipients record's; a line from /views alone lacks it). Pure, so a
 *  browser holding /views and /recipients draws the same send the dashboard does (the page's owner panel). */
export function sendOfSummary(cfg: Pick<AnalyticsConfig, 'quietDays'>, page: { id: string; title: string; url: string }, s: RecipientSummary, addedAt: string): Send {
  const sentFrom = s.sentAt ?? addedAt
  return {
    pageId: page.id, title: page.title || page.id, url: page.url, rid: s.rid, label: s.label,
    personKey: s.group ? `group:${page.id}:${s.rid}` : (s.provenance?.subject ?? `name:${s.label.trim().toLowerCase()}`),
    group: s.group, revoked: s.revoked, sentAt: s.sentAt, addedAt, sentFrom,
    funnel: s.provenance?.funnel ?? null, fromStage: s.provenance?.stage ?? null, subject: s.provenance?.subject ?? null, sender: s.provenance?.actor ?? null,
    opened: s.opened, firstOpenAt: s.firstOpenAt, cameBack: s.cameBack, activeSeconds: s.activeSeconds, plays: s.plays, devices: s.devices,
    comments: s.comments.map((c) => ({ at: c.at, text: c.text })),
    daysSinceSent: s.daysSinceSent, lastOpenAt: s.lastOpenAt, sessions: s.sessions,
    opens: s.opens.map((o) => ({ at: o.at, activeSeconds: o.activeSeconds })), clicks: s.clicks.map((c) => ({ cta: c.cta, at: c.at })),
    goal: s.goal, outcome: s.outcome, succeeded: s.succeeded,
    quiet: s.outcome === 'not-opened' && !s.revoked && s.daysSinceSent !== null && s.daysSinceSent >= cfg.quietDays,
  }
}

async function sendsOf(cfg: AnalyticsConfig, stores: HubStores, p: ArtifactListItem, now: Date): Promise<Send[]> {
  const rec = await stores.recipients.get(p.id)
  if (!rec || !Object.values(rec.recipients).some((r) => !r.owner)) return []
  const [views, entries, page] = await Promise.all([
    stores.recipients.views(p.id), stores.state ? stores.state.entries(p.id) : Promise.resolve([]), stores.pages.get(p.id),
  ])
  const goal = page?.goal ?? DEFAULT_GOAL
  const comments = entries.filter((e) => e.slot === COMMENTS_SLOT).map((e) => ({
    readerKey: e.readerKey, id: e.id, at: e.at, text: String((e.value as { body?: unknown } | null)?.body ?? ''),
  }))
  const where = { id: p.id, title: p.title, url: pageUrl(cfg, p.id) }
  return summarizeViews(rec, views, comments, { goal, now }).map((s) => sendOfSummary(cfg, where, s, rec.recipients[s.rid].addedAt))
}

/** Every send on the pages published in the last LOOKBACK_DAYS (at most MAX_PAGES, newest first). Read-only. */
export async function fetchSends(cfg: AnalyticsConfig, stores: HubStores, now: Date = new Date()): Promise<Sends> {
  if (!stores.pages.list) throw new Error('this hub\'s page store cannot list its pages')
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString()
  const lists = await Promise.all(ARTIFACT_KINDS.map((k) => stores.pages.list!(k)))
  const recent = lists.flat().filter((p) => p.updatedAt >= since).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const read = recent.slice(0, MAX_PAGES)
  const sends = (await Promise.all(read.map((p) => sendsOf(cfg, stores, p, now)))).flat()
  return { fetchedAt: now.toISOString(), quietDays: cfg.quietDays, sends, scanned: { pages: read.length, lookbackDays: LOOKBACK_DAYS, capped: recent.length > MAX_PAGES } }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const one = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)

/** The filters in the address: q (words in a page title or a reader's name), person, page, from and to (the sent date,
 *  YYYY-MM-DD), waiting=1 (not opened), n (how many lines). Anything else is ignored. */
export function parseFilters(q: Record<string, string | undefined>): Filters {
  const n = Number(q.n)
  return {
    q: one(q.q, 100), person: one(q.person), page: one(q.page),
    from: DATE.test(q.from ?? '') ? q.from! : null, to: DATE.test(q.to ?? '') ? q.to! : null,
    waiting: q.waiting === '1',
    limit: Number.isInteger(n) && n >= 1 && n <= 1000 ? n : PAGE_SIZE,
  }
}

export function filterSends(sends: readonly Send[], f: Filters): Send[] {
  const words = f.q?.toLowerCase()
  return sends.filter((s) => {
    if (f.person && s.personKey !== f.person) return false
    if (f.page && s.pageId !== f.page) return false
    if (words && !s.title.toLowerCase().includes(words) && !s.label.toLowerCase().includes(words)) return false
    const day = s.sentFrom.slice(0, 10)
    if (f.from && day < f.from) return false
    if (f.to && day > f.to) return false
    if (f.waiting && (s.opened || s.revoked)) return false
    return true
  })
}

/** The Activity feed: one line per event in the last FEED_DAYS, newest first, the first `limit` of them. A send is an
 *  event too, dated by its recorded send, else by when its link was made (marked `linkMade`, never claimed as a send). */
export function activityFeed(sends: readonly Send[], f: Filters, now: Date = new Date()): { events: FeedEvent[]; more: boolean } {
  const since = new Date(now.getTime() - FEED_DAYS * DAY).toISOString()
  const events: FeedEvent[] = []
  for (const s of filterSends(sends, f)) {
    const who = { pageId: s.pageId, title: s.title, url: s.url, personKey: s.personKey, label: s.label }
    events.push({ kind: 'sent', at: s.sentFrom, ...who, linkMade: !s.sentAt, group: s.group })
    if (s.opened && s.firstOpenAt) events.push({ kind: 'opened', at: s.firstOpenAt, ...who, readSeconds: s.activeSeconds, cameBack: s.cameBack, plays: s.plays, sessions: s.sessions, lastOpenAt: s.lastOpenAt })
    for (const c of s.comments) events.push({ kind: 'commented', at: c.at, ...who, text: c.text })
    for (const c of s.clicks) events.push({ kind: 'clicked', at: c.at, ...who, cta: c.cta })
  }
  // Newest first; at the same moment the later step reads first (a click, then the open it came from, then the send).
  const rank = { sent: -1, opened: 0, commented: 1, clicked: 2 }
  const inWindow = events.filter((e) => e.at >= since).sort((a, b) => b.at.localeCompare(a.at) || rank[b.kind] - rank[a.kind])
  return { events: inWindow.slice(0, f.limit), more: inWindow.length > f.limit }
}

/** Waiting on: the sends not opened after quietDays, newest send first, the first `limit` of them. */
export function waitingOn(sends: readonly Send[], f: Filters, limit = f.limit): { items: Send[]; more: boolean } {
  const all = filterSends(sends, f).filter((s) => s.quiet).sort((a, b) => b.sentFrom.localeCompare(a.sentFrom))
  return { items: all.slice(0, limit), more: all.length > limit }
}

/** The counts on top: pages sent in the last 7 days and their sends, how many of those were opened, and all waiting. */
export function countsOf(sends: readonly Send[], now: Date = new Date()) {
  const week = new Date(now.getTime() - 7 * DAY).toISOString()
  const recent = sends.filter((s) => s.sentFrom >= week && !s.revoked)
  return {
    pagesSentThisWeek: new Set(recent.map((s) => s.pageId)).size,
    sentThisWeek: recent.length,
    openedThisWeek: recent.filter((s) => s.opened).length,
    waiting: sends.filter((s) => s.quiet).length,
    succeededThisWeek: recent.filter((s) => s.succeeded).length,
  }
}

/** The outcome board: one column per outcome, in the module's order (OUTCOMES), each send in the column of its
 *  outcome, revoked links left out, newest send first, the first `limit` of each. */
export function outcomeBoard(sends: readonly Send[], f: Filters): { outcome: Outcome; sends: Send[]; count: number; more: boolean }[] {
  const live = filterSends(sends, f).filter((s) => !s.revoked).sort((a, b) => b.sentFrom.localeCompare(a.sentFrom))
  return OUTCOMES.map((outcome) => {
    const all = live.filter((s) => s.outcome === outcome)
    return { outcome, sends: all.slice(0, f.limit), count: all.length, more: all.length > f.limit }
  })
}

/** How hot an unopened card is drawn, 0 to 3, from the module's daysSinceSent against the config's quietDays:
 *  0 sent today or no send recorded, 1 younger than quietDays, 2 past it, 3 at twice it or more. */
export function heatOf(daysSinceSent: number | null, quietDays: number): 0 | 1 | 2 | 3 {
  if (daysSinceSent === null || daysSinceSent <= 0) return 0
  if (quietDays <= 0) return 3
  const r = daysSinceSent / quietDays
  return r < 1 ? 1 : r < 2 ? 2 : 3
}

/** One person: everything sent to them, newest send first, or null when nothing was. */
export function timelineOf(sends: readonly Send[], personKey: string): { key: string; label: string; sends: Send[] } | null {
  const mine = sends.filter((s) => s.personKey === personKey).sort((a, b) => b.sentFrom.localeCompare(a.sentFrom))
  return mine.length ? { key: personKey, label: mine[0].label, sends: mine } : null
}

/** One page: its readers, in the order they were sent, or null when it has none here. */
export function readersOf(sends: readonly Send[], pageId: string): { id: string; title: string; url: string; sends: Send[] } | null {
  const mine = sends.filter((s) => s.pageId === pageId)
  return mine.length ? { id: pageId, title: mine[0].title, url: mine[0].url, sends: mine } : null
}

/** The people and pages there are to filter by, by name and title. */
export function choicesOf(sends: readonly Send[]) {
  const people = new Map<string, string>()
  const pages = new Map<string, string>()
  for (const s of sends) { if (!people.has(s.personKey)) people.set(s.personKey, s.label); if (!pages.has(s.pageId)) pages.set(s.pageId, s.title) }
  const sorted = (m: Map<string, string>) => [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label))
  return { people: sorted(people), pages: sorted(pages) }
}
