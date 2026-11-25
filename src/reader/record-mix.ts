// The voice eCard's mix, rendered in the owner's browser after each take: OfflineAudioContext plays
// the bed with the gain curve from mix.ts (the 4 s lead, the duck under the voice, the 6 s fade)
// and the voice from 4 s, scaled to speech level; the limiter runs on the rendered samples; the
// result is a mono WAV. With no bed the voice alone is normalized and starts at 0.
//
// The bed is fetched from its https address, so its host must allow this hub's origin (CORS).
import { MIX, BLOCK_S, bedCurve, blockLevels, encodeWav, limit, mixLength, voiceGain, type MixSettings } from '../artifacts/mix.js'

/** The mix's sample rate: mono at 32 kHz keeps a minute of WAV near 4 MB. */
export const MIX_RATE = 32_000

export type MixedTake = { wav: Blob; voiceDelay: number; seconds: number }

type Ctor = typeof OfflineAudioContext
const offline = (): Ctor | null => (typeof window === 'undefined' ? null : (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: Ctor }).webkitOfflineAudioContext ?? null))

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const C = offline()
  if (!C) throw new Error('this browser cannot mix audio')
  // Any context decodes; a one-sample offline one needs no audio device.
  return new C(1, 1, MIX_RATE).decodeAudioData(bytes)
}

/** The voice as mono samples at MIX_RATE. */
async function monoAt(buf: AudioBuffer): Promise<Float32Array> {
  const C = offline()!
  const ctx = new C(1, Math.max(1, Math.ceil(buf.duration * MIX_RATE)), MIX_RATE)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
  return (await ctx.startRendering()).getChannelData(0)
}

/** `settings` is the same recipe ffmpeg renders (mix-ffmpeg.ts): one recipe, two renderers. A
 *  catalog track's `startAt` arrives as `musicStart`. */
export async function mixTake(voice: Blob, music?: string, settings: MixSettings = MIX): Promise<MixedTake> {
  const C = offline()
  if (!C) throw new Error('this browser cannot mix audio')
  const v = await monoAt(await decode(await voice.arrayBuffer()))
  const seconds = v.length / MIX_RATE
  const gain = settings.normalize ? voiceGain(v, MIX_RATE, settings.limit) : 1
  if (!music) {
    const out = Float32Array.from(v, (x) => x * gain)
    return { wav: new Blob([encodeWav(limit(out, MIX_RATE, settings.limit), MIX_RATE)], { type: 'audio/wav' }), voiceDelay: 0, seconds }
  }
  const bed = await decode(await (await fetch(music)).arrayBuffer())
  const total = mixLength(seconds, settings)
  const ctx = new C(1, Math.ceil(total * MIX_RATE), MIX_RATE)
  // The bed, looped for as long as the mix runs, under the curve.
  const b = ctx.createBufferSource()
  b.buffer = bed
  b.loop = true
  const bg = ctx.createGain()
  const scaled = Float32Array.from(blockLevels(v, MIX_RATE), (x) => x * gain)
  bg.gain.setValueCurveAtTime(bedCurve(scaled, seconds, settings), 0, Math.ceil(total / BLOCK_S) * BLOCK_S)
  b.connect(bg).connect(ctx.destination)
  // From musicStart, as ffmpeg's -ss; the loop then runs the whole file, as -stream_loop does.
  b.start(0, settings.musicStart)
  // The voice, at speech level, from the end of the lead.
  const vb = ctx.createBuffer(1, v.length, MIX_RATE)
  vb.copyToChannel(Float32Array.from(v, (x) => x * gain), 0)
  const vs = ctx.createBufferSource()
  vs.buffer = vb
  vs.connect(ctx.destination)
  vs.start(settings.voiceDelay)
  const out = (await ctx.startRendering()).getChannelData(0)
  return { wav: new Blob([encodeWav(limit(out, MIX_RATE, settings.limit), MIX_RATE)], { type: 'audio/wav' }), voiceDelay: settings.voiceDelay, seconds }
}
