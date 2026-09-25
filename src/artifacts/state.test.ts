import { describe, it, expect } from 'vitest'
import { parseStateConfig, effectiveWriters, slotVisibility, checkValue, shapeChanges, MAX_VALUE_BYTES } from './state.js'

describe('parseStateConfig', () => {
  it('fills the defaults', () => {
    const r = parseStateConfig({ slots: { progress: { shape: 'one' } } })
    expect(r).toEqual({ ok: true, state: { writers: 'signed-in', visibility: 'private', slots: { progress: { shape: 'one' } } } })
  })
  it('keeps a per-slot visibility and the page settings', () => {
    const r = parseStateConfig({ writers: 'anyone', visibility: 'tally', slots: { notes: { shape: 'many', visibility: 'shared' } } })
    expect(r.ok && r.state).toEqual({ writers: 'anyone', visibility: 'tally', slots: { notes: { shape: 'many', visibility: 'shared' } } })
  })
  it('accepts a page with no slots (widgets will declare theirs)', () => {
    expect(parseStateConfig({})).toEqual({ ok: true, state: { writers: 'signed-in', visibility: 'private', slots: {} } })
  })
  it.each([
    [{ writers: 'everyone' }, 'state.writers must be signed-in or anyone'],
    [{ visibility: 'public' }, 'state.visibility must be one of: private, tally, shared'],
    [{ slots: { 'Bad Name': { shape: 'one' } } }, 'slot name "Bad Name" must be lowercase letters, digits and dashes, starting with a letter'],
    [{ slots: { a: { shape: 'few' } } }, 'slot "a" needs shape one or many'],
    [{ slots: { a: { shape: 'one', visibility: 'loud' } } }, 'slot "a" visibility must be one of: private, tally, shared'],
    [{ slots: { a: { shape: 'one', extra: 1 } } }, 'slot "a" has an unknown key: extra'],
    [{ other: 1 }, 'state has an unknown key: other'],
    ['yes', 'state must be a map'],
  ])('refuses %j', (raw, error) => {
    expect(parseStateConfig(raw)).toEqual({ ok: false, error })
  })
})

describe('effectiveWriters and slotVisibility', () => {
  const state = { writers: 'anyone' as const, visibility: 'tally' as const, slots: { a: { shape: 'one' as const }, b: { shape: 'many' as const, visibility: 'shared' as const } } }
  it('a gated page is always signed-in', () => {
    expect(effectiveWriters(state)).toBe('anyone')
    expect(effectiveWriters(state, 'freedom')).toBe('signed-in')
    expect(effectiveWriters(state, 'invite')).toBe('signed-in')
  })
  it('a slot overrides the page visibility', () => {
    expect(slotVisibility(state, 'a')).toBe('tally')
    expect(slotVisibility(state, 'b')).toBe('shared')
  })
})

describe('checkValue', () => {
  it('accepts JSON values', () => {
    for (const v of ['x', 3, true, null, ['a', 'b'], { name: 'Sam', plus: [1, [2]] }]) expect(checkValue(v)).toBeNull()
  })
  it('refuses undefined, functions and non-finite numbers', () => {
    expect(checkValue(undefined)).toBe('value is required')
    expect(checkValue(Number.NaN)).toBe('value must be JSON')
    expect(checkValue({ f: () => 1 })).toBe('value must be JSON')
  })
  it('refuses a value over 8 KB', () => {
    expect(checkValue('x'.repeat(MAX_VALUE_BYTES))).toBe('value is over 8 KB')
  })
})

describe('shapeChanges', () => {
  it('names only slots whose shape changed', () => {
    const prev = { writers: 'signed-in' as const, visibility: 'private' as const, slots: { a: { shape: 'one' as const }, b: { shape: 'many' as const }, gone: { shape: 'one' as const } } }
    const next = { writers: 'signed-in' as const, visibility: 'private' as const, slots: { a: { shape: 'many' as const }, b: { shape: 'many' as const }, fresh: { shape: 'one' as const } } }
    expect(shapeChanges(prev, next)).toEqual(['slot "a" changed shape from one to many; rename the slot instead'])
    expect(shapeChanges(undefined, next)).toEqual([])
    expect(shapeChanges(prev, undefined)).toEqual([])
  })
})
