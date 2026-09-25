// The Firestore implementation has no emulator test here; it is proven live in Task 8.
// This file carries the contract against the memory implementation, which both share.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryStateStore, readerKeyFor, type StateStore, type Writer } from './state-store.js'
import { MAX_MANY_PER_READER } from './state.js'

const sam: Writer = { key: readerKeyFor.signedIn('u1'), uid: 'u1', email: 'sam@example.com', name: 'Sam Rivera', anonymous: false }
const anon: Writer = { key: readerKeyFor.anonymous('abcdefghijklmnopqrstuvwx'), name: null, anonymous: true }
let s: StateStore
beforeEach(() => { s = createMemoryStateStore() })

describe('the state store contract', () => {
  it('one: a second set replaces the first', async () => {
    await s.set({ artifactId: 'p', slot: 'vote', writer: sam, value: 'a' })
    await s.set({ artifactId: 'p', slot: 'vote', writer: sam, value: 'b' })
    const e = await s.entries('p')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ slot: 'vote', shape: 'one', readerKey: sam.key, value: 'b', writer: { email: 'sam@example.com', anonymous: false } })
  })
  it('many: appends, and refuses past the per-reader cap', async () => {
    for (let i = 0; i < MAX_MANY_PER_READER; i++) await s.append({ artifactId: 'p', slot: 'notes', writer: sam, value: i })
    expect(await s.append({ artifactId: 'p', slot: 'notes', writer: sam, value: 'x' })).toEqual({ full: true })
    expect(await s.append({ artifactId: 'p', slot: 'notes', writer: anon, value: 'x' })).toMatchObject({ value: 'x' })
  })
  it('remove: one entry of mine, never someone else\'s', async () => {
    const mine = await s.append({ artifactId: 'p', slot: 'notes', writer: sam, value: 1 })
    const theirs = await s.append({ artifactId: 'p', slot: 'notes', writer: anon, value: 2 })
    if ('full' in mine || 'full' in theirs) throw new Error('unexpected')
    expect(await s.remove({ artifactId: 'p', slot: 'notes', readerKey: sam.key, entryId: theirs.id })).toBe(0)
    expect(await s.remove({ artifactId: 'p', slot: 'notes', readerKey: sam.key, entryId: mine.id })).toBe(1)
    expect((await s.entries('p')).map((e) => e.value)).toEqual([2])
  })
  it('moveReader: anonymous answers move to the signed-in reader across every page; an existing signed-in one wins', async () => {
    await s.set({ artifactId: 'p', slot: 'vote', writer: anon, value: 'anon' })
    await s.set({ artifactId: 'p', slot: 'form', writer: anon, value: { a: 1 } })
    await s.set({ artifactId: 'p', slot: 'vote', writer: sam, value: 'sam' })
    await s.append({ artifactId: 'p', slot: 'notes', writer: anon, value: 'n' })
    await s.set({ artifactId: 'q', slot: 'vote', writer: anon, value: 'q-anon' })
    expect(await s.moveReader(anon.key, sam)).toBe(3)
    const p = await s.entries('p')
    expect(p.every((x) => x.readerKey === sam.key)).toBe(true)
    expect(p.find((x) => x.slot === 'vote')?.value).toBe('sam')
    expect(p.find((x) => x.slot === 'form')?.value).toEqual({ a: 1 })
    expect(p.find((x) => x.slot === 'notes')?.writer.email).toBe('sam@example.com')
    const q = await s.entries('q')
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ readerKey: sam.key, value: 'q-anon' })
  })
  it('removeReader and countAnonWrite', async () => {
    await s.set({ artifactId: 'p', slot: 'vote', writer: sam, value: 'a' })
    await s.append({ artifactId: 'p', slot: 'notes', writer: sam, value: 'n' })
    expect(await s.removeReader('p', sam.key)).toBe(2)
    expect(await s.countAnonWrite('p', 'h', 100)).toBe(1)
    expect(await s.countAnonWrite('p', 'h', 100)).toBe(2)
    expect(await s.countAnonWrite('p', 'h', 101)).toBe(1)
  })
  it('entries are per page', async () => {
    await s.set({ artifactId: 'p', slot: 'vote', writer: sam, value: 'a' })
    expect(await s.entries('q')).toEqual([])
  })
})
