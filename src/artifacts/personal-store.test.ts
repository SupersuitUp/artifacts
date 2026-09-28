import { describe, it, expect } from 'vitest'
import { createMemoryPersonalStore, validatePersonal, MAX_PERSONAL_PER_READER } from './personal-store.js'

const value = { anchor: { kind: 'text' as const, quote: 'river', prefix: '', suffix: '' }, body: 'mine', version: 1 }

describe('the memory personal store', () => {
  it('keeps each reader\'s notes apart, per page', async () => {
    const s = createMemoryPersonalStore()
    await s.add('abc23456', 'u1', value)
    await s.add('abc23456', 'u2', { ...value, body: 'theirs' })
    await s.add('def23456', 'u1', { ...value, body: 'other page' })
    expect((await s.list('abc23456', 'u1')).map((n) => n.value.body)).toEqual(['mine'])
    expect((await s.list('abc23456', 'u2')).map((n) => n.value.body)).toEqual(['theirs'])
  })
  it('edits and deletes only the reader\'s own note', async () => {
    const s = createMemoryPersonalStore()
    const n = await s.add('abc23456', 'u1', value)
    if ('full' in n) throw new Error('unexpected')
    expect(await s.replace('abc23456', 'u2', n.id, { ...value, body: 'x' })).toBeNull()
    expect(await s.remove('abc23456', 'u2', n.id)).toBe(false)
    expect((await s.replace('abc23456', 'u1', n.id, { ...value, body: 'edited' }))?.value.body).toBe('edited')
    expect(await s.remove('abc23456', 'u1', n.id)).toBe(true)
    expect(await s.list('abc23456', 'u1')).toEqual([])
  })
  it(`caps a reader at ${MAX_PERSONAL_PER_READER} notes on one page`, async () => {
    const s = createMemoryPersonalStore()
    for (let i = 0; i < MAX_PERSONAL_PER_READER; i++) await s.add('abc23456', 'u1', value)
    expect(await s.add('abc23456', 'u1', value)).toEqual({ full: true })
    expect('full' in (await s.add('abc23456', 'u2', value))).toBe(false)
  })
})

describe('validatePersonal', () => {
  it('is a comment with no thread', () => {
    expect(validatePersonal(value)).toEqual({ ok: true, value })
    expect(validatePersonal({ ...value, parent: 'abc' }).ok).toBe(false)
    expect(validatePersonal({ ...value, body: '' }).ok).toBe(false)
  })
})
