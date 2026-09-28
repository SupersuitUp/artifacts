// Comments: a reader pins a note to any part of a page (a quote, or a box drawn over a block).
//
// A SHARED comment lives on the state core as the `many` slot `comments`, declared by the page's
// `comments:` line rather than by `state:`, so caps, rate limits, sign-in migration, CSRF and the
// agreement gate on confidential pages all apply unchanged. Who may write is `comments:` (forced
// to signed-in on a gated page); who sees them is `comments_visible:` (the owner only, or every
// reader). A PERSONAL note never touches this slot: see personal-store.ts.
//
// Pure and server-safe, except the value types, which the reader's browser imports too.
import type { StateConfig, Writers } from './state.js'
import { parseAnchor, type Anchor } from './anchor.js'

export const COMMENTS_SLOT = 'comments'
export type CommentsMode = 'off' | Writers
export type CommentsVisible = 'owner' | 'readers'
export const COMMENTS_MODES: readonly CommentsMode[] = ['off', 'anyone', 'signed-in']

/** The page's `comments:` line becomes the `comments` slot, beside whatever `state:` declares,
 *  the way the notes block adds `notes`. Off (or absent) adds nothing, so the state API refuses a
 *  shared-comment write as it refuses any slot the page did not declare. */
export function mergeCommentsState(
  state: StateConfig | undefined, comments: CommentsMode | undefined, visible: CommentsVisible | undefined,
): { ok: true; state: StateConfig | undefined } | { ok: false; error: string } {
  if (!comments || comments === 'off') return { ok: true, state }
  if (state && Object.hasOwn(state.slots, COMMENTS_SLOT))
    return { ok: false, error: `comments: writes to slot "${COMMENTS_SLOT}", and state: declares a slot by that name; rename that slot` }
  const base: StateConfig = state ?? { writers: 'signed-in', visibility: 'private', slots: {} }
  const slot = { shape: 'many' as const, visibility: visible === 'readers' ? 'shared' as const : 'private' as const, writers: comments }
  return { ok: true, state: { ...base, slots: { ...base.slots, [COMMENTS_SLOT]: slot } } }
}

export const MAX_COMMENT_CHARS = 4000
export const COMMENT_TRANSCRIPTS = ['browser', 'host', 'typed'] as const
/** One shared comment or personal note. `parent` makes it a reply to a top-level comment (one
 *  level only). `audio` and `transcript` are filled by voice memos; a memo may have an empty body. */
export type CommentValue = {
  anchor: Anchor
  body: string
  version: number
  parent?: string
  audio?: string
  transcript?: (typeof COMMENT_TRANSCRIPTS)[number]
}

const ENTRY_ID = /^[A-Za-z0-9_-]{1,128}$/
// An uploaded asset path under the page (comments/<id>.webm), never a URL and never `..`.
const AUDIO_PATH = /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._/-]{0,299}$/
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The server's check on a comment, called by the state POST for the `comments` slot. `existing`
 *  returns a comment THIS WRITER can see by its entry id, so a reply can only name a thread its
 *  writer was shown. The browser checks too; this is the one that counts. */
export function validateComment(
  v: unknown, existing: (id: string) => CommentValue | null,
): { ok: true; value: CommentValue } | { ok: false; error: string } {
  if (!isMap(v) || Object.keys(v).some((k) => !['anchor', 'body', 'version', 'parent', 'audio', 'transcript'].includes(k)))
    return { ok: false, error: 'a comment is { anchor, body, version, parent? }' }
  const anchor = parseAnchor(v.anchor)
  if (!anchor) return { ok: false, error: 'a comment needs the place on the page it is pinned to' }
  if (v.audio !== undefined && (typeof v.audio !== 'string' || !AUDIO_PATH.test(v.audio))) return { ok: false, error: 'a comment\'s audio is the path it was uploaded to' }
  if (typeof v.body !== 'string' || (!v.body.trim() && v.audio === undefined)) return { ok: false, error: 'a comment needs some text' }
  if (v.body.length > MAX_COMMENT_CHARS) return { ok: false, error: `a comment is at most ${MAX_COMMENT_CHARS} characters` }
  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1 || v.version > 999999) return { ok: false, error: 'a comment needs the version it was left on' }
  if (v.transcript !== undefined && !COMMENT_TRANSCRIPTS.includes(v.transcript as CommentValue['transcript'] & string))
    return { ok: false, error: `a comment's transcript is one of: ${COMMENT_TRANSCRIPTS.join(', ')}` }
  const value: CommentValue = { anchor, body: v.body, version: v.version }
  if (v.parent !== undefined) {
    if (typeof v.parent !== 'string' || !ENTRY_ID.test(v.parent)) return { ok: false, error: 'a reply names the comment it answers' }
    const parent = existing(v.parent)
    if (!parent) return { ok: false, error: 'there is no comment here to reply to' }
    if (parent.parent) return { ok: false, error: 'replies are one level deep: reply to the comment, not to a reply' }
    value.parent = v.parent
  }
  if (v.audio !== undefined) value.audio = v.audio as string
  if (v.transcript !== undefined) value.transcript = v.transcript as CommentValue['transcript']
  return { ok: true, value }
}
