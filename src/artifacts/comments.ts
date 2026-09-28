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
