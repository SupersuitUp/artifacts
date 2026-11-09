// The owner's view of a hub: what readers did with the pages the owner sent, as one screen. It is the continent app's
// Artifacts tile, moved here so the tile and a hub's own owner view draw the same thing from one copy. The rules are
// `../analytics` (pure, tested there); this file only draws. It holds no data loading and no sign-in: the app reads the
// hub (fetchSends), decides who may see it, and hands the result in with its own theme, Back row and page-not-found.
//
// THE HOME is the Activity feed (one line per event, newest first, the last FEED_DAYS days, "Load more" in the
// address) and Waiting on (sends not opened after quietDays, newest send first), under the counts for the week, with
// search and filters over both. Everything is chosen by the address, so the screen needs no client script and any view
// can be shared as a link: q, person, page, from, to (the sent date), waiting=1, n (lines), tab=waiting (the phone's
// second tab). `p=<id>` opens one page's readers; `who=<person>` one person's timeline.
//
// THE OUTCOME VIEW (`view=outcomes`, a switch at the top) is a kanban: every send in the column of the module's
// outcome for it (not opened, opened, read, came back, acted), each card with the reader, the page, the page's goal and
// a mark when it met the goal; an unopened card heats as it ages against quietDays. Each column names its suggested next
// step as one static line. A card whose send has a draft for the stage it is in now shows Draft ready, linking where
// the app says (`draftHref`). Nothing here drafts or sends.
//
// From Tailwind's lg breakpoint (1024px) the filters sit on the left; the Activity view puts the feed in the centre and
// Waiting on on the right, the outcome view spans the kanban across the rest. Under it the Activity view is the feed
// with Waiting on as a tab, the outcome view one stage at a time behind stage tabs with counts, and the filters are
// folded under a summary. The main is `data-wide`, so a layout can drop its phone-width cap at lg. The class names are
// Tailwind's: an app that draws this must let Tailwind scan this package's `lib/owner` (`@source`).
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { OUTCOMES, type ArtifactGoal, type Outcome } from '../artifacts/index.js'
import {
  activityFeed, choicesOf, countsOf, FEED_DAYS, heatOf, OUTCOME_LABEL, outcomeBoard, PAGE_SIZE, parseFilters, readersOf, timelineOf, waitingOn,
  type FeedEvent, type Filters, type Send, type Sends,
} from '../analytics/index.js'

/** The colours and display face the screen draws in, from the app's own theme. */
export interface ArtifactsTileTheme {
  card: string; ink: string; muted: string; hairline: string
  accentSoft: string; accentTint: string; danger: string; primary: string; onPrimary: string
  /** The display face, for headings and names. */
  heading: CSSProperties
}

export interface ArtifactsTileProps {
  /** The hub as fetchSends read it. */
  data: Sends
  /** The address's query: filters, view, tab, stage, n, p, who. */
  query: Record<string, string | undefined>
  /** The home's title. */
  title: string
  theme: ArtifactsTileTheme
  /** The app's Back row, drawn at the top of every view, pointing at `href`. */
  back: (href: string) => ReactNode
  /** Called when `p` or `who` names nothing here; it must throw (Next's notFound). */
  notFound: () => never
  /** Where this screen lives; every link and the filter form point here. Default `/artifacts`. */
  basePath?: string
  /** Where Back goes from the home. Default `/`. */
  homeHref?: string
  /** On the outcome view: where a card's Draft ready goes, or null when that send has no draft for its stage. */
  draftHref?: (s: Send) => string | null
  /** Every page on the hub, listed under the home's columns (a hub's own owner view). Absent: no list. */
  pages?: HubPage[]
}

/** One page of the hub in the home's page list. */
export interface HubPage {
  id: string; title: string; url: string; kind: string; updatedAt: string
  /** How many people hold a live reader link of their own (LIST's readerLinks). */
  readerLinks: number
  /** The page's view counter, where the kind keeps one. */
  views?: number
}

/** The tile's theme from a page's own theme variables (`--a-*`, set by BrandGround or carried onto a portal), so the
 *  hub's owner view and a page's owner panel draw in the page's look, light or dark. `display` is the pack's face. */
export function themeFromPageVars(display?: string): ArtifactsTileTheme {
  return {
    card: 'var(--a-surface, var(--a-ground, #fff))', ink: 'var(--a-strong, var(--a-ink, #111))', muted: 'var(--a-muted, #666)',
    hairline: 'var(--a-line, rgba(127,127,127,0.3))',
    accentSoft: 'color-mix(in srgb, var(--a-accent, #111) 45%, var(--a-ground, #fff))',
    accentTint: 'color-mix(in srgb, var(--a-accent, #111) 14%, var(--a-ground, #fff))',
    danger: '#c0392b', primary: 'var(--a-accent, #111)', onPrimary: 'var(--a-on-accent, var(--a-ground, #fff))',
    heading: display ? { fontFamily: display } : {},
  }
}

type Query = Record<string, string | undefined>
interface Ctx { t: ArtifactsTileTheme; base: string }

const DAY = 86_400_000
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const seconds = (n: number) => (n < 60 ? `${n}s` : n < 3600 ? `${Math.round(n / 60)} min` : `${(n / 3600).toFixed(1)} h`)
const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)
function ago(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso)
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`
  if (ms < DAY) return `${Math.round(ms / 3_600_000)}h ago`
  return `${days(Math.floor(ms / DAY))} ago`
}

const FILTER_KEYS = ['q', 'person', 'page', 'from', 'to', 'waiting'] as const
/** The address of the home with these filters and this view, and whatever else is asked. */
function href(c: Ctx, q: Query, extra: Record<string, string | null> = {}): string {
  const s = new URLSearchParams()
  for (const k of FILTER_KEYS) if (q[k]) s.set(k, q[k]!)
  if (q.view === 'outcomes') s.set('view', 'outcomes')
  for (const [k, v] of Object.entries(extra)) if (v) s.set(k, v); else s.delete(k)
  const t = s.toString()
  return t ? `${c.base}?${t}` : c.base
}
const personHref = (c: Ctx, key: string) => `${c.base}?${new URLSearchParams({ who: key })}`
const pageHref = (c: Ctx, id: string) => `${c.base}?${new URLSearchParams({ p: id })}`

function stateOf(s: Send): string {
  if (s.revoked) return 'Link revoked'
  if (!s.opened) return s.daysSinceSent === null ? 'Not opened, no send recorded' : `Not opened, sent ${days(s.daysSinceSent)} ago`
  return `First opened ${day(s.firstOpenAt)}${s.cameBack ? ', came back' : ''}`
}
const detailsOf = (s: Send) => [
  s.opened && s.activeSeconds ? `read ${seconds(s.activeSeconds)}` : '',
  s.plays ? `${s.plays} play${s.plays === 1 ? '' : 's'}` : '',
  s.devices > 1 ? `${s.devices} devices` : '',
  s.comments.length ? `${s.comments.length} comment${s.comments.length === 1 ? '' : 's'}` : '',
  s.group ? 'shared link' : '',
].filter(Boolean).join(' · ')

// The next step each stage suggests, as words only. Drafting it is the funnel engine's, on a member's Mac.
const SUGGESTION: Record<Outcome, (quietDays: number) => string> = {
  'not-opened': (d) => `Next: a short nudge, once it is past ${days(d)}.`,
  opened: () => 'Next: resend it with a shorter hook.',
  read: () => 'Next: ask the question directly.',
  returned: () => 'Next: they came back to it; ask the question directly.',
  acted: () => 'Next: a thank-you, or the next step.',
}
function goalWords(g: ArtifactGoal): string {
  if (g === 'read') return 'read it'
  if (g === 'respond') return 'a reply'
  if (g === 'ack') return 'an acknowledgement'
  return `press “${g.click}”`
}

const card = (t: ArtifactsTileTheme, flag = false) => ({ backgroundColor: t.card, boxShadow: `inset 0 0 0 1px ${flag ? t.danger : t.hairline}` })
const linkStyle = (t: ArtifactsTileTheme) => ({ color: t.ink, textDecoration: 'underline', textDecorationColor: t.hairline, textUnderlineOffset: '3px' })

function Counts({ c, data, now }: { c: Ctx; data: Sends; now: Date }) {
  const { t } = c
  const n = countsOf(data.sends, now)
  const box = 'rounded-2xl px-4 py-3'
  return (
    <div data-view="counts" className="grid grid-cols-3 gap-2 px-5 pb-4">
      <p data-count="pages" className={box} style={card(t)}><span className="block text-2xl" style={{ ...t.heading, color: t.ink }}>{n.pagesSentThisWeek}</span><span className="text-xs" style={{ color: t.muted }}>{n.pagesSentThisWeek === 1 ? 'page' : 'pages'} sent this week</span></p>
      <p data-count="opened" className={box} style={card(t)}><span className="block text-2xl" style={{ ...t.heading, color: t.ink }}>{`${n.openedThisWeek} of ${n.sentThisWeek}`}</span><span className="text-xs" style={{ color: t.muted }}>{`opened · ${n.succeededThisWeek} met its goal`}</span></p>
      <p data-count="waiting" className={box} style={card(t, n.waiting > 0)}><span className="block text-2xl" style={{ ...t.heading, color: n.waiting ? t.danger : t.ink }}>{n.waiting}</span><span className="text-xs" style={{ color: t.muted }}>waiting after {days(data.quietDays)}</span></p>
    </div>
  )
}

function Sent({ c, e, now }: { c: Ctx; e: FeedEvent; now: Date }) {
  const { t } = c
  const person = <Link href={personHref(c, e.personKey)} style={{ ...linkStyle(t), ...t.heading }}>{e.label}</Link>
  const page = <Link href={pageHref(c, e.pageId)} style={{ ...linkStyle(t), ...t.heading }}>{e.title}</Link>
  return (
    <li data-event="sent" data-link-made={String(!!e.linkMade)} className="py-3" style={{ boxShadow: `inset 0 -1px 0 ${t.hairline}` }}>
      <p className="text-[15px]" style={{ color: t.ink }}>
        {e.linkMade ? <>Link made for {person} to {page}</> : <>You {e.group ? 'shared' : 'sent'} {page} {e.group ? 'with' : 'to'} {person}</>}
      </p>
      <p className="mt-0.5 text-sm" style={{ color: t.muted }}>{e.linkMade ? `${ago(e.at, now)} · no send recorded` : ago(e.at, now)}</p>
    </li>
  )
}

function Event({ c, e, now }: { c: Ctx; e: FeedEvent; now: Date }) {
  const { t } = c
  if (e.kind === 'sent') return <Sent c={c} e={e} now={now} />
  const what = e.kind === 'opened' ? 'opened' : e.kind === 'clicked' ? `pressed “${e.cta}” on` : 'commented on'
  const more = e.kind === 'opened'
    ? [
      e.readSeconds ? `read ${seconds(e.readSeconds)}` : '', e.cameBack ? 'came back' : '',
      e.sessions && e.sessions > 1 && e.lastOpenAt ? `${e.sessions} visits, last ${ago(e.lastOpenAt, now)}` : '',
      e.plays ? `played ${e.plays === 1 ? 'once' : `${e.plays} times`}` : '',
    ].filter(Boolean)
    : []
  return (
    <li data-event={e.kind} className="py-3" style={{ boxShadow: `inset 0 -1px 0 ${t.hairline}` }}>
      <p className="text-[15px]" style={{ color: t.ink }}>
        <Link href={personHref(c, e.personKey)} style={{ ...linkStyle(t), ...t.heading }}>{e.label}</Link>{` ${what} `}
        <Link href={pageHref(c, e.pageId)} style={{ ...linkStyle(t), ...t.heading }}>{e.title}</Link>
      </p>
      <p className="mt-0.5 text-sm" style={{ color: t.muted }}>{[ago(e.at, now), ...more].join(' · ')}</p>
      {e.text && <p className="mt-1 text-sm" style={{ color: t.ink }}>{`“${e.text.length > 200 ? `${e.text.slice(0, 200)}…` : e.text}”`}</p>}
    </li>
  )
}

function Feed({ c, data, f, q, now, className }: { c: Ctx; data: Sends; f: Filters; q: Query; now: Date; className: string }) {
  const { t } = c
  const feed = activityFeed(data.sends, f, now)
  return (
    <section data-view="feed" className={className} aria-label="Activity">
      <h2 className="text-xl" style={{ ...t.heading, color: t.ink }}>Activity</h2>
      <p className="text-xs" style={{ color: t.muted }}>{`The last ${FEED_DAYS} days, newest first`}</p>
      {feed.events.length ? (
        <ul>{feed.events.map((e, i) => <Event key={`${e.kind}-${e.pageId}-${e.personKey}-${e.at}-${i}`} c={c} e={e} now={now} />)}</ul>
      ) : <p className="mt-3 text-sm" style={{ color: t.muted }}>Nothing opened or commented on here in the last {FEED_DAYS} days.</p>}
      {feed.more && <Link data-more href={href(c, q, { n: String(f.limit + PAGE_SIZE), tab: null })} className="mt-3 inline-block text-sm underline" style={{ color: t.muted }}>Load more</Link>}
    </section>
  )
}

function Waiting({ c, data, f, q, now, className }: { c: Ctx; data: Sends; f: Filters; q: Query; now: Date; className: string }) {
  const { t } = c
  const w = waitingOn(data.sends, f)
  return (
    <section data-view="waiting" className={className} aria-label="Waiting on">
      <h2 className="text-xl" style={{ ...t.heading, color: t.ink }}>Waiting on</h2>
      <p className="text-xs" style={{ color: t.muted }}>{`Not opened ${days(data.quietDays)} after it was sent, newest send first`}</p>
      {w.items.length ? (
        <ul className="mt-2 flex flex-col gap-2">
          {w.items.map((s) => (
            <li key={`${s.pageId}-${s.rid}`} data-waiting={`${s.label}@${s.pageId}`} className="rounded-xl px-3 py-2.5" style={card(t, true)}>
              <p className="text-[15px]" style={{ color: t.ink }}>
                <Link href={personHref(c, s.personKey)} style={{ ...linkStyle(t), ...t.heading }}>{s.label}</Link>
                <span style={{ color: t.muted }}>{' · '}</span>
                <Link href={pageHref(c, s.pageId)} style={linkStyle(t)}>{s.title}</Link>
              </p>
              <p className="mt-0.5 text-sm" style={{ color: t.danger }}>{`${s.sentAt ? 'sent' : 'link made'} ${day(s.sentFrom)}, ${ago(s.sentFrom, now)}`}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm" style={{ color: t.muted }}>Nobody is waiting: everything sent has been opened, or was sent too recently to flag.</p>}
      {w.more && <Link data-more href={href(c, q, { n: String(f.limit + PAGE_SIZE), tab: 'waiting' })} className="mt-3 inline-block text-sm underline" style={{ color: t.muted }}>Load more</Link>}
    </section>
  )
}

function FilterForm({ c, data, q }: { c: Ctx; data: Sends; q: Query }) {
  const { t } = c
  const { people, pages } = choicesOf(data.sends)
  const field = 'mt-1 block w-full rounded-xl px-3 py-2'
  const fieldStyle = { backgroundColor: t.card, color: t.ink, boxShadow: `inset 0 0 0 1px ${t.hairline}` }
  const label = 'mt-3 block text-sm'
  return (
    <form method="get" action={c.base}>
      {q.view === 'outcomes' && <input type="hidden" name="view" value="outcomes" />}
      <label className={label} style={{ color: t.muted }}>Search
        <input name="q" type="search" defaultValue={q.q ?? ''} placeholder="A page or a name" className={field} style={fieldStyle} />
      </label>
      <label className={label} style={{ color: t.muted }}>Person
        <select name="person" defaultValue={q.person ?? ''} className={field} style={fieldStyle}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <label className={label} style={{ color: t.muted }}>Page
        <select name="page" defaultValue={q.page ?? ''} className={field} style={fieldStyle}>
          <option value="">Every page</option>
          {pages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <label className={label} style={{ color: t.muted }}>Sent from
        <input name="from" type="date" defaultValue={q.from ?? ''} className={field} style={fieldStyle} />
      </label>
      <label className={label} style={{ color: t.muted }}>Sent to
        <input name="to" type="date" defaultValue={q.to ?? ''} className={field} style={fieldStyle} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm" style={{ color: t.ink }}>
        <input name="waiting" type="checkbox" value="1" defaultChecked={q.waiting === '1'} className="h-5 w-5" />Not opened only
      </label>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className="rounded-full px-4 py-2 text-sm" style={{ backgroundColor: t.primary, color: t.onPrimary }}>Show</button>
        <Link href={c.base} className="text-sm underline" style={{ color: t.muted }}>Clear</Link>
      </div>
      <p className="mt-4 text-xs" style={{ color: t.muted }}>
        {`Reads the pages published in the last ${data.scanned.lookbackDays} days${data.scanned.capped ? `, the newest ${data.scanned.pages} of them` : ''}. An open on an older page is not shown.`}
      </p>
    </form>
  )
}

function BoardCard({ c, s, quietDays, now, draft }: { c: Ctx; s: Send; quietDays: number; now: Date; draft: string | null }) {
  const { t } = c
  const heatBorder = [t.hairline, t.accentSoft, t.danger, t.danger] as const
  const heat = s.outcome === 'not-opened' ? heatOf(s.daysSinceSent, quietDays) : 0
  const hot = heat >= 2
  return (
    <li data-card={`${s.label}@${s.pageId}`} data-succeeded={String(s.succeeded)} data-heat={heat} className="rounded-xl px-3 py-2.5"
      style={{ backgroundColor: heat === 3 ? `color-mix(in srgb, ${t.danger} 8%, transparent)` : t.card, boxShadow: `inset 0 0 0 ${hot ? 2 : 1}px ${s.outcome === 'not-opened' ? heatBorder[heat] : s.succeeded ? t.primary : t.hairline}` }}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href={personHref(c, s.personKey)} className="text-base leading-snug" style={{ ...linkStyle(t), ...t.heading }}>{s.label}</Link>
        {s.succeeded && <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: t.accentTint, color: t.ink }}>Met its goal</span>}
      </div>
      <Link href={pageHref(c, s.pageId)} className="mt-0.5 block text-sm" style={linkStyle(t)}>{s.title}</Link>
      <p className="mt-1 text-xs" style={{ color: t.muted }}>{`Goal: ${goalWords(s.goal)}`}</p>
      {draft && <Link data-draft href={draft} className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: t.primary, color: t.onPrimary }}>Draft ready</Link>}
      {s.outcome === 'not-opened'
        ? <p className="mt-1 text-sm" style={{ color: hot ? t.danger : t.muted }}>{s.daysSinceSent === null ? 'No send recorded' : s.daysSinceSent === 0 ? 'sent today' : `sent ${days(s.daysSinceSent)} ago`}</p>
        : <p className="mt-1 text-xs" style={{ color: t.muted }}>{[
          s.lastOpenAt ? `last open ${ago(s.lastOpenAt, now)}` : '', s.sessions > 1 ? `${s.sessions} visits` : '',
          s.activeSeconds ? `read ${seconds(s.activeSeconds)}` : '', s.comments.length ? `${s.comments.length} comment${s.comments.length === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' · ')}</p>}
    </li>
  )
}

function Board({ c, data, f, q, now, draftHref }: { c: Ctx; data: Sends; f: Filters; q: Query; now: Date; draftHref?: (s: Send) => string | null }) {
  const { t } = c
  const columns = outcomeBoard(data.sends, f)
  const stage = (OUTCOMES as readonly string[]).includes(q.stage ?? '') ? q.stage as Outcome : 'not-opened'
  return (
    <div className="min-w-0">
      <nav data-stage-tabs className="flex flex-wrap gap-2 pb-3 text-sm lg:hidden" aria-label="Stages">
        {columns.map((col) => (
          <Link key={col.outcome} href={href(c, q, { stage: col.outcome === 'not-opened' ? null : col.outcome, n: null })} aria-current={col.outcome === stage ? 'page' : undefined}
            className="shrink-0 rounded-full px-3 py-1.5" style={{ backgroundColor: col.outcome === stage ? t.primary : t.card, color: col.outcome === stage ? t.onPrimary : t.ink, boxShadow: `inset 0 0 0 1px ${col.outcome === stage ? t.primary : t.hairline}` }}>
            {`${OUTCOME_LABEL[col.outcome]} (${col.count})`}
          </Link>
        ))}
      </nav>
      <div data-view="board" className="lg:flex lg:items-start lg:gap-3 lg:overflow-x-auto lg:pb-4">
        {columns.map((col) => (
          <section key={col.outcome} data-outcome={col.outcome} data-count={col.count}
            className={`${col.outcome === stage ? 'flex' : 'hidden lg:flex'} min-w-0 flex-col rounded-2xl p-2 lg:min-w-40 lg:flex-1 lg:basis-0`} style={{ backgroundColor: `color-mix(in srgb, ${t.hairline} 33%, transparent)` }}>
            <header className="mb-2 px-1">
              <h2 className="text-lg leading-tight" style={{ ...t.heading, color: t.ink }}>{OUTCOME_LABEL[col.outcome]}</h2>
              <p className="text-xs" style={{ color: t.muted }}>{col.count === 1 ? '1 send' : `${col.count} sends`}</p>
              <p data-suggestion className="mt-1 text-xs" style={{ color: t.ink }}>{SUGGESTION[col.outcome](data.quietDays)}</p>
            </header>
            {col.sends.length
              ? <ul className="flex flex-col gap-2">{col.sends.map((s) => <BoardCard key={`${s.pageId}-${s.rid}`} c={c} s={s} quietDays={data.quietDays} now={now} draft={draftHref ? draftHref(s) : null} />)}</ul>
              : <p className="px-1 text-sm" style={{ color: t.muted }}>None here.</p>}
            {col.more && <Link data-more href={href(c, q, { n: String(f.limit + PAGE_SIZE) })} className="mt-2 px-1 text-sm underline" style={{ color: t.muted }}>Load more</Link>}
          </section>
        ))}
      </div>
      <p className="mt-2 text-xs" style={{ color: t.muted }}>Suggestions only. A draft is written and sent from a member&apos;s Mac, on their approval; nothing is sent from this app.</p>
    </div>
  )
}

function SendCard({ c, s, title, attr, children }: { c: Ctx; s: Send; title: string; attr: Record<string, string>; children?: ReactNode }) {
  const { t } = c
  const more = detailsOf(s)
  return (
    <li {...attr} data-quiet={String(s.quiet)} className="rounded-2xl px-4 py-3" style={card(t, s.quiet)}>
      <span className="text-lg" style={{ ...t.heading, color: t.ink }}>{title}</span>
      <p className="mt-1 text-sm" style={{ color: t.muted }}>{s.sentAt ? `Sent ${day(s.sentAt)}` : `Link made ${day(s.addedAt)}, no send recorded`}</p>
      <p className="mt-1 text-[15px]" style={{ color: s.quiet ? t.danger : s.opened ? t.ink : t.muted }}>{stateOf(s)}</p>
      {more && <p className="mt-1 text-sm" style={{ color: t.muted }}>{more}</p>}
      {s.comments.map((cm, i) => <p key={i} className="mt-1 text-sm" style={{ color: t.ink }}><span style={{ color: t.muted }}>{`${day(cm.at)}: `}</span>{`“${cm.text}”`}</p>)}
      {children}
    </li>
  )
}

/** One reader's card, as the page view draws it: when it was sent, whether and how it was read, and their comments.
 *  `children` go under it (the owner panel's buttons). */
export function ReaderCard({ s, theme, children }: { s: Send; theme: ArtifactsTileTheme; children?: ReactNode }) {
  return <SendCard c={{ t: theme, base: '' }} s={s} title={s.label} attr={{ 'data-reader': s.label }}>{children}</SendCard>
}

function PageList({ c, pages, sends }: { c: Ctx; pages: HubPage[]; sends: readonly Send[] }) {
  const { t } = c
  const withReaders = new Set(sends.map((s) => s.pageId))
  const sorted = [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  return (
    <section data-view="pages" className="mt-8 px-5" aria-label="Pages">
      <h2 className="text-xl" style={{ ...t.heading, color: t.ink }}>Pages</h2>
      <p className="text-xs" style={{ color: t.muted }}>{`Every page on this hub, ${pages.length === 1 ? '1 page' : `${pages.length} pages`}, last changed first`}</p>
      {sorted.length ? (
        <ul className="lg:grid lg:grid-cols-2 lg:gap-x-8">{sorted.map((p) => (
          <li key={p.id} data-hub-page={p.id} className="py-3" style={{ boxShadow: `inset 0 -1px 0 ${t.hairline}` }}>
            <p className="text-[15px]" style={{ color: t.ink }}>
              <a href={p.url} style={{ ...linkStyle(t), ...t.heading, overflowWrap: 'anywhere' }}>{p.title || p.id}</a>
            </p>
            <p className="mt-0.5 text-sm" style={{ color: t.muted }}>
              {[
                `changed ${day(p.updatedAt)}`, p.kind === 'broadcast' ? 'broadcast' : '',
                p.readerLinks ? `${p.readerLinks} reader link${p.readerLinks === 1 ? '' : 's'}` : 'no reader links',
                typeof p.views === 'number' && p.views ? `${p.views} view${p.views === 1 ? '' : 's'}` : '',
              ].filter(Boolean).join(' · ')}
              {withReaders.has(p.id) ? <>{' · '}<Link href={pageHref(c, p.id)} style={linkStyle(t)}>readers</Link></> : null}
            </p>
          </li>
        ))}</ul>
      ) : <p className="mt-3 text-sm" style={{ color: t.muted }}>Nothing is published here yet.</p>}
    </section>
  )
}

function Shell({ c, title, back, fetchedAt, backRow, children }: { c: Ctx; title: string; back: string; fetchedAt: string; backRow: (href: string) => ReactNode; children: ReactNode }) {
  const { t } = c
  return (
    <main data-wide className="flex-1 pb-16 lg:px-3">
      <header className="px-5 pt-2 pb-3">
        {backRow(back)}
        <h1 className="text-3xl" style={{ ...t.heading, color: t.ink }}>{title}</h1>
        <p className="mt-1 text-sm" style={{ color: t.muted }} data-fetched-at={fetchedAt}>
          {`Read from the hub ${new Date(fetchedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}
        </p>
      </header>
      {children}
    </main>
  )
}

/** The whole screen: the home (Activity or Outcomes), one page's readers (`p`), or one person's timeline (`who`). */
export function ArtifactsTile({ data, query: q, title, theme, back, notFound, basePath = '/artifacts', homeHref = '/', draftHref, pages }: ArtifactsTileProps) {
  const c: Ctx = { t: theme, base: basePath }
  const t = theme
  const now = new Date(data.fetchedAt)

  if (q.p) {
    const page = readersOf(data.sends, q.p)
    if (!page) return notFound()
    return (
      <Shell c={c} title={page.title} back={basePath} fetchedAt={data.fetchedAt} backRow={back}>
        <p className="px-5 pb-4"><a href={page.url} className="text-sm underline" style={{ color: t.muted }}>Open the page on the hub</a></p>
        <ul className="grid gap-3 px-5 lg:grid-cols-3">{page.sends.map((s) => <SendCard key={s.rid} c={c} s={s} title={s.label} attr={{ 'data-reader': s.label }} />)}</ul>
      </Shell>
    )
  }
  if (q.who) {
    const person = timelineOf(data.sends, q.who)
    if (!person) return notFound()
    return (
      <Shell c={c} title={person.label} back={basePath} fetchedAt={data.fetchedAt} backRow={back}>
        <p className="px-5 pb-4 text-sm" style={{ color: t.muted }}>Everything sent to them, newest first, and what they did with it.</p>
        <ul className="grid gap-3 px-5 lg:grid-cols-2">{person.sends.map((s) => <SendCard key={`${s.pageId}-${s.rid}`} c={c} s={s} title={s.title} attr={{ 'data-timeline': s.pageId }} />)}</ul>
      </Shell>
    )
  }

  const f = parseFilters(q)
  const outcomes = q.view === 'outcomes'
  const onWaiting = q.tab === 'waiting'
  const tab = (on: boolean) => ({ backgroundColor: on ? t.primary : t.card, color: on ? t.onPrimary : t.ink, boxShadow: `inset 0 0 0 1px ${on ? t.primary : t.hairline}` })
  const waitingCount = waitingOn(data.sends, f, Infinity).items.length
  return (
    <Shell c={c} title={title} back={homeHref} fetchedAt={data.fetchedAt} backRow={back}>
      <Counts c={c} data={data} now={now} />
      <nav data-view-switch className="flex gap-2 px-5 pb-3 text-sm" aria-label="View">
        <Link href={href(c, { ...q, view: undefined }, { tab: null, stage: null, n: null })} aria-current={!outcomes ? 'page' : undefined} className="rounded-full px-3 py-1.5" style={tab(!outcomes)}>Activity</Link>
        <Link href={href(c, { ...q, view: 'outcomes' }, { tab: null, n: null })} aria-current={outcomes ? 'page' : undefined} className="rounded-full px-3 py-1.5" style={tab(outcomes)}>Outcomes</Link>
      </nav>
      {!outcomes && <nav data-tabs className="flex gap-2 px-5 pb-3 text-sm lg:hidden" aria-label="Views">
        <Link href={href(c, q, { tab: null })} aria-current={!onWaiting ? 'page' : undefined} className="rounded-full px-3 py-1.5" style={tab(!onWaiting)}>Activity</Link>
        <Link href={href(c, q, { tab: 'waiting' })} aria-current={onWaiting ? 'page' : undefined} className="rounded-full px-3 py-1.5" style={tab(onWaiting)}>{`Waiting on${waitingCount ? ` (${waitingCount})` : ''}`}</Link>
      </nav>}
      <details className="mx-5 mb-3 rounded-2xl px-4 py-2 lg:hidden" style={card(t)} open={FILTER_KEYS.some((k) => q[k]) || undefined}>
        <summary className="text-sm" style={{ color: t.ink }}>Search and filters</summary>
        <div className="pb-2"><FilterForm c={c} data={data} q={q} /></div>
      </details>
      <div data-columns className={`px-5 lg:grid lg:items-start lg:gap-8 ${outcomes ? 'lg:grid-cols-[13rem_minmax(0,1fr)]' : 'lg:grid-cols-[15rem_minmax(0,1fr)_20rem]'}`}>
        <aside data-view="filters" className="hidden lg:block" aria-label="Search and filters">
          <h2 className="text-xl" style={{ ...t.heading, color: t.ink }}>Filters</h2>
          <FilterForm c={c} data={data} q={q} />
        </aside>
        {outcomes ? <Board c={c} data={data} f={f} q={q} now={now} draftHref={draftHref} /> : (
          <>
            <Feed c={c} data={data} f={f} q={q} now={now} className={onWaiting ? 'hidden lg:block' : ''} />
            <Waiting c={c} data={data} f={f} q={q} now={now} className={onWaiting ? '' : 'hidden lg:block'} />
          </>
        )}
      </div>
      {pages ? <PageList c={c} pages={pages} sends={data.sends} /> : null}
    </Shell>
  )
}

export type { Send, Sends, FeedEvent, Filters } from '../analytics/index.js'
