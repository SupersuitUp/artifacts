// artifacts-mix (0.75.0): BlessOut's scripts/mix-voiceover.mjs, every option, on the package's recipe.
import { describe, it, expect, vi } from 'vitest'
import { parseMixArgs, runMix, MIX_USAGE } from './mix.js'
import { MIX } from '../artifacts/mix.js'

const argv = (s: string) => s.split(' ').filter(Boolean)

describe('the options, every one BlessOut\'s mixer had', () => {
  it('defaults: the recipe as it is, an m4a beside the voice', () => {
    const r = parseMixArgs(argv('--voice take2.m4a --music bed.wav'))
    if (!r.ok) throw new Error(r.error)
    expect(r.opts).toMatchObject({ voice: 'take2.m4a', music: 'bed.wav', out: 'take2-mixed.m4a', mp3: false, dryRun: false, json: false })
    expect(r.opts.settings).toEqual({ ...MIX })
  })
  it('every setting, and the two switches', () => {
    const r = parseMixArgs(argv('--voice v.wav --music m.wav --out card.mp3 --mp3 --music-start 12 --voice-delay 3 --fade-in 2 --fade-out 5 --music-vol 0.25 --duck-release 1800 --duck-threshold 0.05 --duck-ratio 4 --no-duck --no-normalize --no-tighten --timings w.json --dry-run --json'))
    if (!r.ok) throw new Error(r.error)
    expect(r.opts).toMatchObject({ out: 'card.mp3', mp3: true, timings: 'w.json', dryRun: true, json: true })
    expect(r.opts.settings).toMatchObject({ musicStart: 12, voiceDelay: 3, fadeIn: 2, fadeOut: 5, musicVolume: 0.25, releaseMs: 1800, duckThreshold: 0.05, duckRatio: 4, duck: false, normalize: false, tighten: false })
  })
  it('--mp3 with no --out writes -mixed.mp3', () => {
    const r = parseMixArgs(argv('--voice dir/take.m4a --music m.wav --mp3'))
    expect(r.ok && r.opts.out).toBe('dir/take-mixed.mp3')
  })
  it('a catalog track id plays from the host library, from the track\'s own start unless --music-start says otherwise', () => {
    const r = parseMixArgs(argv('--voice v.m4a --music silent-night --library https://media.example.com/music'))
    expect(r.ok && r.opts.music).toBe('https://media.example.com/music/hilltoptrio_silent-night.wav')
    expect(r.ok && r.opts.settings.musicStart).toBe(88)
    expect(r.ok && r.opts.track).toBe('silent-night')
    const own = parseMixArgs(argv('--voice v.m4a --music silent-night --library /music --music-start 0'))
    expect(own.ok && own.opts.settings.musicStart).toBe(0)
    expect(own.ok && own.opts.music).toBe('/music/hilltoptrio_silent-night.wav')
  })
  it('refuses, in words: no voice or music, a number that is not one, a track with no library', () => {
    for (const [a, why] of [['--music m.wav', MIX_USAGE], ['--voice v.wav', MIX_USAGE], ['--voice v --music m --music-vol loud', '--music-vol must be a number'], ['--voice v --music m --duck-ratio 0.5', 'duckRatio'], ['--voice v --music silent-night', '--library']] as const) {
      const r = parseMixArgs(argv(a))
      expect(r.ok, a).toBe(false)
      if (!r.ok) expect(r.error).toContain(why)
    }
  })
})

describe('a run', () => {
  const deps = (over: Record<string, unknown> = {}) => {
    const files = new Map<string, string>([['w.json', JSON.stringify([{ w: 'Dear', s: 0.1, e: 0.4 }])]])
    const run = vi.fn(() => ({ status: 0, stderr: '' }))
    return { files, run, d: { probe: () => 20, levels: () => new Float32Array(2000).fill(0.2), run, exists: () => true, readFile: (f: string) => files.get(f)!, writeFile: (f: string, s: string) => void files.set(f, s), log: vi.fn(), ...over } }
  }
  it('runs ffmpeg with the recipe, writes the .mix.json and the shifted timings, and answers JSON', async () => {
    const { files, run, d } = deps()
    const r = parseMixArgs(argv('--voice take.m4a --music bed.wav --timings w.json --json'))
    if (!r.ok) throw new Error(r.error)
    const out = await runMix(r.opts, d)
    expect(out.code).toBe(0)
    expect(run).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-i', 'bed.wav', '-i', 'take.m4a', '-y', 'take-mixed.m4a']))
    expect(JSON.parse(files.get('take-mixed.mix.json')!)).toMatchObject({ voiceDelaySeconds: 4, totalSeconds: 30 })
    expect(JSON.parse(files.get('take-mixed.timings.json')!)).toEqual([{ w: 'Dear', s: 4.1, e: 4.4 }])
    expect(out.result).toMatchObject({ out: 'take-mixed.m4a', sidecar: 'take-mixed.mix.json', timings: 'take-mixed.timings.json', voiceSeconds: 20 })
  })
  it('tightens the take first (the operator, 2026-11-25: "cut out long silences"): the mix, the sidecar and the timings all follow the cut', async () => {
    // 2 s of room, 1 s of speech, 2.5 s of room, 1 s of speech, 2 s of room.
    const lv = Float32Array.from([...Array(200).fill(0.002), ...Array(100).fill(0.2), ...Array(250).fill(0.002), ...Array(100).fill(0.2), ...Array(200).fill(0.002)])
    const { files, run, d } = deps({ levels: () => lv })
    files.set('w.json', JSON.stringify([{ w: 'Dear', s: 2.1, e: 2.5 }, { w: 'Robin,', s: 5.6, e: 6.2 }]))
    const r = parseMixArgs(argv('--voice take.m4a --music bed.wav --timings w.json'))
    if (!r.ok) throw new Error(r.error)
    const out = await runMix(r.opts, d)
    expect(out.code).toBe(0)
    const segs = [{ start: 1.75, end: 3.3 }, { start: 5.2, end: 6.9 }]
    const graph = (run.mock.calls[0] as unknown as [string, string[]])[1][(run.mock.calls[0] as unknown as [string, string[]])[1].indexOf('-filter_complex') + 1]
    expect(graph).toContain('[r0]atrim=start=1.750:end=3.300')
    expect(JSON.parse(files.get('take-mixed.mix.json')!)).toMatchObject({ voiceDurationSeconds: 3.25, rawVoiceSeconds: 8.5, segments: segs, totalSeconds: 13.25 })
    expect(JSON.parse(files.get('take-mixed.timings.json')!)).toEqual([{ w: 'Dear', s: 4.35, e: 4.75 }, { w: 'Robin,', s: 5.95, e: 6.55 }])
  })
  it('a take with no speech is refused before anything is mixed', async () => {
    const { files, run, d } = deps({ levels: () => new Float32Array(500).fill(0.002) })
    const r = parseMixArgs(argv('--voice take.m4a --music bed.wav'))
    if (!r.ok) throw new Error(r.error)
    expect((await runMix(r.opts, d)).code).toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(files.has('take-mixed.mix.json')).toBe(false)
  })
  it('--dry-run prints the command and runs nothing', async () => {
    const { run, d } = deps()
    const r = parseMixArgs(argv('--voice take.m4a --music bed.wav --dry-run'))
    if (!r.ok) throw new Error(r.error)
    const out = await runMix(r.opts, d)
    expect(out.code).toBe(0)
    expect(run).not.toHaveBeenCalled()
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('ffmpeg -stream_loop -1'))
  })
  it('a bad timings file stops before ffmpeg runs and writes nothing', async () => {
    const { files, run, d } = deps()
    files.set('w.json', JSON.stringify([{ word: 'x', start: 1, end: 2 }]))
    const r = parseMixArgs(argv('--voice take.m4a --music bed.wav --timings w.json'))
    if (!r.ok) throw new Error(r.error)
    const out = await runMix(r.opts, d)
    expect(out.code).toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(files.has('take-mixed.mix.json')).toBe(false)
  })
  it('a failed ffmpeg is exit 1', async () => {
    const { d } = deps({ run: () => ({ status: 1, stderr: 'boom' }) })
    const r = parseMixArgs(argv('--voice take.m4a --music bed.wav'))
    if (!r.ok) throw new Error(r.error)
    expect((await runMix(r.opts, d)).code).toBe(1)
  })
})
