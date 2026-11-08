// What a send is for, and how far one reader got toward it (issue #12). A page declares one `goal`;
// each per-reader send then lands on one rung of OUTCOMES, computed under the before-send rule in
// summarizeViews, so a host can draw every send in the column where it landed.

/** `read` (the default): the reader spent OUTCOME_READ_SECONDS on the page. `respond`: the reader
 *  left a comment. `ack`: the reader pressed the page's ack CTA (a link titled "cta:ack").
 *  `{ click }`: the reader pressed the CTA with that id. */
export type ArtifactGoal = 'read' | 'respond' | 'ack' | { click: string }
export const GOAL_KINDS = ['read', 'respond', 'ack'] as const
export const DEFAULT_GOAL: ArtifactGoal = 'read'

/** A CTA id: lowercase letters, digits, dashes, underscores, up to 64. */
export const CTA_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** The CTA id `goal: ack` counts. */
export const ACK_CTA = 'ack'
/** A link title that marks the link as a CTA: `[Book a call](https://... "cta:book-call")`. */
export const CTA_TITLE = /^cta:\s*(.*)$/
/** Clicks kept per session; a page that sends more is not a reader pressing a button. */
export const MAX_CLICKS_PER_SESSION = 50

export type Outcome = 'not-opened' | 'opened' | 'read' | 'returned' | 'acted'
/** The rungs, lowest first. A send's outcome is the highest one it reached. */
export const OUTCOMES: readonly Outcome[] = ['not-opened', 'opened', 'read', 'returned', 'acted']
/** Active seconds that make an open a read. Thirty seconds is a skim of a short page, which is
 *  as much as a phone reader gives a sent link; a host with long pages passes its own. */
export const OUTCOME_READ_SECONDS = 30
/** A second open at least this long after the first is a return: an hour, the same line the
 *  summary's `cameBack` draws, so two tabs in one sitting are never a return. */
export const OUTCOME_RETURN_GAP_MS = 3_600_000
export type OutcomeThresholds = { readSeconds: number; returnGapMs: number }
export const OUTCOME_THRESHOLDS: Readonly<OutcomeThresholds> = Object.freeze({ readSeconds: OUTCOME_READ_SECONDS, returnGapMs: OUTCOME_RETURN_GAP_MS })

/** A host's own thresholds over the defaults; anything not a finite non-negative number is ignored. */
export function outcomeThresholds(over: Partial<OutcomeThresholds> = {}): OutcomeThresholds {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return { readSeconds: ok(over.readSeconds) ? over.readSeconds : OUTCOME_READ_SECONDS, returnGapMs: ok(over.returnGapMs) ? over.returnGapMs : OUTCOME_RETURN_GAP_MS }
}

const GOAL_ERROR = 'goal must be read, respond, ack, or { click: <cta id> }'

/** The front matter's `goal:` value, checked. Does not look at the body; parseArtifactSource does. */
export function parseGoal(v: unknown): { ok: true; goal: ArtifactGoal } | { ok: false; error: string } {
  if (typeof v === 'string') return (GOAL_KINDS as readonly string[]).includes(v) ? { ok: true, goal: v as ArtifactGoal } : { ok: false, error: GOAL_ERROR }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v)
    const cta = (v as { click?: unknown }).click
    if (keys.length === 1 && keys[0] === 'click' && typeof cta === 'string' && CTA_ID.test(cta)) return { ok: true, goal: { click: cta } }
  }
  return { ok: false, error: GOAL_ERROR }
}

/** The CTA id `goal` counts, or null for read and respond. */
export function goalCta(goal: ArtifactGoal): string | null {
  return goal === 'ack' ? ACK_CTA : typeof goal === 'object' ? goal.click : null
}

const LINK_TITLE = /\]\(\s*<?[^\s)>]*>?\s+(?:"([^"]*)"|'([^']*)')\s*\)/g

/** Every link title in a body that starts `cta:`, as written (the id may be malformed). */
function ctaTitles(markdown: string): string[] {
  const out: string[] = []
  for (const m of markdown.matchAll(LINK_TITLE)) {
    const t = CTA_TITLE.exec((m[1] ?? m[2] ?? '').trim())
    if (t) out.push(t[1].trim())
  }
  return out
}

/** The CTA ids a page carries, each once, in order. */
export function ctasIn(markdown: string): string[] {
  return [...new Set(ctaTitles(markdown).filter((id) => CTA_ID.test(id)))]
}

/** A body's CTAs and its goal, checked together: a CTA id that could never be recorded, and a goal
 *  whose CTA the page does not carry, are refused rather than shipped. */
export function checkGoalAgainstBody(goal: ArtifactGoal | undefined, markdown: string): string | null {
  const bad = ctaTitles(markdown).find((id) => !CTA_ID.test(id))
  if (bad !== undefined) return `a CTA id is lowercase letters, digits, dashes and underscores: "cta:${bad}" is not one`
  const cta = goal ? goalCta(goal) : null
  if (!cta || ctasIn(markdown).includes(cta)) return null
  return goal === 'ack' ? `goal: ack needs a link marked "cta:${ACK_CTA}" for the reader to press` : `goal names a CTA the page does not carry: ${cta} (mark a link with "cta:${cta}")`
}
