// Take tightening (0.75.0): the operator, 2026-11-25, "The voiceover optimization should happen
// locally to cut out long silences etc so I can just bang out dozens of voice notes easily." One
// pure core (block energy in, kept segments out) that both renderers and the timings read.
import { describe, it, expect } from 'vitest'
import { MIX, BLOCK_S, mixSettings, tightenSegments, remapTime, remapTimings, tightenSamples } from './mix.js'

/** Block levels from a plan: [seconds, level] runs, 10 ms blocks. */
const plan = (...runs: [number, number][]) => {
  const out: number[] = []
  for (const [s, lvl] of runs) for (let i = 0; i < Math.round(s / BLOCK_S); i++) out.push(lvl)
  return Float32Array.from(out)
}
const SPEECH = 0.2, ROOM = 0.002

describe('tightenSegments', () => {
  it('is on in the recipe, with its numbers', () => {
    expect(MIX).toMatchObject({ tighten: true, tightenLead: 0.25, tightenTail: 0.4, tightenPause: 0.9, tightenKeep: 0.6, tightenFadeMs: 10 })
    expect(mixSettings({ tighten: false }).tighten).toBe(false)
  })
  it('trims leading and trailing silence, keeping 0.25 s before the first word and 0.4 s after the last', () => {
    const r = tightenSegments(plan([2, ROOM], [3, SPEECH], [3, ROOM]))
    if ('silent' in r) throw new Error('silent')
    expect(r.segments).toEqual([{ start: 1.75, end: 5.4 }])
    expect(r.seconds).toBeCloseTo(3.65, 5)
    expect(r.rawSeconds).toBeCloseTo(8, 5)
  })
  it('shortens a pause longer than 0.9 s to 0.6 s, cutting only in the silence', () => {
    const r = tightenSegments(plan([1, SPEECH], [2.5, ROOM], [1, SPEECH]))
    if ('silent' in r) throw new Error('silent')
    expect(r.segments).toEqual([{ start: 0, end: 1.3 }, { start: 3.2, end: 4.5 }])
    expect(r.seconds).toBeCloseTo(2.6, 5)
  })
  it('leaves a short pause alone', () => {
    const r = tightenSegments(plan([1, SPEECH], [0.8, ROOM], [1, SPEECH]))
    if ('silent' in r) throw new Error('silent')
    expect(r.segments).toEqual([{ start: 0, end: 2.8 }])
  })
  it('reads silence against the take\'s own speech level, so a quiet speaker still has words', () => {
    const r = tightenSegments(plan([1, 0.0004], [1, 0.03], [1, 0.0004]))
    if ('silent' in r) throw new Error('silent')
    expect(r.segments).toEqual([{ start: 0.75, end: 2.4 }])
  })
  it('a take with no speech is the silent take', () => {
    expect(tightenSegments(plan([3, ROOM]))).toEqual({ silent: true })
    expect(tightenSegments(new Float32Array(0))).toEqual({ silent: true })
  })
  it('off, the whole take is one segment', () => {
    const r = tightenSegments(plan([2, ROOM], [1, SPEECH], [2, ROOM]), mixSettings({ tighten: false }))
    if ('silent' in r) throw new Error('silent')
    expect(r.segments).toEqual([{ start: 0, end: 5 }])
  })
})

describe('timings follow the cut', () => {
  const segs = [{ start: 1.75, end: 3 }, { start: 5, end: 6 }]
  it('a time inside a kept segment moves by what was cut before it; a time in a cut lands on the join', () => {
    expect(remapTime(2, segs)).toBeCloseTo(0.25, 5)
    expect(remapTime(5.5, segs)).toBeCloseTo(1.75, 5)
    expect(remapTime(4, segs)).toBeCloseTo(1.25, 5)
    expect(remapTime(0.5, segs)).toBe(0)
    expect(remapTime(9, segs)).toBeCloseTo(2.25, 5)
  })
  it('remaps {w, s, e} words, keeping every other key', () => {
    expect(remapTimings([{ w: 'Dear', s: 2, e: 2.4 }, { w: 'Robin,', s: 5.1, e: 5.6, br: 1 }], segs))
      .toEqual([{ w: 'Dear', s: 0.25, e: 0.65 }, { w: 'Robin,', s: 1.35, e: 1.85, br: 1 }])
  })
})

describe('tightenSamples', () => {
  it('joins the kept segments with a short fade at each cut, so there is no click', () => {
    const rate = 1000
    const x = new Float32Array(3000).fill(1)
    const out = tightenSamples(x, rate, [{ start: 0, end: 1 }, { start: 2, end: 3 }], 10)
    expect(out.length).toBe(2000)
    expect(out[500]).toBe(1)
    expect(out[999]).toBeLessThan(0.15)
    expect(out[1000]).toBeLessThan(0.15)
    expect(out[0]).toBeLessThan(0.15)
    expect(out[1999]).toBeLessThan(0.15)
  })
})
