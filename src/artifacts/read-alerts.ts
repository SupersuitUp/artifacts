// Which moments in a reader's record are worth telling the publisher about, decided in one pure
// function so every host agrees and every rule is testable without a store.
//
// Five kinds, each at most once per reader per page (the caller keeps what it already sent and
// passes it back as `sent`):
//
//   first-open  the reader's first recorded visit
//   refused     a signed-in person was turned away at the door; carries the account they tried
//   finished    reached the end (maxScroll >= 90) AND read for at least a third of the page's
//               reading time at WORDS_PER_MINUTE, so a thirty-second scroll is not a finished read
//   came-back   a visit that started on a later local day than the first one
//   quiet       listed QUIET_AFTER_DAYS or more ago and never opened; meant for a daily sweep
//
// Never: a visit, scroll progress, a partial read, or anyone in `ignore` (the publisher's own
// reads). The package knows nothing about where an alert goes; the host decides that.
import type { ReaderSummary } from './readers-store.js'

export const READ_ALERT_KINDS = ['first-open', 'refused', 'finished', 'came-back', 'quiet'] as const
export type ReadAlertKind = (typeof READ_ALERT_KINDS)[number]

/** A normal adult reading pace, used to turn a page's word count into its reading time. */
export const WORDS_PER_MINUTE = 230
/** How far down counts as reaching the end, in percent of the page. */
export const FINISHED_SCROLL = 90
/** The share of the page's reading time a reader must actually spend for "finished". */
export const FINISHED_SHARE = 1 / 3
/** Days after a reader is listed before an unopened page earns one nudge. */
export const QUIET_AFTER_DAYS = 3
/** Past this many days after listing, a never-opened page stays silent: a sweep run for the first
 *  time over an old list must not nudge about pages everyone has long forgotten. */
export const QUIET_WINDOW_DAYS = 14
/** First-open and came-back describe something that just happened. A record older than this
 *  (a host turning alerts on over months of history) is not news, and does not alert. */
export const FRESH_HOURS = 24

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Words a reader reads: whitespace-separated tokens. */
export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/** Seconds a page takes to read at `wpm`. */
export function readSecondsFor(words: number, wpm: number = WORDS_PER_MINUTE): number {
  return words > 0 ? Math.round((words / wpm) * 60) : 0
}

/** The calendar day an instant falls on in `timeZone`, as YYYY-MM-DD. An unknown zone reads as UTC
 *  rather than throwing, because a bad zone must never swallow an alert. */
export function localDay(at: string | Date, timeZone = 'UTC'): string {
  const d = typeof at === 'string' ? new Date(at) : at
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export type ReadAlertInput = {
  /** The kinds already sent for this reader on this page. */
  sent: Iterable<ReadAlertKind>
  /** The reader the record is about: the account that read, or the account that was refused. */
  email: string
  /** Their totals on this page (from `summarize`), or null when they have never opened it. */
  summary?: Pick<ReaderSummary, 'sessions' | 'activeSeconds' | 'maxScroll' | 'firstSeen' | 'lastSeen'> & { lastStarted?: string } | null
  /** True when this evaluation is for a refusal at the door that just happened. */
  refusedAttempt?: boolean
  /** The page's reading time in seconds (`readSecondsFor`). Zero or absent: reaching the end is enough. */
  readSeconds?: number
  now: string | Date
  /** When the reader was put on the page's list (AllowEntry.addedAt). Needed for quiet. */
  addedAt?: string
  /** The zone "a later day" is judged in. Default UTC. */
  timeZone?: string
  /** Addresses whose reads never alert: the publisher, the owners. Compared case-insensitively. */
  ignore?: Iterable<string>
  quietAfterDays?: number
}

export type ReadAlert = {
  kind: ReadAlertKind
  email: string
  sessions: number
  activeSeconds: number
  maxScroll: number
  /** quiet only: whole days since the reader was listed. */
  daysSinceAdded?: number
}

/** The alerts due for one reader on one page, given what was already sent. Pure. */
export function readAlertsDue(input: ReadAlertInput): ReadAlert[] {
  const email = input.email.trim().toLowerCase()
  const ignore = new Set([...(input.ignore ?? [])].map((e) => e.trim().toLowerCase()).filter(Boolean))
  if (!email || ignore.has(email)) return []
  const sent = new Set(input.sent)
  const now = (typeof input.now === 'string' ? new Date(input.now) : input.now).getTime()
  const s = input.summary && input.summary.sessions > 0 ? input.summary : null
  const base = { email, sessions: s?.sessions ?? 0, activeSeconds: s?.activeSeconds ?? 0, maxScroll: s?.maxScroll ?? 0 }
  const fresh = (at: string | undefined) => !!at && now - new Date(at).getTime() <= FRESH_HOURS * HOUR_MS
  const out: ReadAlert[] = []

  if (input.refusedAttempt) {
    if (!sent.has('refused')) out.push({ kind: 'refused', ...base })
    return out
  }

  if (s) {
    if (!sent.has('first-open') && fresh(s.firstSeen)) out.push({ kind: 'first-open', ...base })
    const started = s.lastStarted
    const zone = input.timeZone ?? 'UTC'
    if (!sent.has('came-back') && started && fresh(started) && localDay(started, zone) > localDay(s.firstSeen, zone))
      out.push({ kind: 'came-back', ...base })
    const need = (input.readSeconds ?? 0) * FINISHED_SHARE
    if (!sent.has('finished') && s.maxScroll >= FINISHED_SCROLL && s.activeSeconds >= need) out.push({ kind: 'finished', ...base })
    return out
  }

  // Never opened. One nudge, once, inside the window, and never after any open has been told.
  if (input.addedAt && !sent.has('quiet') && !sent.has('first-open')) {
    const days = (now - new Date(input.addedAt).getTime()) / DAY_MS
    const after = input.quietAfterDays ?? QUIET_AFTER_DAYS
    if (days >= after && days < QUIET_WINDOW_DAYS) out.push({ kind: 'quiet', ...base, daysSinceAdded: Math.floor(days) })
  }
  return out
}

/** What `onReaderEvent` hands a host: one reader's state on one gated page, just after it changed.
 *
 *  - `visit`: a reading heartbeat was recorded (`summary` is their record so far).
 *  - `refused`: a signed-in person was turned away at the door (`reader` is the account tried).
 *  - `sweep`: a listed reader, visited by `sweepReaders()` (a daily job) whether or not anything
 *    changed, so a host can notice what did NOT happen (quiet). */
export type ReaderEvent = {
  kind: 'visit' | 'refused' | 'sweep'
  artifactId: string
  title: string
  /** The page's address, e.g. https://artifacts.example.com/abc23456. */
  url: string
  reader: { email: string; name: string | null }
  /** Their totals on this page, or null when they have never opened it. */
  summary: ReaderSummary | null
  /** Their list entry on this page, or null (a member reading by membership, or a refusal). */
  entry: { email: string; name?: string; addedAt?: string } | null
  /** Words a reader reads on the page, and the seconds that takes at WORDS_PER_MINUTE. */
  words: number
  readSeconds: number
  /** When the event happened, ISO. */
  at: string
}
