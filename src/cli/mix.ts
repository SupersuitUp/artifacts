#!/usr/bin/env node
// artifacts-mix: mix a voice over a music bed with ffmpeg, the voice eCard's recipe (mix.ts MIX),
// the same one the browser renders after a take. PORTED FROM BlessOut's scripts/mix-voiceover.mjs,
// every option kept; --library and a catalog track id are new (the music library, music.ts).
//
//   artifacts-mix --voice take.m4a --music bed.wav [--out card.m4a] [--timings words.json] [--json]
//   artifacts-mix --voice take.m4a --music silent-night --library https://media.example.com/music
//
// Writes the mix, `<out>.mix.json` (where the voice starts and every setting), and with --timings
// `<out>.timings.json`: the words shifted by the voice delay into the mix's timeline.
// Exit codes: 0 done; 1 ffmpeg failed; 2 usage, a bad number, or a timings file in a shape it
// does not understand.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MIX, BLOCK_S, blockLevels, mixSettings, remapTimings, tightenSegments, type MixSettings, type TakeSegment } from '../artifacts/mix.js'
import { ffmpegMixArgs, mixSidecar, shiftTimings } from '../artifacts/mix-ffmpeg.js'
import { musicTrack } from '../artifacts/music.js'

export const MIX_USAGE = 'usage: artifacts-mix --voice <file> --music <file|url|track-id> [--library <base url or dir>] [--out <file>] [--timings <words.json>] [--music-start s] [--voice-delay s] [--fade-in s] [--fade-out s] [--music-vol v] [--duck-release ms] [--duck-threshold v] [--duck-ratio r] [--no-duck] [--no-normalize] [--no-tighten] [--mp3] [--dry-run] [--json]'

export type MixOptions = { voice: string; music: string; track?: string; out: string; timings?: string; settings: MixSettings; mp3: boolean; dryRun: boolean; json: boolean }

/** The command line, checked. */
export function parseMixArgs(args: string[]): { ok: true; opts: MixOptions } | { ok: false; error: string } {
  const flag = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1] }
  const has = (n: string) => args.includes(n)
  const voice = flag('--voice'), musicArg = flag('--music')
  if (!voice || !musicArg) return { ok: false, error: MIX_USAGE }
  const over: Partial<MixSettings> = {}
  const nums: [string, keyof MixSettings][] = [['--music-start', 'musicStart'], ['--voice-delay', 'voiceDelay'], ['--fade-in', 'fadeIn'], ['--fade-out', 'fadeOut'], ['--music-vol', 'musicVolume'], ['--duck-release', 'releaseMs'], ['--duck-threshold', 'duckThreshold'], ['--duck-ratio', 'duckRatio']]
  for (const [f, k] of nums) {
    const v = flag(f)
    if (v === undefined) continue
    const n = Number(v)
    if (!Number.isFinite(n)) return { ok: false, error: `${f} must be a number, got "${v}"` }
    ;(over as Record<string, number>)[k] = n
  }
  if (has('--no-duck')) over.duck = false
  if (has('--no-normalize')) over.normalize = false
  if (has('--no-tighten')) over.tighten = false
  // A catalog track plays from the host's library, from the part of the song the catalog names.
  let music = musicArg
  let track: string | undefined
  const t = musicTrack(musicArg)
  if (t) {
    const lib = flag('--library')
    if (!lib) return { ok: false, error: `"${musicArg}" is a music library track: pass --library <base url or dir> where the files are` }
    music = `${lib.replace(/\/+$/, '')}/${t.file}`
    track = t.id
    if (over.musicStart === undefined) over.musicStart = t.startAt
  }
  let settings: MixSettings
  try { settings = mixSettings(over) } catch (e) { return { ok: false, error: (e as Error).message } }
  const mp3 = has('--mp3')
  const out = flag('--out') ?? join(dirname(voice), `${basename(voice, extname(voice))}-mixed.${mp3 ? 'mp3' : 'm4a'}`)
  return { ok: true, opts: { voice, music, ...(track ? { track } : {}), out, ...(flag('--timings') ? { timings: flag('--timings') } : {}), settings, mp3, dryRun: has('--dry-run'), json: has('--json') } }
}

export type MixDeps = {
  probe: (file: string) => number
  /** The take's level per 10 ms block (mix.ts blockLevels), for tightening. */
  levels: (file: string) => Float32Array
  run: (cmd: string, args: string[]) => { status: number | null; stderr: string }
  exists: (file: string) => boolean
  readFile: (file: string) => string
  writeFile: (file: string, text: string) => void
  log: (line: string) => void
}

const stem = (out: string) => out.replace(/\.[^./]+$/, '')

export async function runMix(o: MixOptions, d: MixDeps): Promise<{ code: number; result?: Record<string, unknown> }> {
  for (const f of [o.voice, ...(/^https?:/.test(o.music) ? [] : [o.music]), ...(o.timings ? [o.timings] : [])]) {
    if (!d.exists(f)) { d.log(`no such file: ${f}`); return { code: 2 } }
  }
  // The take, tightened (0.75.0): the same segments the browser recorder cuts.
  let segments: TakeSegment[] | undefined
  let rawSeconds: number | undefined
  let voiceSeconds: number
  if (o.settings.tighten) {
    const t = tightenSegments(d.levels(o.voice), o.settings, BLOCK_S)
    if ('silent' in t) { d.log(`no speech in ${o.voice}: nothing to mix`); return { code: 2 } }
    segments = t.segments
    rawSeconds = t.rawSeconds
    voiceSeconds = t.seconds
  } else voiceSeconds = d.probe(o.voice)
  // Timings are checked before anything is mixed: a shape it does not understand writes nothing.
  // Timings made on the raw take are moved through the cut first, then into the mix's timeline.
  let shifted: Record<string, unknown>[] | undefined
  if (o.timings) {
    let raw: unknown
    try { raw = JSON.parse(d.readFile(o.timings)) } catch { d.log(`--timings: ${o.timings} is not JSON`); return { code: 2 } }
    const s0 = shiftTimings(raw, 0)
    if (!s0.ok) { d.log(`--timings: ${s0.error}`); return { code: 2 } }
    const onTake = segments ? remapTimings(s0.words as { s: number; e: number }[], segments) : s0.words
    const s = shiftTimings(onTake, o.settings.voiceDelay)
    if (!s.ok) { d.log(`--timings: ${s.error}`); return { code: 2 } }
    shifted = s.words
  }
  const args = ffmpegMixArgs({ voice: o.voice, music: o.music, out: o.out, voiceSeconds, settings: o.settings, mp3: o.mp3, ...(segments ? { segments } : {}) })
  if (o.dryRun) {
    d.log(`ffmpeg ${args.map((a) => (/[\s;[\]]/.test(a) ? `'${a}'` : a)).join(' ')}`)
    return { code: 0 }
  }
  const r = d.run('ffmpeg', args)
  if (r.status !== 0) { d.log(r.stderr.slice(-2000)); return { code: 1 } }
  const sidecar = `${stem(o.out)}.mix.json`
  d.writeFile(sidecar, JSON.stringify(mixSidecar(voiceSeconds, o.settings, { track: o.track, ...(segments ? { segments, rawSeconds } : {}) }), null, 2) + '\n')
  const timings = shifted ? `${stem(o.out)}.timings.json` : undefined
  if (timings && shifted) d.writeFile(timings, JSON.stringify(shifted))
  const result = { out: o.out, sidecar, ...(timings ? { timings } : {}), voiceSeconds, settings: o.settings, ...(o.track ? { track: o.track } : {}) }
  if (o.json) d.log(JSON.stringify(result))
  else d.log(`Mixed. ${o.out} (voice starts at ${o.settings.voiceDelay}s; offsets in ${sidecar}${timings ? `; timings shifted into ${timings}` : ''})`)
  return { code: 0, result }
}

/** The machine's own ffprobe and ffmpeg. */
export const realDeps: MixDeps = {
  probe(file) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' })
    const n = parseFloat(String(r.stdout).trim())
    if (r.status !== 0 || !Number.isFinite(n)) throw new Error(`could not read the length of ${file} (is ffprobe installed?)`)
    return n
  },
  levels(file) {
    // Mono at 16 kHz as 32-bit floats on stdout: enough to tell speech from room tone.
    const rate = 16_000
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1024 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`could not read ${file} (is ffmpeg installed?)`)
    const b = r.stdout as Buffer
    // A pooled Buffer need not sit on a 4-byte boundary, so the floats are read, never viewed.
    const x = new Float32Array(Math.floor(b.byteLength / 4))
    for (let i = 0; i < x.length; i++) x[i] = b.readFloatLE(i * 4)
    return blockLevels(x, rate)
  },
  run: (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status, stderr: String(r.stderr ?? r.error ?? '') } },
  exists: existsSync,
  readFile: (f) => readFileSync(f, 'utf8'),
  writeFile: (f, s) => writeFileSync(f, s),
  log: (l) => process.stdout.write(l + '\n'),
}

export async function main(argv: string[]): Promise<number> {
  const p = parseMixArgs(argv.slice(2))
  if (!p.ok) { process.stderr.write(p.error + '\n'); return 2 }
  try { return (await runMix(p.opts, realDeps)).code } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return 1 }
}

export { MIX }

// Run only when started as a program (the package's bin), never on import.
const entry = process.argv[1] ? (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href } catch { return '' } })() : ''
if (entry === import.meta.url) void main(process.argv).then((c) => { process.exitCode = c })
