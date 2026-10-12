import { describe, it, expect } from 'vitest'
import { COMMENTS_SLOT, MAX_COMMENT_CHARS, MAX_RESOLVE_NOTE_CHARS, cleanResolveNote, mergeCommentsState, resolutionOf, validateComment, type CommentValue } from './comments.js'
import { effectiveWriters } from './state.js'

describe('mergeCommentsState', () => {
  it('comments: off (or absent) adds no slot, so a shared-comment write is refused as an undeclared slot', () => {
    expect(mergeCommentsState(undefined, undefined, undefined)).toEqual({ ok: true, state: undefined })
    expect(mergeCommentsState(undefined, 'off', 'readers')).toEqual({ ok: true, state: undefined })
  })
  it('comments: anyone creates state with a many slot that anyone may write, private to the owner by default', () => {
    const r = mergeCommentsState(undefined, 'anyone', undefined)
    expect(r).toEqual({ ok: true, state: { writers: 'signed-in', visibility: 'private', slots: { [COMMENTS_SLOT]: { shape: 'many', visibility: 'private', writers: 'anyone' } } } })
  })
  it('comments_visible: readers makes the thread shared with every reader', () => {
    const r = mergeCommentsState(undefined, 'signed-in', 'readers')
    expect(r.ok && r.state?.slots.comments).toEqual({ shape: 'many', visibility: 'shared', writers: 'signed-in' })
  })
  it('merges beside a page\'s own state without touching its slots or its writers', () => {
    const own = { writers: 'anyone' as const, visibility: 'tally' as const, slots: { vote: { shape: 'one' as const } } }
    const r = mergeCommentsState(own, 'signed-in', 'owner')
    expect(r.ok && r.state).toEqual({ ...own, slots: { vote: { shape: 'one' }, comments: { shape: 'many', visibility: 'private', writers: 'signed-in' } } })
  })
  it('refuses a page whose state: already declares a slot named comments', () => {
    const own = { writers: 'anyone' as const, visibility: 'private' as const, slots: { comments: { shape: 'one' as const } } }
    const r = mergeCommentsState(own, 'anyone', undefined)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/rename/)
  })
})

describe('effectiveWriters for the comments slot', () => {
  const state = { writers: 'signed-in' as const, visibility: 'private' as const, slots: { comments: { shape: 'many' as const, writers: 'anyone' as const }, vote: { shape: 'one' as const } } }
  it('a slot that names its own writers uses them; every other slot uses the page\'s', () => {
    expect(effectiveWriters(state, undefined, 'comments')).toBe('anyone')
    expect(effectiveWriters(state, undefined, 'vote')).toBe('signed-in')
    expect(effectiveWriters(state)).toBe('signed-in')
  })
  it('a gated page forces signed-in, whatever comments: says', () => {
    expect(effectiveWriters(state, 'invite', 'comments')).toBe('signed-in')
  })
})

describe('validateComment', () => {
  const anchor = { kind: 'text', quote: 'the river', prefix: 'Every spring ', suffix: ' floods' }
  const top: CommentValue = { anchor: { kind: 'text', quote: 'the river', prefix: '', suffix: '' }, body: 'Which river?', version: 2 }
  const reply: CommentValue = { ...top, body: 'The north one.', parent: 'top1' }
  const existing = (id: string) => (id === 'top1' ? top : id === 'reply1' ? reply : null)

  it('takes an anchor, a body and the version it was left on', () => {
    expect(validateComment({ anchor, body: 'Nice.', version: 3 }, existing)).toEqual({ ok: true, value: { anchor, body: 'Nice.', version: 3 } })
  })
  it('keeps the voice fields a later version fills in', () => {
    const r = validateComment({ anchor, body: 'said aloud', version: 1, audio: 'comments/abc.webm', transcript: 'browser' }, existing)
    expect(r.ok && r.value.transcript).toBe('browser')
    expect(validateComment({ anchor, body: 'x', version: 1, transcript: 'guessed' }, existing).ok).toBe(false)
    expect(validateComment({ anchor, body: 'x', version: 1, audio: '../../secret' }, existing).ok).toBe(false)
  })
  it('refuses an empty body, one over the cap, a bad version, a bad anchor, and unknown keys', () => {
    expect(validateComment({ anchor, body: '  ', version: 1 }, existing).ok).toBe(false)
    expect(validateComment({ anchor, body: 'x'.repeat(MAX_COMMENT_CHARS + 1), version: 1 }, existing).ok).toBe(false)
    expect(validateComment({ anchor, body: 'x', version: 0 }, existing).ok).toBe(false)
    expect(validateComment({ anchor, body: 'x', version: 1.5 }, existing).ok).toBe(false)
    expect(validateComment({ anchor: { kind: 'text', quote: '' }, body: 'x', version: 1 }, existing).ok).toBe(false)
    expect(validateComment({ anchor, body: 'x', version: 1, name: 'spoof' }, existing).ok).toBe(false)
    expect(validateComment('x', existing).ok).toBe(false)
  })
  it('a reply names a top-level comment the writer can see; a reply to a reply is refused', () => {
    expect(validateComment({ anchor, body: 'agreed', version: 2, parent: 'top1' }, existing).ok).toBe(true)
    const deep = validateComment({ anchor, body: 'agreed', version: 2, parent: 'reply1' }, existing)
    expect(!deep.ok && deep.error).toMatch(/one level/)
    const missing = validateComment({ anchor, body: 'agreed', version: 2, parent: 'nope' }, existing)
    expect(!missing.ok && missing.error).toMatch(/no comment/)
  })
})

describe('a declared name on a comment', () => {
  const anchor = { kind: 'text', quote: 'a line', prefix: '', suffix: '' }
  const base = { anchor, body: 'This reads well.', version: 1 }
  const none = () => null
  it('keeps the name a reader typed, trimmed, so the owner can credit them', () => {
    const r = validateComment({ ...base, by: '  Ada Lovelace ' }, none)
    expect(r.ok && r.value.by).toBe('Ada Lovelace')
  })
  it('drops a blank name rather than storing it', () => {
    const r = validateComment({ ...base, by: '   ' }, none)
    expect(r.ok && 'by' in r.value).toBe(false)
  })
  it('refuses a name that is not a short single line', () => {
    expect(validateComment({ ...base, by: 'x'.repeat(81) }, none).ok).toBe(false)
    expect(validateComment({ ...base, by: 'Ada\nLovelace' }, none).ok).toBe(false)
    expect(validateComment({ ...base, by: 7 }, none).ok).toBe(false)
  })
})

describe('resolving (0.33.0)', () => {
  const anchor = { kind: 'text', quote: 'river', prefix: '', suffix: '' }
  it('a reader cannot write resolved into a comment: only the resolve route sets it', () => {
    const r = validateComment({ anchor, body: 'Done', version: 1, resolved: { at: '2026-10-12T00:00:00Z', by: 'Olive' } }, () => null)
    expect(r.ok).toBe(false)
  })
  it('a note is one line of at most MAX_RESOLVE_NOTE_CHARS, trimmed; blank or absent is no note', () => {
    expect(cleanResolveNote(undefined)).toEqual({ ok: true, note: null })
    expect(cleanResolveNote(null)).toEqual({ ok: true, note: null })
    expect(cleanResolveNote('  ')).toEqual({ ok: true, note: null })
    expect(cleanResolveNote('  Fixed it  ')).toEqual({ ok: true, note: 'Fixed it' })
    expect(cleanResolveNote('x'.repeat(MAX_RESOLVE_NOTE_CHARS)).ok).toBe(true)
    expect(cleanResolveNote('x'.repeat(MAX_RESOLVE_NOTE_CHARS + 1)).ok).toBe(false)
    expect(cleanResolveNote('one\ntwo').ok).toBe(false)
    expect(cleanResolveNote(5).ok).toBe(false)
  })
  it('resolutionOf reads a stored value and tolerates anything else', () => {
    expect(resolutionOf({ body: 'x', resolved: { at: 't', by: 'Olive', note: 'n' } })).toEqual({ at: 't', by: 'Olive', note: 'n' })
    expect(resolutionOf({ body: 'x', resolved: { at: 't', by: 'Olive' } })).toEqual({ at: 't', by: 'Olive' })
    for (const v of [null, undefined, 'x', { body: 'x' }, { resolved: true }, { resolved: { by: 'x' } }]) expect(resolutionOf(v)).toBeNull()
  })
})
