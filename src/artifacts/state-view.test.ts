import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { stateView, responsesOf, responsesCsv, type Response } from './state-view.js'
import type { StateEntry } from './state-store.js'

const opaque = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16)

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
  it('shared "one" entries carry an opaque id, never the raw reader-keyed id; "many" keeps its own', () => {
    const withPick = { ...state, slots: { ...state.slots, pick: { shape: 'one' as const, visibility: 'shared' as const } } }
    const picks = [
      e({ id: 'pageX__pick__u:1', slot: 'pick', value: 'red' }),
      e({ id: 'pageX__pick__a:zz', slot: 'pick', readerKey: 'a:zz', writer: { name: null, anonymous: true }, value: 'blue', at: '2026-09-24T10:00:01Z' }),
    ]
    const v = stateView(withPick, [...entries, ...picks], 'u:1')
    expect(v.pick.shared).toEqual([
      { id: opaque('pageX__pick__u:1'), name: 'Sam', value: 'red', at: '2026-09-24T10:00:00Z', mine: true },
      { id: opaque('pageX__pick__a:zz'), name: 'a reader', value: 'blue', at: '2026-09-24T10:00:01Z', mine: false },
    ])
    // The raw one-entry id is a credential (it embeds the reader key); it must never leak.
    expect(JSON.stringify(v)).not.toContain('pageX__pick')
    expect(JSON.stringify(v)).not.toContain('u:1')
    expect(JSON.stringify(v)).not.toContain('a:zz')
    // "many" entries carry their own (non-reader-keyed) id straight through.
    expect(v.notes.shared?.map((s) => s.id)).toEqual(['n1', 'n2'])
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
  it('escapes CSV formula injection in any cell', () => {
    const rows: Response[] = [
      { slot: 'notes', id: 'n1', value: -5, at: '2026-09-24T10:00:00Z', email: null, name: '=cmd|(calc)!A0', anonymous: true },
      { slot: 'notes', id: 'n2', value: '+1', at: '2026-09-24T10:00:00Z', email: '@evil.example', name: null, anonymous: false },
    ]
    const lines = responsesCsv(rows).split('\n')
    // name starting with "=": escaped
    expect(lines[1]).toContain(",'=cmd|(calc)!A0,")
    // value -5 -> JSON.stringify -> "-5", also starts with a dangerous char: escaped
    expect(lines[1].endsWith("'-5")).toBe(true)
    // email starting with "@": escaped
    expect(lines[2]).toContain(",'@evil.example,")
  })
})
