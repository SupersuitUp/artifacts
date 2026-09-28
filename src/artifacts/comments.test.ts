import { describe, it, expect } from 'vitest'
import { COMMENTS_SLOT, MAX_COMMENT_CHARS, mergeCommentsState, validateComment, type CommentValue } from './comments.js'
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
