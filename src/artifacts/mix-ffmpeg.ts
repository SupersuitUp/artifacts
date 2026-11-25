// The voice eCard's mix rendered with ffmpeg (0.75.0): BlessOut's mixer, scripts/mix-voiceover.mjs,
// built from the SAME recipe the browser renders (mix.ts MIX), so the two cannot drift. Pure: the
// graph, the arguments, the timing shift and the sidecar; src/cli/mix.ts runs it.
//
// The recipe keeps both fixes the BlessOut mixer's header describes over its older service:
//   1. The voice is loudness-normalized (loudnorm) and amix's own normalization is off, instead of
//      boosting the voice 10x to beat amix's input normalization, which clipped a sane recording.
//   2. The bed loops (-stream_loop -1) and -t ends the file, instead of amix duration=first, which
//      cut the mix short when the instrumental was shorter than the voice.
// And its two later lessons: the voice branch is padded to the full length (apad), because
// sidechaincompress stops when its sidechain ends and would cut the bed's fade-out; and a limiter
// at about -1 dBTP, because the bed sums on top of a normalized voice.
import { fadeInOf, mixLength, type MixSettings, type TakeSegment } from './mix.js'

const sec = (n: number) => n.toFixed(3)

/** The take, tightened (0.75.0): each kept segment cut out, faded in and out over tightenFadeMs,
 *  and joined, ending in [take]. The same segments the browser cuts (mix.ts tightenSegments). */
function tightenChain(segments: TakeSegment[], s: MixSettings): string {
  const d = (s.tightenFadeMs / 1000).toFixed(3)
  const cut = (g: TakeSegment) => `atrim=start=${sec(g.start)}:end=${sec(g.end)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${d},afade=t=out:st=${sec(g.end - g.start - s.tightenFadeMs / 1000)}:d=${d}`
  if (segments.length === 1) return `[1:a]${cut(segments[0])}[take];`
  return `[1:a]asplit=${segments.length}${segments.map((_, i) => `[r${i}]`).join('')};`
    + segments.map((g, i) => `[r${i}]${cut(g)}[t${i}];`).join('')
    + `${segments.map((_, i) => `[t${i}]`).join('')}concat=n=${segments.length}:v=0:a=1[take];`
}

/** The filter graph: [0:a] is the bed, [1:a] the voice; the output is [mix]. With `segments` (and
 *  `tighten` on) the voice is tightened first, and `voiceSeconds` is the tightened length. */
export function ffmpegMixGraph(voiceSeconds: number, s: MixSettings, segments?: TakeSegment[]): string {
  const total = mixLength(voiceSeconds, s)
  const tight = s.tighten && segments?.length ? tightenChain(segments, s) : ''
  const vin = tight ? '[take]' : '[1:a]'
  const voice = [
    'highpass=f=80',
    s.normalize ? `loudnorm=I=${s.loudnessLufs}:TP=${s.truePeakDb}:LRA=${s.loudnessRange}` : null,
    `adelay=delays=${Math.round(s.voiceDelay * 1000)}:all=1`,
    `apad=whole_dur=${sec(total)}`,
  ].filter(Boolean).join(',')
  const bed = [
    `volume=${s.musicVolume}`,
    `afade=t=in:st=0:d=${fadeInOf(s)}`,
    `afade=t=out:st=${sec(voiceSeconds + s.voiceDelay)}:d=${s.fadeOut}`,
    `atrim=start=0:end=${sec(total)}`,
  ].join(',')
  const limiter = `alimiter=limit=${s.limit}:level=false`
  return (s.duck
    ? [
      `${tight}${vin}${voice},asplit=2[voice][sc]`,
      `[0:a]${bed}[bg]`,
      `[bg][sc]sidechaincompress=threshold=${s.duckThreshold}:ratio=${s.duckRatio}:attack=${s.attackMs}:release=${s.releaseMs}[bgduck]`,
      `[bgduck][voice]amix=inputs=2:duration=longest:normalize=0[premix]`,
      `[premix]${limiter}[mix]`,
    ]
    : [
      `${tight}${vin}${voice}[voice]`,
      `[0:a]${bed}[bg]`,
      `[bg][voice]amix=inputs=2:duration=longest:normalize=0[premix]`,
      `[premix]${limiter}[mix]`,
    ]).join(';')
}

export type FfmpegMixInput = { voice: string; music: string; out: string; voiceSeconds: number; settings: MixSettings; mp3?: boolean; segments?: TakeSegment[] }

/** ffmpeg's arguments for one mix. */
export function ffmpegMixArgs(i: FfmpegMixInput): string[] {
  return [
    '-stream_loop', '-1',
    ...(i.settings.musicStart ? ['-ss', String(i.settings.musicStart)] : []),
    '-i', i.music,
    '-i', i.voice,
    '-filter_complex', ffmpegMixGraph(i.voiceSeconds, i.settings, i.segments),
    '-map', '[mix]',
    '-t', sec(mixLength(i.voiceSeconds, i.settings)),
    ...(i.mp3 ? ['-c:a', 'libmp3lame', '-b:a', '192k'] : ['-c:a', 'aac', '-b:a', '192k', '-f', 'mp4']),
    '-y', i.out,
  ]
}

/** Word timings measured on the voice file, moved into the mix's timeline. Refuses a shape it does
 *  not understand rather than writing NaN, as BlessOut's mixer does. Other keys are kept. */
export function shiftTimings(raw: unknown, voiceDelay: number): { ok: true; words: Record<string, unknown>[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'timings must be a non-empty array of word timings' }
  const bad = raw.findIndex((t) => !t || typeof t !== 'object' || typeof (t as { s?: unknown }).s !== 'number' || typeof (t as { e?: unknown }).e !== 'number'
    || Number.isNaN((t as { s: number }).s) || Number.isNaN((t as { e: number }).e))
  if (bad !== -1) return { ok: false, error: `timings entry ${bad} has no numeric {s, e}: ${JSON.stringify(raw[bad])}. Each word must be {"w": "...", "s": <seconds>, "e": <seconds>}; mlx_whisper emits {word, start, end}, so map the keys first.` }
  const r2 = (n: number) => Number(n.toFixed(2))
  return { ok: true, words: raw.map((t) => ({ ...(t as object), s: r2((t as { s: number }).s + voiceDelay), e: r2((t as { e: number }).e + voiceDelay) })) }
}

/** The `.mix.json` beside a mix: where the voice starts, and every setting it was made with. */
export function mixSidecar(voiceSeconds: number, s: MixSettings, extra: { track?: string; segments?: TakeSegment[]; rawSeconds?: number } = {}) {
  return {
    voiceDelaySeconds: s.voiceDelay,
    voiceDurationSeconds: Number(voiceSeconds.toFixed(3)),
    ...(extra.rawSeconds !== undefined ? { rawVoiceSeconds: Number(extra.rawSeconds.toFixed(3)) } : {}),
    ...(extra.segments ? { segments: extra.segments } : {}),
    fadeOutSeconds: s.fadeOut,
    totalSeconds: Number(mixLength(voiceSeconds, s).toFixed(3)),
    musicStartSeconds: s.musicStart,
    ...(extra.track ? { track: extra.track } : {}),
    settings: s,
    note: extra.segments ? 'The voice was tightened to these segments of the raw take: word timings on the raw take are moved through them (remapTimings), then shifted by +voiceDelaySeconds.' : 'Word timings measured on the voice file must be shifted by +voiceDelaySeconds to line up with this mix.',
  }
}
