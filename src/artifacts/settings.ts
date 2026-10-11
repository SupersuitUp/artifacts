// A page's share and comment settings, changed two ways: by its file on publish, and by its owner
// or an admin from the page menu (0.31.0). Settings changed on the page WIN. A publish changes one
// only when the file names a value that differs from what the file named the time before, which
// the record keeps as `declared`. That is how `access:` already behaved for a line the file drops
// (absent leaves it alone); this extends the same idea to a line the file still carries, and to
// the password and the comment settings, so an admin's change is never quietly undone by the
// next republish of an unchanged file.
//
// Pure and server-only (node:crypto). The Firestore store applies what this decides.
import { createHash, randomInt } from 'node:crypto'
import type { Access } from './reader.js'
import type { StateConfig } from './state.js'
import { COMMENTS_SLOT, mergeCommentsState, type CommentsMode, type CommentsVisible } from './comments.js'

/** What the FILE said at its last publish, one entry per setting; null means it said nothing.
 *  The password is kept as a hash, never a second copy of the key. */
export type DeclaredSettings = {
  access: Access | 'public' | null
  password: string | null
  comments: CommentsMode | null
  commentsVisible: CommentsVisible | null
}

/** The settings as they apply to the page; undefined is absent (public, no password, comments off, owner). */
export type LiveSettings = {
  access?: Access
  password?: string
  comments?: CommentsMode
  commentsVisible?: CommentsVisible
  state?: StateConfig
}

export const passwordDigest = (p: string | undefined) => (p ? createHash('sha256').update(`declared\n${p}`).digest('hex') : null)

/** What a file declares, as the record keeps it. */
export function declaredOf(meta: { access?: Access | 'public'; password?: string; comments?: CommentsMode; commentsVisible?: CommentsVisible }): DeclaredSettings {
  return { access: meta.access ?? null, password: passwordDigest(meta.password), comments: meta.comments ?? null, commentsVisible: meta.commentsVisible ?? null }
}

/** The page's state with the comments slot set for `mode` and `visible`: removed when off, put
 *  back (or changed) when on. A state left with no slots at all is no state. Null when the page
 *  declares a slot of its own named `comments`, which comments cannot share. */
export function withComments(state: StateConfig | undefined, mode: CommentsMode | undefined, visible: CommentsVisible | undefined, ownSlot = false): StateConfig | undefined | null {
  let base = state
  if (base && !ownSlot && Object.hasOwn(base.slots, COMMENTS_SLOT)) {
    const { [COMMENTS_SLOT]: _gone, ...rest } = base.slots
    base = Object.keys(rest).length ? { ...base, slots: rest } : undefined
  }
  const merged = mergeCommentsState(base, mode, visible)
  return merged.ok ? merged.state : null
}

/** The settings a publish leaves on the page. `existing` is the record before it (null on the
 *  first publish); a record with no `declared` predates 0.31.0 and takes the file as it always did. */
export function settleOnPublish(
  existing: (LiveSettings & { declared?: DeclaredSettings }) | null,
  meta: { access?: Access | 'public'; password?: string; comments?: CommentsMode; commentsVisible?: CommentsVisible; state?: StateConfig },
): LiveSettings & { declared: DeclaredSettings } {
  const declared = declaredOf(meta)
  const fileAccess = meta.access === 'public' ? undefined : meta.access
  if (!existing) {
    return { access: fileAccess, password: meta.password, comments: meta.comments, commentsVisible: meta.commentsVisible, state: meta.state, declared }
  }
  const d = existing.declared
  // The file's value stands only where it changed since the last publish; else the page's stands.
  const kept = <K extends keyof DeclaredSettings>(k: K) => !!d && d[k] === declared[k]
  // Access: a file that names none never touches it (sticky since 0.13), with or without `declared`.
  const access = meta.access === undefined || kept('access') ? existing.access : fileAccess
  const password = kept('password') ? existing.password : meta.password
  const comments = kept('comments') ? existing.comments : meta.comments
  const commentsVisible = kept('commentsVisible') ? existing.commentsVisible : meta.commentsVisible
  if (comments === meta.comments && commentsVisible === meta.commentsVisible) {
    return { access, password, comments, commentsVisible, state: meta.state, declared }
  }
  // The page's comment settings outlive the file's: rebuild the slot from them. The file's
  // comments slot (when `comments:` put one there) is replaced; a slot the page itself declares
  // under that name is never touched, and then comments stay as the file has them.
  const fileMadeSlot = !!meta.comments && meta.comments !== 'off'
  const state = withComments(meta.state, comments, commentsVisible, !fileMadeSlot && !!meta.state && Object.hasOwn(meta.state.slots, COMMENTS_SLOT))
  if (state === null) return { access, password, comments: meta.comments, commentsVisible: meta.commentsVisible, state: meta.state, declared }
  return { access, password, comments, commentsVisible, state, declared }
}

/** What an owner or admin may change from the page. Absent leaves a setting as it is. */
export type SettingsPatch = {
  access?: Access | 'public'
  /** A key to set, or null to take the password off. */
  password?: string | null
  comments?: CommentsMode
  commentsVisible?: CommentsVisible
}

/** The live settings after a patch, or an error a person can read. */
export function applySettingsPatch(existing: LiveSettings, patch: SettingsPatch): { ok: true; live: LiveSettings } | { ok: false; error: string } {
  const live: LiveSettings = { ...existing }
  if (patch.access !== undefined) live.access = patch.access === 'public' ? undefined : patch.access
  if (patch.password !== undefined) live.password = patch.password ?? undefined
  if (patch.comments !== undefined || patch.commentsVisible !== undefined) {
    const mode = patch.comments ?? existing.comments
    const visible = patch.commentsVisible ?? existing.commentsVisible
    const on = !!existing.comments && existing.comments !== 'off'
    const ownSlot = !on && !!existing.state && Object.hasOwn(existing.state.slots, COMMENTS_SLOT)
    const state = withComments(existing.state, mode, visible, ownSlot)
    if (state === null) return { ok: false, error: `this page declares its own slot named "${COMMENTS_SLOT}", so shared comments cannot be turned on from the page` }
    live.comments = mode === 'off' ? undefined : mode
    live.commentsVisible = visible
    live.state = state
  }
  return { ok: true, live }
}

// No 0/o, 1/l/i, like page ids: a key read aloud or retyped from a screenshot must survive it.
const KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
/** A fresh key for a password turned on from the page. 12 characters, about 59 bits. */
export function newPageKey(): string {
  let s = ''
  for (let i = 0; i < 12; i++) s += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]
  return s
}
