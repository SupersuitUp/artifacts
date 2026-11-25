// "Reply with your voice" on a voice eCard. the operator, 2026-11-25, on an iPhone: "It's hard to see the
// UI elements for playing your recording, and the record button becomes off-center when you click
// the record button." The reply's control sits in a fixed slot that never moves between idle,
// recording and recorded; the time and labels are navy and readable; playback is a real control.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let recording = false
let elapsed = 0
let finish: ((m: { blob: Blob; mime: string }) => void) | null = null
let hookOptions: Record<string, unknown> = {}
const stream = { getTracks: () => [{ stop: vi.fn() }] }
vi.mock('./voice-recorder.js', async (orig) => ({
  ...(await orig<typeof import('./voice-recorder.js')>()),
  // The recording, without a microphone: start marks it recording and hands over the stream; stop
  // hands back a memo.
  useVoiceRecording: (o: { onStart?: () => void; onStop: (m: { blob: Blob; mime: string }) => void; onStream?: (s: unknown) => void }) => {
    hookOptions = o
    return {
      supported: true, live: false, note: false, recording, elapsed,
      start: async () => { recording = true; finish = o.onStop; o.onStart?.(); o.onStream?.(stream) },
      stop: () => { recording = false; finish?.({ blob: new Blob(['voice'], { type: 'audio/webm' }), mime: 'audio/webm' }) },
    }
  },
}))

/** A Web Audio stand-in: a meter that hears a voice, a decoder that answers `take`, buffer sources. */
let take: Float32Array = new Float32Array(0)
let decodeFails = false
const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; buffer: unknown; onended: (() => void) | null }[] = []
const contexts: FakeCtx[] = []
class FakeCtx {
  state = 'suspended'; currentTime = 0; sampleRate = 48000; destination = {}
  constructor() { contexts.push(this) }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createMediaStreamSource = vi.fn(() => ({ connect: () => {}, disconnect: () => {} }))
  createAnalyser = vi.fn(() => ({ fftSize: 256, getByteTimeDomainData: (a: Uint8Array) => a.fill(200), connect: () => {}, disconnect: () => {} }))
  createBufferSource = vi.fn(() => { const n = { buffer: null as unknown, connect: () => {}, start: vi.fn(), stop: vi.fn(), onended: null }; sources.push(n); return n })
  decodeAudioData = vi.fn(async () => {
    if (decodeFails) throw new Error('cannot decode')
    return { duration: take.length / 48000, length: take.length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => take }
  })
}
const voiceTake = () => Float32Array.from({ length: 48000 * 2 }, (_, i) => 0.4 * Math.sin(i / 20) * (i % 4800 < 2400 ? 1 : 0.3))
import { VoiceReply, REPLY_TOKENS, contrastRatio, replyClock } from './voice-reply.js'

let root: Root | null = null
const posts: { url: string; body: any }[] = []
let stateStatus = 200
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  posts.length = 0
  stateStatus = 200
  recording = false
  elapsed = 0
  take = voiceTake()
  decodeFails = false
  sources.length = 0
  contexts.length = 0
  vi.stubGlobal('AudioContext', FakeCtx)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(stateStatus === 200 ? { entries: [] } : { error: 'replies are closed on this page' }), { status: stateStatus })
  }))
  Object.assign(URL, { createObjectURL: () => 'blob:take' })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { configurable: true, value: false }); this.dispatchEvent(new Event('play')); return Promise.resolve() } })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { configurable: true, value: true }); this.dispatchEvent(new Event('pause')) } })
})
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals() })

const voice = { upload: vi.fn(async () => 'comments/abcdefghijklmnop1234.webm'), transcribe: vi.fn(async () => null) }
async function mount(over: Record<string, unknown> = {}) {
  document.body.innerHTML = '<div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(<VoiceReply artifactId="card2345" blockId="b-card-0123abcd" ownerName="Sam" version={1} at={() => 7.4} voice={voice} {...over} />) })
}
const q = (s: string) => document.querySelector<HTMLElement>(s)
const press = async (s: string) => { await act(async () => { q(s)!.click(); await Promise.resolve() }) }
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

describe('the record control never moves', () => {
  it('one button in one fixed slot, idle and recording; the label and the time share one reserved line below it', async () => {
    await mount()
    const slot = q('[data-reply-slot]')!
    const button = q('[data-reply-record]')!
    expect(button.getAttribute('aria-label')).toBe('Record your reply')
    expect(q('[data-reply-under]')!.textContent).toBe('Tap to record your reply')
    await press('[data-reply-record]')
    // The same element, in the same slot, the only thing in it beside the line under it.
    expect(q('[data-reply-record]')).toBe(button)
    expect(button.parentElement).toBe(slot)
    expect(button.getAttribute('aria-label')).toBe('Stop recording')
    expect(q('[data-reply-under]')!.textContent).toBe('0:00')
    expect([...slot.children].map((c) => c.getAttribute('data-reply-record') !== null ? 'button' : c.getAttribute('data-reply-under') !== null ? 'under' : c.getAttribute('data-reply-ring') !== null ? 'ring' : c.getAttribute('data-reply-meter-space') !== null ? 'meter' : '?')).toEqual(['ring', 'button', 'under', 'meter'])
  })
  it('the clock reads m:ss', () => {
    expect(replyClock(0)).toBe('0:00')
    expect(replyClock(1_400)).toBe('0:01')
    expect(replyClock(75_000)).toBe('1:15')
  })
})

describe('the recorded take', () => {
  it('a labelled play control that toggles, the take\'s waveform with its times, then Send and Record again', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    const play = q('[data-reply-play]')!
    expect(play.getAttribute('aria-label')).toBe('Play your reply')
    await press('[data-reply-play]')
    expect(play.getAttribute('aria-label')).toBe('Pause your reply')
    await press('[data-reply-play]')
    expect(play.getAttribute('aria-label')).toBe('Play your reply')
    expect(q('[data-reply-wave][role="progressbar"]')).not.toBeNull()
    expect(q('[data-reply-time]')!.textContent).toBe('0:00 / 0:02')
    expect(q('[data-voice-reply-send]')!.textContent).toBe('Send to Sam')
    expect(q('[data-voice-reply-again]')!.textContent).toBe('Record again')
  })
  it('sends the memo as a comment\'s recording, appended to the comments slot, and says "Sent to Sam"', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(voice.upload).toHaveBeenCalledWith(expect.objectContaining({ mime: 'audio/webm' }), 'comment')
    expect(posts).toEqual([{ url: '/api/artifacts/card2345/state', body: { slot: 'comments', op: 'append', value: { anchor: { kind: 'time', block: 'b-card-0123abcd', at: 7 }, body: '', version: 1, audio: 'comments/abcdefghijklmnop1234.webm' } } }])
    expect(q('[data-voice-reply-sent]')!.textContent).toBe('Sent to Sam')
  })
  it('record again goes back to the same button', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await press('[data-voice-reply-again]')
    expect(q('[data-reply-record]')!.getAttribute('aria-label')).toBe('Record your reply')
    expect(posts).toEqual([])
  })
  it('a refused save says why and keeps the take to send again', async () => {
    await mount()
    stateStatus = 403
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(q('[role="alert"]')!.textContent).toBe('replies are closed on this page')
    expect(q('[data-voice-reply-send]')).not.toBeNull()
  })
  it('asks for a first name only where the page requires one, and sends it', async () => {
    await mount({ requireName: true })
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    const input = q('input[name="by"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Robin')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(posts[0].body.value.by).toBe('Robin')
  })
  it('never says "comment"', async () => {
    await mount()
    expect(document.body.textContent).not.toMatch(/comment/i)
  })
})

describe('readable on the parchment (WCAG AA)', () => {
  it('text is 4.5:1 or better, controls 3:1 or better', () => {
    const t = REPLY_TOKENS
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    for (const [fg, bg] of [[t.ink, t.parchment], [t.muted, t.parchment], [t.ink, t.gold], [t.parchment, t.ink], [t.gold, t.ink], ['#8f1d12', t.parchment]]) expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    for (const [fg, bg] of [[t.ink, t.parchment], [t.goldEdge, t.parchment], [t.track, t.parchment]]) expect(contrastRatio(fg, bg), `${fg} against ${bg}`).toBeGreaterThanOrEqual(3)
  })
})

// the operator, 2026-11-25, iPhone Safari: "I'm unable to hear the recording that I recorded, and there
// was no waveforms that made me feel confident that my voice was being recorded."
describe('confidence that the voice was caught', () => {
  it('the reply asks for no live words, so nothing on an iPhone competes for the microphone', async () => {
    await mount()
    expect(hookOptions.transcribe).toBe(false)
  })
  it('a live level meter, on the same stream, while recording; its audio context closes on stop', async () => {
    await mount()
    await press('[data-reply-record]')
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    const meter = q('[data-reply-meter]')!
    expect(meter).not.toBeNull()
    expect(meter.querySelectorAll('[data-meter-bar]').length).toBeGreaterThan(0)
    expect(contexts[0].createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(contexts[0].resume).toHaveBeenCalled()
    await press('[data-reply-record]')
    expect(contexts[0].close).toHaveBeenCalled()
    expect(q('[data-reply-meter]')).toBeNull()
  })
  it('a take with sound draws its waveform and can be sent', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    expect(q('[data-reply-wave]')!.querySelectorAll('[data-wave-bar]').length).toBeGreaterThan(20)
    expect(q('[data-reply-silent]')).toBeNull()
    expect((q('[data-voice-reply-send]') as HTMLButtonElement).disabled).toBe(false)
  })
  for (const [what, prep] of [['silent', () => { take = new Float32Array(48000) }], ['undecodable', () => { decodeFails = true }]] as const) {
    it(`a ${what} take says so and cannot be sent`, async () => {
      prep()
      await mount()
      await press('[data-reply-record]')
      await press('[data-reply-record]')
      await settle()
      expect(q('[data-reply-silent]')!.textContent).toBe('We didn\'t catch any sound. Check that your microphone is allowed, then record again.')
      expect((q('[data-voice-reply-send]') as HTMLButtonElement).disabled).toBe(true)
      await press('[data-voice-reply-send]')
      expect(posts).toEqual([])
    })
  }
  it('play goes through the decoded buffer, in an audio context resumed inside the tap', async () => {
    const elementPlay = vi.fn()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: elementPlay })
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    await press('[data-reply-play]')
    const ctx = contexts.at(-1)!
    expect(ctx.resume).toHaveBeenCalled()
    expect(sources).toHaveLength(1)
    expect(sources[0].buffer).toMatchObject({ length: take.length })
    expect(sources[0].start).toHaveBeenCalled()
    expect(elementPlay).not.toHaveBeenCalled()
    await press('[data-reply-play]')
    expect(sources[0].stop).toHaveBeenCalled()
  })
  it('uploads exactly the recorded bytes', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    await settle()
    await press('[data-voice-reply-send]')
    await settle()
    const sent = (voice.upload.mock.calls.at(-1) as unknown as [{ blob: Blob }])[0].blob
    expect(sent.type).toBe('audio/webm')
    expect(sent.size).toBe(5)
  })
})
