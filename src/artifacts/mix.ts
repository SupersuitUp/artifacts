// The voice eCard's mix, as numbers: a music bed alone for 4 s, the voice from 4 s, the bed ducked
// under the voice and fading out over 6 s after it, a limiter near -1 dBTP. Pure, so the browser
// (src/reader/record-mix.ts renders it with OfflineAudioContext) and the tests read one recipe.
//
// THE RECIPE IS BLESSOUT'S MIXER (scripts/mix-voiceover.mjs), number for number:
//   music:  volume=0.2, afade in 0..voiceDelay, afade out from voiceEnd over fadeOut (both linear)
//   duck:   sidechaincompress threshold=0.03 ratio=6 attack=20 release=2500, keyed by the voice
//   voice:  loudnorm I=-16 (here an RMS target, see VOICE_RMS), delayed by voiceDelay
//   out:    amix normalize=0, then alimiter limit=0.89 (about -1 dBTP)
//   length: voiceDelay + voice + fadeOut

export const MIX = {
  musicVolume: 0.2,
  /** Seconds into the bed it starts at (a catalog track's `startAt`, BlessOut's fadeInTime). */
  musicStart: 0,
  voiceDelay: 4,
  /** How long the bed fades in; null is the lead (voiceDelay), as BlessOut's mixer defaulted it. */
  fadeIn: null as number | null,
  fadeOut: 6,
  /** Duck the bed under the voice (BlessOut's --no-duck turns it off). */
  duck: true,
  duckThreshold: 0.03,
  duckRatio: 6,
  attackMs: 20,
  releaseMs: 2500,
  /** Bring the voice to speech loudness (BlessOut's --no-normalize turns it off). ffmpeg uses
   *  loudnorm with these three; the browser, which has no loudnorm, an RMS target (VOICE_RMS). */
  normalize: true,
  loudnessLufs: -16,
  truePeakDb: -1.5,
  loudnessRange: 11,
  limit: 0.89,
  /** Tighten the take before the mix (0.75.0): trim the silence before the first word and after the
   *  last, keeping a breath of each, and shorten any inner pause over tightenPause to tightenKeep,
   *  with a short fade at each cut. Both renderers cut the same segments (tightenSegments). */
  tighten: true,
  tightenLead: 0.25,
  tightenTail: 0.4,
  tightenPause: 0.9,
  tightenKeep: 0.6,
  tightenFadeMs: 10,
}
export type MixSettings = { -readonly [K in keyof typeof MIX]: (typeof MIX)[K] }

/** The recipe with some settings changed, checked: every number finite and in range. */
export function mixSettings(over: Partial<MixSettings> = {}): MixSettings {
  const s: MixSettings = { ...MIX, ...over }
  const nonNeg = ['musicVolume', 'musicStart', 'voiceDelay', 'fadeOut', 'duckThreshold', 'attackMs', 'releaseMs', 'limit', 'tightenLead', 'tightenTail', 'tightenPause', 'tightenKeep', 'tightenFadeMs'] as const
  for (const k of nonNeg) if (!(Number.isFinite(s[k]) && s[k] >= 0)) throw new Error(`${k} must be a number 0 or more`)
  if (s.fadeIn !== null && !(Number.isFinite(s.fadeIn) && s.fadeIn >= 0)) throw new Error('fadeIn must be a number 0 or more, or null for the lead')
  if (!(Number.isFinite(s.duckRatio) && s.duckRatio >= 1)) throw new Error('duckRatio must be 1 or more')
  if (s.tightenKeep > s.tightenPause) throw new Error('tightenKeep must be no longer than tightenPause')
  return s
}
/** How long the bed fades in: its own setting, else the lead. */
export const fadeInOf = (s: Pick<MixSettings, 'fadeIn' | 'voiceDelay'>) => s.fadeIn ?? s.voiceDelay

/** loudnorm's -16 LUFS for speech sits near an RMS of -19 dBFS; a browser has no loudnorm, so the
 *  voice is scaled to this RMS (measured over the voiced blocks only) and never past its peak. */
export const VOICE_RMS = 0.112
/** Analysis blocks for the duck and the limiter: 10 ms. */
export const BLOCK_S = 0.01

/** How long the mix runs. */
export const mixLength = (voiceSeconds: number, s: Pick<MixSettings, 'voiceDelay' | 'fadeOut'> = MIX) => s.voiceDelay + voiceSeconds + s.fadeOut

/** The bed's level at `t` before the duck: up from silence over the lead, held, down over fadeOut. */
export function bedLevel(t: number, voiceSeconds: number, s: Pick<MixSettings, 'musicVolume' | 'voiceDelay' | 'fadeOut'> & Partial<Pick<MixSettings, 'fadeIn'>> = MIX): number {
  const end = s.voiceDelay + voiceSeconds
  if (t < 0 || t >= end + s.fadeOut) return 0
  const lead = fadeInOf({ fadeIn: s.fadeIn ?? null, voiceDelay: s.voiceDelay })
  const fadeIn = lead > 0 ? Math.min(1, t / lead) : 1
  const fadeOut = t <= end ? 1 : Math.max(0, 1 - (t - end) / s.fadeOut)
  return s.musicVolume * fadeIn * fadeOut
}

/** The voice's level per block (RMS), from its samples. */
export function blockLevels(samples: Float32Array, sampleRate: number, blockS = BLOCK_S): Float32Array {
  const n = Math.max(1, Math.round(sampleRate * blockS))
  const out = new Float32Array(Math.ceil(samples.length / n))
  for (let b = 0; b < out.length; b++) {
    let sum = 0, k = 0
    for (let i = b * n; i < Math.min(samples.length, (b + 1) * n); i++, k++) sum += samples[i] * samples[i]
    out[b] = k ? Math.sqrt(sum / k) : 0
  }
  return out
}

/** The compressor's gain on the bed per block, keyed by the voice's levels: above the threshold,
 *  the level the ratio allows over the level it is (ffmpeg's sidechaincompress), smoothed with the
 *  attack going down and the release coming back up. 1 is no duck. */
export function duckGains(levels: Float32Array, s: Pick<MixSettings, 'duckThreshold' | 'duckRatio' | 'attackMs' | 'releaseMs'> = MIX, blockS = BLOCK_S): Float32Array {
  const out = new Float32Array(levels.length)
  const a = 1 - Math.exp(-(blockS * 1000) / s.attackMs)
  const r = 1 - Math.exp(-(blockS * 1000) / s.releaseMs)
  let g = 1
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i]
    const target = lvl > s.duckThreshold ? (s.duckThreshold + (lvl - s.duckThreshold) / s.duckRatio) / lvl : 1
    g += (target - g) * (target < g ? a : r)
    out[i] = g
  }
  return out
}

/** The bed's whole gain curve, one value per block over the mix: level times duck. The voice's
 *  levels are on the voice's own clock, so they are shifted by voiceDelay here. */
export function bedCurve(voiceLevels: Float32Array, voiceSeconds: number, s: MixSettings = MIX, blockS = BLOCK_S): Float32Array {
  const duck = s.duck ? duckGains(voiceLevels, s, blockS) : new Float32Array(voiceLevels.length).fill(1)
  const n = Math.ceil(mixLength(voiceSeconds, s) / blockS)
  const lead = Math.round(s.voiceDelay / blockS)
  // After the voice ends the duck releases on its own clock: carry it on with silence as the key.
  const out = new Float32Array(n)
  let g = duck.length ? duck[duck.length - 1] : 1
  const r = 1 - Math.exp(-(blockS * 1000) / s.releaseMs)
  for (let i = 0; i < n; i++) {
    const v = i - lead
    let d = 1
    if (v >= 0 && v < duck.length) d = duck[v]
    else if (v >= duck.length) { g += (1 - g) * r; d = g }
    out[i] = bedLevel(i * blockS, voiceSeconds, s) * d
  }
  return out
}

/** The gain that brings speech to VOICE_RMS, measured over the voiced blocks, capped so its peak
 *  stays under the limit. */
export function voiceGain(samples: Float32Array, sampleRate: number, limit: number = MIX.limit): number {
  const lv = blockLevels(samples, sampleRate)
  const voiced = [...lv].filter((x) => x > 0.01)
  if (!voiced.length) return 1
  const rms = Math.sqrt(voiced.reduce((a, x) => a + x * x, 0) / voiced.length)
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return Math.min(VOICE_RMS / rms, peak ? limit / peak : Infinity)
}

/** A limiter on finished samples, in place: any block whose peak passes `limit` is pulled down to
 *  it at once, and the gain comes back over `releaseMs`. Nothing ever leaves past `limit`. */
export function limit(samples: Float32Array, sampleRate: number, ceiling: number = MIX.limit, releaseMs = 50): Float32Array {
  const n = Math.max(1, Math.round(sampleRate * BLOCK_S))
  const r = 1 - Math.exp(-(BLOCK_S * 1000) / releaseMs)
  let g = 1
  for (let b = 0; b * n < samples.length; b++) {
    let peak = 0
    for (let i = b * n; i < Math.min(samples.length, (b + 1) * n); i++) peak = Math.max(peak, Math.abs(samples[i]))
    const want = peak * g > ceiling ? ceiling / peak : 1
    g = want < g ? want : g + (1 - g) * r
    if (peak * g > ceiling) g = ceiling / peak
    for (let i = b * n; i < Math.min(samples.length, (b + 1) * n); i++) samples[i] *= g
  }
  return samples
}

/** Mono 16-bit PCM WAV bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(44 + samples.length * 2))
  const v = new DataView(out.buffer)
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  s(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); s(8, 'WAVE'); s(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return out
}

// ---- Tightening the take (0.75.0) ----------------------------------------------------------------

/** A stretch of the raw take that is kept, in seconds on the raw take's clock. */
export type TakeSegment = { start: number; end: number }
export type Tightened = { segments: TakeSegment[]; seconds: number; rawSeconds: number } | { silent: true }

/** A block is speech-loud when it passes this; fewer than SPEECH_MIN_S of them is a silent take. */
const LOUD = 0.01
const SPEECH_MIN_S = 0.1
/** Silence is a tenth of the take's own speech level (-20 dB), never under this floor. */
const SILENCE_FLOOR = 0.003
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** The segments of a take to keep, from its per-block levels (blockLevels): the silence before the
 *  first word and after the last trimmed to a breath, every inner pause over `tightenPause` cut to
 *  `tightenKeep` (half kept on each side, so a cut is always inside the silence). Silence is
 *  measured against the take's own speech level. No speech at all: the silent take. */
export function tightenSegments(levels: Float32Array, s: MixSettings = MIX, blockS = BLOCK_S): Tightened {
  const rawSeconds = levels.length * blockS
  const loud = [...levels].filter((x) => x > LOUD).sort((a, b) => a - b)
  if (loud.length * blockS < SPEECH_MIN_S) return { silent: true }
  if (!s.tighten) return { segments: [{ start: 0, end: r3(rawSeconds) }], seconds: r3(rawSeconds), rawSeconds }
  const ref = loud[Math.floor(loud.length / 2)]
  const thr = Math.max(ref * 0.1, SILENCE_FLOOR)
  const speech = Array.from(levels, (x) => x > thr)
  const first = speech.indexOf(true)
  const last = speech.lastIndexOf(true)
  const segments: TakeSegment[] = []
  let start = Math.max(0, first * blockS - s.tightenLead)
  let i = first
  while (i <= last) {
    if (speech[i]) { i++; continue }
    let j = i
    while (j <= last && !speech[j]) j++
    const gap = (j - i) * blockS
    if (gap > s.tightenPause) {
      segments.push({ start: r3(start), end: r3(i * blockS + s.tightenKeep / 2) })
      start = j * blockS - s.tightenKeep / 2
    }
    i = j
  }
  segments.push({ start: r3(start), end: r3(Math.min(rawSeconds, (last + 1) * blockS + s.tightenTail)) })
  return { segments, seconds: r3(segments.reduce((a, g) => a + g.end - g.start, 0)), rawSeconds }
}

/** A time on the raw take, on the tightened take's clock: inside a kept segment it moves back by
 *  what was cut before it; inside a cut it lands on the join. */
export function remapTime(t: number, segments: TakeSegment[]): number {
  let at = 0
  for (const g of segments) {
    if (t < g.start) return r3(at)
    if (t <= g.end) return r3(at + t - g.start)
    at += g.end - g.start
  }
  return r3(at)
}

/** Word timings made on the raw take, moved onto the tightened one. Other keys are kept. */
export function remapTimings<T extends { s: number; e: number }>(words: T[], segments: TakeSegment[]): T[] {
  return words.map((w) => {
    const s = Math.round(remapTime(w.s, segments) * 100) / 100
    return { ...w, s, e: Math.max(s, Math.round(remapTime(w.e, segments) * 100) / 100) }
  })
}

/** The kept segments of mono samples, joined, each faded in and out over `fadeMs` so a cut never
 *  clicks (every cut sits in silence, so the fade only removes the step). */
export function tightenSamples(samples: Float32Array, sampleRate: number, segments: TakeSegment[], fadeMs: number = MIX.tightenFadeMs): Float32Array {
  const parts = segments.map((g) => samples.subarray(Math.max(0, Math.round(g.start * sampleRate)), Math.min(samples.length, Math.round(g.end * sampleRate))))
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0))
  const k = Math.max(1, Math.round((fadeMs / 1000) * sampleRate))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    const f = Math.min(k, Math.floor(p.length / 2))
    for (let j = 0; j < f; j++) {
      out[o + j] *= j / f
      out[o + p.length - 1 - j] *= j / f
    }
    o += p.length
  }
  return out
}
