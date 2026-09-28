import { describe, it, expect } from 'vitest'
import { COMMENTS_SLOT, mergeCommentsState } from './comments.js'
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
