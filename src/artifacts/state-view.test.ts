import { describe, it, expect } from 'vitest'
import { stateView, responsesOf, responsesCsv } from './state-view.js'
import type { StateEntry } from './state-store.js'

const e = (o: Partial<StateEntry>): StateEntry => ({
  id: 'x', artifactId: 'p', slot: 'vote', shape: 'one', readerKey: 'u:1',
  writer: { uid: '1', email: 'sam@example.com', name: 'Sam Rivera', anonymous: false }, value: 'a', at: '2026-09-24T10:00:00Z', ...o,
})
const state = { writers: 'anyone' as const, visibility: 'private' as const, slots: {
  vote: { shape: 'one' as const, visibility: 'tally' as const },
  notes: { shape: 'many' as const, visibility: 'shared' as const },
  form: { shape: 'one' as const },
} }
const entries = [
  e({ id: 'v1' }),
  e({ id: 'v2', readerKey: 'a:zz', writer: { name: null, anonymous: true }, value: 'a' }),
  e({ id: 'v3', readerKey: 'u:2', writer: { uid: '2', email: 'lee@example.com', name: 'Lee Park', anonymous: false }, value: ['a', 'b'] }),
  e({ id: 'n1', slot: 'notes', shape: 'many', value: 'first', at: '2026-09-24T10:01:00Z' }),
  e({ id: 'n2', slot: 'notes', shape: 'many', readerKey: 'a:zz', writer: { name: null, anonymous: true }, value: 'anon note', at: '2026-09-24T10:02:00Z' }),
  e({ id: 'f2', slot: 'form', readerKey: 'u:2', writer: { uid: '2', email: 'lee@example.com', name: 'Lee Park', anonymous: false }, value: { rsvp: true } }),
]

describe('stateView', () => {
  it('shows my values, tallies split by verified, and shared entries without emails', () => {
    const v = stateView(state, entries, 'u:1')
    expect(v.vote.mine).toBe('a')
    expect(v.vote.tally).toEqual({ signedIn: { a: 2, b: 1 }, anonymous: { a: 1 } })
    expect(v.notes.mine).toEqual([{ id: 'n1', value: 'first', at: '2026-09-24T10:01:00Z' }])
    expect(v.notes.shared).toEqual([
      { id: 'n1', name: 'Sam', value: 'first', at: '2026-09-24T10:01:00Z', mine: true },
      { id: 'n2', name: 'a reader', value: 'anon note', at: '2026-09-24T10:02:00Z', mine: false },
    ])
    expect(v.form).toEqual({ shape: 'one', visibility: 'private', mine: null })
    expect(JSON.stringify(v)).not.toContain('@example.com')
  })
  it('a reader with no key sees nothing of their own', () => {
    const v = stateView(state, entries, null)
    expect(v.vote.mine).toBeNull()
    expect(v.notes.mine).toEqual([])
  })
  it('ignores entries for slots the page no longer declares', () => {
    const v = stateView({ ...state, slots: { form: state.slots.form } }, entries, 'u:2')
    expect(Object.keys(v)).toEqual(['form'])
  })
})

describe('responses', () => {
  it('lists everything with who, and writes CSV with JSON values', () => {
    const rows = responsesOf(entries.slice(0, 2))
    expect(rows[0]).toEqual({ slot: 'vote', id: 'v1', value: 'a', at: '2026-09-24T10:00:00Z', email: 'sam@example.com', name: 'Sam Rivera', anonymous: false })
    expect(rows[1]).toMatchObject({ email: null, anonymous: true })
    expect(responsesCsv(rows).split('\n')).toEqual([
      'slot,id,at,email,name,anonymous,value',
      'vote,v1,2026-09-24T10:00:00Z,sam@example.com,Sam Rivera,false,"""a"""',
      'vote,v2,2026-09-24T10:00:00Z,,,true,"""a"""',
    ])
  })
})
