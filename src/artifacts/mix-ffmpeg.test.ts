// One recipe, two renderers (0.75.0): BlessOut's mixer (scripts/mix-voiceover.mjs) as an ffmpeg
// graph built from the same MIX the browser renders, the timing shift, and every option it had.
import { describe, it, expect } from 'vitest'
import { MIX, bedLevel, mixLength, mixSettings } from './mix.js'
import { ffmpegMixGraph, ffmpegMixArgs, shiftTimings, mixSidecar } from './mix-ffmpeg.js'

describe('the recipe holds every setting BlessOut\'s mixer had', () => {
  it('MIX: bed 0.2 from musicStart, 4 s lead faded in over fadeIn (the lead), 6 s fade out, duck, loudness, limiter', () => {
    expect(MIX).toEqual({
      musicVolume: 0.2, musicStart: 0, voiceDelay: 4, fadeIn: null, fadeOut: 6,
      duck: true, duckThreshold: 0.03, duckRatio: 6, attackMs: 20, releaseMs: 2500,
      normalize: true, loudnessLufs: -16, truePeakDb: -1.5, loudnessRange: 11, limit: 0.89,
      tighten: true, tightenLead: 0.25, tightenTail: 0.4, tightenPause: 0.9, tightenKeep: 0.6, tightenFadeMs: 10,
    })
    expect(mixSettings({ voiceDelay: 2 }).fadeIn).toBeNull()
    expect(() => mixSettings({ musicVolume: -1 })).toThrow('musicVolume')
  })
})

describe('the ffmpeg graph', () => {
  it('is BlessOut\'s fixed recipe, every number from MIX', () => {
    expect(ffmpegMixGraph(20, MIX)).toBe([
      '[1:a]highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=delays=4000:all=1,apad=whole_dur=30.000,asplit=2[voice][sc]',
      '[0:a]volume=0.2,afade=t=in:st=0:d=4,afade=t=out:st=24.000:d=6,atrim=start=0:end=30.000[bg]',
      '[bg][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=2500[bgduck]',
      '[bgduck][voice]amix=inputs=2:duration=longest:normalize=0[premix]',
      '[premix]alimiter=limit=0.89:level=false[mix]',
    ].join(';'))
  })
  it('--no-duck and --no-normalize drop exactly their stages, and the fades follow their settings', () => {
    const g = ffmpegMixGraph(10, mixSettings({ duck: false, normalize: false, voiceDelay: 2, fadeIn: 3, fadeOut: 5, musicVolume: 0.3 }))
    expect(g).not.toContain('sidechaincompress')
    expect(g).not.toContain('loudnorm')
    expect(g).toContain('volume=0.3,afade=t=in:st=0:d=3,afade=t=out:st=12.000:d=5,atrim=start=0:end=17.000')
    expect(g).toContain('adelay=delays=2000:all=1')
    expect(g).toContain('[bg][voice]amix=inputs=2:duration=longest:normalize=0[premix]')
  })
  it('the arguments: the bed looped (so a short one never truncates) and seeked to musicStart, m4a or mp3', () => {
    const a = ffmpegMixArgs({ voice: 'v.m4a', music: 'm.wav', out: 'o.m4a', voiceSeconds: 20, settings: mixSettings({ musicStart: 77 }) })
    expect(a.slice(0, 6)).toEqual(['-stream_loop', '-1', '-ss', '77', '-i', 'm.wav'])
    expect(a).toEqual(expect.arrayContaining(['-i', 'v.m4a', '-map', '[mix]', '-t', '30.000', '-c:a', 'aac', '-f', 'mp4', '-y', 'o.m4a']))
    const mp3 = ffmpegMixArgs({ voice: 'v.m4a', music: 'm.wav', out: 'o.mp3', voiceSeconds: 20, settings: MIX, mp3: true })
    expect(mp3).toEqual(expect.arrayContaining(['-c:a', 'libmp3lame', '-b:a', '192k']))
    expect(mp3).not.toContain('-ss')
  })
})

describe('the take is tightened before the mix, on the same segments', () => {
  const segs = [{ start: 1.75, end: 3 }, { start: 5, end: 6.4 }]
  it('cuts each kept segment, fades each cut over tightenFadeMs, joins them, then the voice chain', () => {
    const g = ffmpegMixGraph(2.65, MIX, segs)
    expect(g.startsWith('[1:a]asplit=2[r0][r1];'
      + '[r0]atrim=start=1.750:end=3.000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010,afade=t=out:st=1.240:d=0.010[t0];'
      + '[r1]atrim=start=5.000:end=6.400,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010,afade=t=out:st=1.390:d=0.010[t1];'
      + '[t0][t1]concat=n=2:v=0:a=1[take];'
      + '[take]highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=delays=4000:all=1,apad=whole_dur=12.650,asplit=2[voice][sc]')).toBe(true)
  })
  it('one segment needs no split or join', () => {
    expect(ffmpegMixGraph(3.65, MIX, [{ start: 1.75, end: 5.4 }]).startsWith('[1:a]atrim=start=1.750:end=5.400,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.010,afade=t=out:st=3.640:d=0.010[take];[take]highpass=f=80')).toBe(true)
  })
  it('off, or no segments, the voice goes in whole', () => {
    expect(ffmpegMixGraph(20, mixSettings({ tighten: false }), segs).startsWith('[1:a]highpass=f=80')).toBe(true)
    expect(ffmpegMixGraph(20, MIX).startsWith('[1:a]highpass=f=80')).toBe(true)
  })
  it('the sidecar records the segments and the raw length, so timings line up', () => {
    expect(mixSidecar(2.65, MIX, { segments: segs, rawSeconds: 8 })).toMatchObject({ voiceDurationSeconds: 2.65, rawVoiceSeconds: 8, segments: segs })
  })
})

describe('parity: the browser and ffmpeg read one recipe', () => {
  it('the bed level the browser draws and the fades ffmpeg applies come from the same numbers', () => {
    const s = mixSettings({ voiceDelay: 4, fadeOut: 6, musicVolume: 0.2 })
    const g = ffmpegMixGraph(20, s)
    expect(g).toContain(`volume=${s.musicVolume}`)
    expect(g).toContain(`afade=t=in:st=0:d=${s.voiceDelay}`)
    expect(g).toContain(`afade=t=out:st=${(20 + s.voiceDelay).toFixed(3)}:d=${s.fadeOut}`)
    expect(g).toContain(`end=${mixLength(20, s).toFixed(3)}`)
    expect(bedLevel(s.voiceDelay, 20, s)).toBeCloseTo(s.musicVolume)
    expect(bedLevel(20 + s.voiceDelay + s.fadeOut, 20, s)).toBe(0)
    expect(g).toContain(`threshold=${s.duckThreshold}:ratio=${s.duckRatio}:attack=${s.attackMs}:release=${s.releaseMs}`)
    expect(g).toContain(`limit=${s.limit}`)
  })
})

describe('timings follow the voice into the mix', () => {
  it('every word moves later by the voice delay, rounded to the hundredth, other keys kept', () => {
    expect(shiftTimings([{ w: 'Dear', s: 0.1, e: 0.4 }, { w: 'Sam,', s: 0.45, e: 0.9, br: 1 }], 4)).toEqual({ ok: true, words: [{ w: 'Dear', s: 4.1, e: 4.4 }, { w: 'Sam,', s: 4.45, e: 4.9, br: 1 }] })
  })
  it('refuses a shape it does not understand rather than writing NaN (BlessOut\'s own guard)', () => {
    for (const raw of [[], {}, [{ t: 1, e: 2 }], [{ word: 'x', start: 1, end: 2 }], [{ w: 'x', s: NaN, e: 1 }]]) {
      const r = shiftTimings(raw, 4)
      expect(r.ok, JSON.stringify(raw)).toBe(false)
    }
    const r = shiftTimings([{ word: 'x', start: 1, end: 2 }], 4)
    if (!r.ok) expect(r.error).toContain('mlx_whisper emits {word, start, end}')
  })
  it('the sidecar records where the voice starts and the settings it was mixed with', () => {
    expect(mixSidecar(20.123, mixSettings({ musicStart: 77 }), { track: 'reflective-piano' })).toEqual({
      voiceDelaySeconds: 4, voiceDurationSeconds: 20.123, fadeOutSeconds: 6, totalSeconds: 30.123, musicStartSeconds: 77, track: 'reflective-piano',
      settings: mixSettings({ musicStart: 77 }),
      note: 'Word timings measured on the voice file must be shifted by +voiceDelaySeconds to line up with this mix.',
    })
  })
})
