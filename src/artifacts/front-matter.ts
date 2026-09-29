// The artifact contract: markdown plus a small front matter.
// Documented in README, "Front matter".
import matter from 'gray-matter'
import { ACCESS_LEVELS, type Access } from './reader.js'
import { parseStateConfig, type StateConfig } from './state.js'
import { mergeWidgetState, scanWidgets } from './widgets.js'
import { COMMENTS_MODES, mergeCommentsState, type CommentsMode, type CommentsVisible } from './comments.js'
import { THEME_MODES, type ThemeMode } from '../brand/theme.js'
import { parseDefinitions, type Definition } from './definitions.js'

export type ArtifactMeta = {
  title: string
  summary: string
  template: 'document'
  /** A line under the title. Title, subtitle and summary are three separate fields; the summary
   *  is the teaser, and the unfurl carries the title and the summary. */
  subtitle?: string
  /** Who the page is for ("For <name>" in the kicker, the unfurl title and the share card). A
   *  label, not an access control: a republish without it removes it. Never spoken. Distinct from
   *  `audience`, which is stored and never shown. */
  to?: string
  audience?: string
  cover?: string
  id?: string
  /** Narrator to generate with (a voice id the host's publisher knows). The publisher acts on it; the API stores it. */
  voice?: string
  /** Bucket URLs written by the publisher after narration; absent means no player. */
  narration?: string
  timings?: string
  /** Hash of the narrated text, so a changed body is re-narrated and an unchanged one is not. */
  narrationHash?: string
  /** Shut the page behind this until `?key=<password>` or the cookie it sets. Never rendered. */
  password?: string
  /** Who may read it, checked against a signed-in reader: `invite` is the host-side allowlist
   *  only; `freedom` is any active Freedom account plus that list; `public` opens it again.
   *  ABSENT CHANGES NOTHING: the level is host-side state, so a republish that omits the line
   *  (or a publisher that strips unknown keys) can never reopen a confidential page. */
  access?: Access | 'public'
  /** What readers may put into the page. Content, like the body: a republish without it removes
   *  the slots from the page and KEEPS the answers already given. */
  state?: StateConfig
  /** Light, dark, or the reader's device, overriding the brand pack's mode for this page. */
  theme?: ThemeMode
  /** The table of contents: absent draws it once the page has four sections, false never. */
  toc?: boolean
  /** Terms this page defines inline: the first occurrence of each is underlined and opens its
   *  definition. Content, like the body: a republish without it removes them. */
  definitions?: Definition[]
  /** One line saying what changed in this version. Stored with the version it arrives on; a line
   *  left in the file from the previous publish is recognised and not repeated. */
  change?: string
  /** Who may leave SHARED comments: `off` (the default; readers still keep personal notes),
   *  `anyone`, or `signed-in`. Forced to signed-in on a gated page. Not an access control, so a
   *  republish without the line goes back to off. */
  comments?: CommentsMode
  /** Who sees shared comments: `owner` (the default) or every reader (`readers`). */
  commentsVisible?: CommentsVisible
}

/** The longest `to:` a page may carry: a name or two, never a sentence. */
export const MAX_TO_CHARS = 60

const KNOWN = new Set(['title', 'summary', 'subtitle', 'to', 'template', 'audience', 'cover', 'id', 'voice', 'narration', 'timings', 'narrationHash', 'password', 'access', 'state', 'theme', 'toc', 'definitions', 'change', 'comments', 'comments_visible'])

export function parseArtifactSource(
  text: string,
): { ok: true; meta: ArtifactMeta; body: string } | { ok: false; error: string } {
  const { data, content } = matter(text)
  const d = data as Record<string, unknown>
  for (const k of Object.keys(d)) {
    if (!KNOWN.has(k)) return { ok: false, error: `front matter has an unknown key: ${k}` }
  }
  for (const k of ['title', 'summary'] as const) {
    const v = d[k]
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `front matter is missing ${k}` }
  }
  const template = d.template ?? 'document'
  if (template !== 'document') return { ok: false, error: 'template must be document' }
  const meta: ArtifactMeta = {
    title: String(d.title).trim(),
    summary: String(d.summary).trim(),
    template: 'document',
  }
  for (const k of ['subtitle', 'audience', 'cover', 'id', 'voice', 'narration', 'timings', 'narrationHash', 'password'] as const) {
    const v = d[k]
    if (typeof v === 'string' && v) meta[k] = v
  }
  if (d.to !== undefined && d.to !== null) {
    const to = typeof d.to === 'string' ? d.to.trim() : ''
    if (!to || to.length > MAX_TO_CHARS || /[\r\n]/.test(to)) return { ok: false, error: `to must be one line naming who the page is for, 1 to ${MAX_TO_CHARS} characters` }
    meta.to = to
  }
  if (d.change !== undefined && d.change !== null) {
    if (typeof d.change !== 'string') return { ok: false, error: 'change must be one line of text' }
    if (d.change.trim()) meta.change = d.change.replace(/\s+/g, ' ').trim()
  }
  if (d.access !== undefined) {
    if (d.access !== 'public' && !ACCESS_LEVELS.includes(d.access as Access))
      return { ok: false, error: `access must be one of: public, ${ACCESS_LEVELS.join(', ')}` }
    meta.access = d.access as Access | 'public'
  }
  if (d.theme !== undefined) {
    if (!THEME_MODES.includes(d.theme as ThemeMode)) return { ok: false, error: `theme must be one of: ${THEME_MODES.join(', ')}` }
    meta.theme = d.theme as ThemeMode
  }
  if (d.toc !== undefined) {
    if (typeof d.toc !== 'boolean') return { ok: false, error: 'toc must be true or false' }
    meta.toc = d.toc
  }
  if (d.definitions !== undefined) {
    const r = parseDefinitions(d.definitions)
    if (!r.ok) return { ok: false, error: r.error }
    if (r.definitions.length) meta.definitions = r.definitions
  }
  if (d.state !== undefined) {
    const s = parseStateConfig(d.state)
    if (!s.ok) return { ok: false, error: s.error }
    meta.state = s.state
  }
  if (d.comments !== undefined && d.comments !== null) {
    // A bare `off` is a string in YAML 1.2, but `false` is a boolean and means the same thing.
    const c = d.comments === false ? 'off' : d.comments
    if (!COMMENTS_MODES.includes(c as CommentsMode)) return { ok: false, error: `comments must be one of: ${COMMENTS_MODES.join(', ')}` }
    meta.comments = c as CommentsMode
  }
  if (d.comments_visible !== undefined && d.comments_visible !== null) {
    if (d.comments_visible !== 'owner' && d.comments_visible !== 'readers') return { ok: false, error: 'comments_visible must be owner or readers' }
    meta.commentsVisible = d.comments_visible
  }
  // Widgets declare their own slots, so a notes block is merged into state: here, before the
  // page is stored, and the state API and the republish shape checks see it like any slot.
  // Errors name the line in the FILE: the body's lines are counted after the front matter's.
  const offset = text.endsWith(content) ? (text.slice(0, text.length - content.length).match(/\n/g) ?? []).length : 0
  const w = scanWidgets(content, offset)
  if (!w.ok) return { ok: false, error: w.error }
  const merged = mergeWidgetState(meta.state, w.notes)
  if (!merged.ok) return { ok: false, error: merged.error }
  const withComments = mergeCommentsState(merged.state, meta.comments, meta.commentsVisible)
  if (!withComments.ok) return { ok: false, error: withComments.error }
  if (withComments.state) meta.state = withComments.state
  return { ok: true, meta, body: content }
}
