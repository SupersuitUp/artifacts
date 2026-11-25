// The recorder's batches (0.74.0): one per batch of people to record a voice eCard for, one entry
// per person with the take's stored paths, its timings and whether it was built.
import { describe, it, expect } from 'vitest'
import { memoryRecordStore, parseBatchInput, firstWaiting, entriesOf, RECORD_BATCH_ID } from './record-store.js'

const PEOPLE = [
  { slug: 'robin', name: 'Robin', note: 'Thank Robin for the year.' },
  { slug: 'dana-lee', name: 'Dana Lee', photo: 'https://cdn.example.com/dana.jpg', note: 'The move, and the dinners.' },
  { slug: 'sam', name: 'Sam', note: 'Short and warm.' },
]

describe('a batch, as the API takes it', () => {
  it('takes a title, a music bed and the people, in order', () => {
    const r = parseBatchInput({ title: 'Thanksgiving 2026', music: 'https://cdn.example.com/bed.mp3', people: PEOPLE })
    expect(r).toEqual({ ok: true, value: { title: 'Thanksgiving 2026', music: 'https://cdn.example.com/bed.mp3', people: PEOPLE } })
  })
  const refusals: [unknown, string][] = [
    [{ people: [] }, 'people'],
    [{ people: [{ slug: 'Robin!', name: 'R', note: 'x' }] }, 'slug'],
    [{ people: [PEOPLE[0], PEOPLE[0]] }, 'twice'],
    [{ people: [{ slug: 'robin', name: '', note: 'x' }] }, 'name'],
    [{ people: [{ slug: 'robin', name: 'Robin', note: 'x', photo: 'http://x.example.com/a.jpg' }] }, 'photo'],
    [{ music: 'ftp://x', people: PEOPLE }, 'music'],
    [{ people: Array.from({ length: 201 }, (_, i) => ({ slug: `p${i}`, name: 'P', note: 'n' })) }, '200'],
  ]
  for (const [body, why] of refusals) {
    it(`refuses in words: ${why}`, () => {
      const r = parseBatchInput(body)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain(why)
    })
  }
})

describe('a batch\'s music (0.75.0)', () => {
  it('takes a catalog track id as well as an https address', () => {
    const r = parseBatchInput({ title: 'Christmas', music: 'silent-night', people: PEOPLE })
    expect(r.ok && r.value.music).toBe('silent-night')
  })
  it('refuses an id the catalog does not hold', () => {
    const r = parseBatchInput({ title: 'Christmas', music: 'silent-nite', people: PEOPLE })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('music')
  })
})

describe('the store', () => {
  it('creates a batch with every person waiting, in the order given', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    expect(b.id).toMatch(RECORD_BATCH_ID)
    expect(entriesOf(b).map((e) => [e.slug, e.status])).toEqual([['robin', 'waiting'], ['dana-lee', 'waiting'], ['sam', 'waiting']])
    expect(await s.get(b.id)).toEqual(b)
    expect(await s.get('nope0000ab')).toBeNull()
  })
  it('keeps a take: the raw file makes the person recorded, the mix rides beside it', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    await s.setTake(b.id, 'robin', { kind: 'raw', path: 'private:robin-raw.1a2b3c4d.webm', mime: 'audio/webm', seconds: 21.4 })
    const e = await s.setTake(b.id, 'robin', { kind: 'mixed', path: 'private:robin-mixed.5e6f7a8b.wav', mime: 'audio/wav', voiceDelay: 4 })
    expect(e).toMatchObject({ status: 'recorded', raw: 'private:robin-raw.1a2b3c4d.webm', mixed: 'private:robin-mixed.5e6f7a8b.wav', seconds: 21.4, voiceDelay: 4 })
    expect(await s.setTake(b.id, 'nobody', { kind: 'raw', path: 'private:x.webm' })).toBeNull()
  })
  it('a raw take with no length (Chrome webm) takes its length from the mix', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    await s.setTake(b.id, 'robin', { kind: 'raw', path: 'private:a.webm' })
    expect((await s.setTake(b.id, 'robin', { kind: 'mixed', path: 'private:m.wav', seconds: 9.7 }))!.seconds).toBe(9.7)
    // A raw take's own length wins, and a new raw take drops the old length.
    await s.setTake(b.id, 'sam', { kind: 'raw', path: 'private:s.webm', seconds: 5 })
    expect((await s.setTake(b.id, 'sam', { kind: 'mixed', path: 'private:sm.wav', seconds: 9 }))!.seconds).toBe(5)
    expect((await s.setTake(b.id, 'sam', { kind: 'raw', path: 'private:s2.webm' }))!.seconds).toBeUndefined()
  })
  it('a redo replaces the take and drops the timings and the build made from the old one', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    await s.setTake(b.id, 'robin', { kind: 'raw', path: 'private:a.webm' })
    await s.setTimings(b.id, 'robin', [{ w: 'Hi', s: 4, e: 4.3 }])
    await s.setBuilt(b.id, 'robin', 'card2345')
    expect((await s.get(b.id))!.entries.robin).toMatchObject({ status: 'built', pageId: 'card2345' })
    const e = await s.setTake(b.id, 'robin', { kind: 'raw', path: 'private:b.webm' })
    expect(e).toMatchObject({ status: 'recorded', raw: 'private:b.webm' })
    expect(e!.timings).toBeUndefined()
    expect(e!.pageId).toBeUndefined()
  })
  it('timings and the build need a take first', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    await expect(s.setTimings(b.id, 'robin', [{ w: 'Hi', s: 4, e: 4.3 }])).rejects.toThrow('no take')
    await expect(s.setBuilt(b.id, 'robin', 'card2345')).rejects.toThrow('no take')
  })
})

describe('the resume rule', () => {
  it('opens at the first person with no take; past the last when everyone has one', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    expect(firstWaiting((await s.get(b.id))!)).toBe(0)
    await s.setTake(b.id, 'robin', { kind: 'raw', path: 'private:a.webm' })
    expect(firstWaiting((await s.get(b.id))!)).toBe(1)
    // A later person already done does not move the start past an earlier one still waiting.
    await s.setTake(b.id, 'sam', { kind: 'raw', path: 'private:c.webm' })
    expect(firstWaiting((await s.get(b.id))!)).toBe(1)
    await s.setTake(b.id, 'dana-lee', { kind: 'raw', path: 'private:b.webm' })
    expect(firstWaiting((await s.get(b.id))!)).toBe(3)
  })
  it('a mix alone is not a take: the raw recording is what was said', async () => {
    const s = memoryRecordStore()
    const b = await s.create({ title: 'T', people: PEOPLE })
    await s.setTake(b.id, 'robin', { kind: 'mixed', path: 'private:m.wav' })
    expect(firstWaiting((await s.get(b.id))!)).toBe(0)
  })
})
