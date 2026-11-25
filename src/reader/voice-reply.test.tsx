// "Reply with your voice" on a voice eCard. Gary, 2026-11-25, on his iPhone: "It's hard to see the
// UI elements for playing your recording, and the record button becomes off-center when you click
// the record button." The reply's control sits in a fixed slot that never moves between idle,
// recording and recorded; the time and labels are navy and readable; playback is a real control.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let recording = false
let elapsed = 0
let finish: ((m: { blob: Blob; mime: string }) => void) | null = null
vi.mock('./voice-recorder.js', async (orig) => ({
  ...(await orig<typeof import('./voice-recorder.js')>()),
  // The recording, without a microphone: start marks it recording; stop hands back a memo.
  useVoiceRecording: ({ onStart, onStop }: { onStart?: () => void; onStop: (m: { blob: Blob; mime: string }) => void }) => ({
    supported: true, live: false, note: false, recording, elapsed,
    start: async () => { recording = true; finish = onStop; onStart?.() },
    stop: () => { recording = false; finish?.({ blob: new Blob(['voice'], { type: 'audio/webm' }), mime: 'audio/webm' }) },
  }),
}))
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
    expect([...slot.children].map((c) => c.getAttribute('data-reply-record') !== null ? 'button' : c.getAttribute('data-reply-under') !== null ? 'under' : c.getAttribute('data-reply-ring') !== null ? 'ring' : '?')).toEqual(['ring', 'button', 'under'])
  })
  it('the clock reads m:ss', () => {
    expect(replyClock(0)).toBe('0:00')
    expect(replyClock(1_400)).toBe('0:01')
    expect(replyClock(75_000)).toBe('1:15')
  })
})

describe('the recorded take', () => {
  it('a labelled play control that toggles, a progress bar and its times, then Send and Record again', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
    const play = q('[data-reply-play]')!
    expect(play.getAttribute('aria-label')).toBe('Play your reply')
    await press('[data-reply-play]')
    expect(play.getAttribute('aria-label')).toBe('Pause your reply')
    await press('[data-reply-play]')
    expect(play.getAttribute('aria-label')).toBe('Play your reply')
    expect(q('[role="progressbar"]')).not.toBeNull()
    expect(q('[data-reply-time]')!.textContent).toMatch(/^0:00 \/ \d:\d\d$/)
    expect(q('[data-voice-reply-send]')!.textContent).toBe('Send to Sam')
    expect(q('[data-voice-reply-again]')!.textContent).toBe('Record again')
  })
  it('sends the memo as a comment\'s recording, appended to the comments slot, and says "Sent to Sam"', async () => {
    await mount()
    await press('[data-reply-record]')
    await press('[data-reply-record]')
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
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(q('[role="alert"]')!.textContent).toBe('replies are closed on this page')
    expect(q('[data-voice-reply-send]')).not.toBeNull()
  })
  it('asks for a first name only where the page requires one, and sends it', async () => {
    await mount({ requireName: true })
    await press('[data-reply-record]')
    await press('[data-reply-record]')
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
    for (const [fg, bg] of [[t.ink, t.parchment], [t.muted, t.parchment], [t.ink, t.gold], [t.parchment, t.ink], [t.gold, t.ink]]) expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    for (const [fg, bg] of [[t.ink, t.parchment], [t.goldEdge, t.parchment], [t.track, t.parchment]]) expect(contrastRatio(fg, bg), `${fg} against ${bg}`).toBeGreaterThanOrEqual(3)
  })
})
