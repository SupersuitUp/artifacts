// The voice eCard's mix as numbers: BlessOut's mixer recipe (scripts/mix-voiceover.mjs).
import { describe, it, expect } from 'vitest'
import { MIX, BLOCK_S, bedLevel, bedCurve, blockLevels, duckGains, encodeWav, limit, mixLength, voiceGain } from './mix.js'

describe('the recipe is BlessOut\'s', () => {
  it('bed 0.2, lead 4 s, fade out 6 s, duck 0.03 at 6:1 with 20 ms attack and 2500 ms release, limit 0.89', () => {
    expect(MIX).toMatchObject({ musicVolume: 0.2, voiceDelay: 4, fadeOut: 6, duckThreshold: 0.03, duckRatio: 6, attackMs: 20, releaseMs: 2500, limit: 0.89 })
    expect(20 * Math.log10(MIX.limit)).toBeCloseTo(-1.01, 2)
    expect(mixLength(30)).toBe(40)
  })
})

describe('the bed', () => {
  it('rises from silence over the 4 s lead, holds at 0.2 under the voice, and fades over 6 s after it', () => {
    expect(bedLevel(0, 10)).toBe(0)
    expect(bedLevel(2, 10)).toBeCloseTo(0.1)
    expect(bedLevel(4, 10)).toBeCloseTo(0.2)
    expect(bedLevel(14, 10)).toBeCloseTo(0.2)
    expect(bedLevel(17, 10)).toBeCloseTo(0.1)
    expect(bedLevel(20, 10)).toBe(0)
    expect(bedLevel(-1, 10)).toBe(0)
  })
})

describe('the duck', () => {
  const levels = (secs: number, lvl: number) => new Float32Array(Math.round(secs / BLOCK_S)).fill(lvl)
  it('does nothing below the threshold', () => {
    expect([...duckGains(levels(1, 0.02))].every((g) => g === 1)).toBe(true)
  })
  it('pulls the bed down to the 6:1 gain within the 20 ms attack', () => {
    const g = duckGains(levels(0.2, 0.3))
    const target = (0.03 + (0.3 - 0.03) / 6) / 0.3
    expect(g[g.length - 1]).toBeCloseTo(target, 3)
    expect(g[Math.round(0.1 / BLOCK_S)]).toBeCloseTo(target, 2)
  })
  it('comes back up over the 2500 ms release, so a breath between sentences does not swell the bed', () => {
    const talk = levels(1, 0.3), quiet = levels(3, 0)
    const all = new Float32Array(talk.length + quiet.length)
    all.set(talk); all.set(quiet, talk.length)
    const g = duckGains(all)
    const low = g[talk.length - 1]
    const afterBreath = g[talk.length + Math.round(0.6 / BLOCK_S)]
    expect(afterBreath - low).toBeLessThan(0.3 * (1 - low))
    // One release constant later it has recovered about 63% of the way.
    const tau = g[talk.length + Math.round(2.5 / BLOCK_S) - 1]
    expect((tau - low) / (1 - low)).toBeCloseTo(1 - Math.exp(-1), 1)
  })
  it('the bed curve is the level times the duck, shifted by the 4 s lead', () => {
    const voice = levels(2, 0.3)
    const c = bedCurve(voice, 2)
    expect(c.length).toBe(Math.ceil(12 / BLOCK_S))
    expect(c[Math.round(3.9 / BLOCK_S)]).toBeCloseTo(bedLevel(3.9, 2), 5)
    expect(c[Math.round(5.5 / BLOCK_S)]).toBeLessThan(0.2 * 0.5)
    expect(c[c.length - 1]).toBeLessThan(0.01)
  })
})

describe('levels, the voice gain and the limiter', () => {
  const sine = (amp: number, secs: number, rate = 8000) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / rate))
  it('measures RMS per block', () => {
    const lv = blockLevels(sine(0.5, 1), 8000)
    expect(lv[10]).toBeCloseTo(0.5 / Math.SQRT2, 1) // a 10 ms block holds 2.2 cycles of 220 Hz
  })
  it('brings a quiet voice up to the speech level, never past the limit', () => {
    const g = voiceGain(sine(0.05, 1), 8000)
    expect(g).toBeCloseTo(0.112 / (0.05 / Math.SQRT2), 1)
    expect(voiceGain(sine(0.95, 1), 8000)).toBeLessThanOrEqual(MIX.limit / 0.95 + 1e-6)
  })
  it('the limiter leaves nothing past 0.89 and leaves a quiet signal alone', () => {
    const loud = limit(sine(1.4, 0.5), 8000)
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(0.89 + 1e-6)
    const quiet = sine(0.3, 0.5)
    expect([...limit(quiet.slice(), 8000)]).toEqual([...quiet])
  })
  it('writes a mono 16-bit WAV', () => {
    const w = encodeWav(new Float32Array([0, 1, -1]), 32000)
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF')
    expect(w.length).toBe(44 + 6)
    const v = new DataView(w.buffer)
    expect(v.getUint32(24, true)).toBe(32000)
    expect(v.getInt16(46, true)).toBe(0x7fff)
  })
})
