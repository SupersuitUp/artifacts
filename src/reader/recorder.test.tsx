// The recorder in a browser (jsdom): it opens at the first person with no take, a take is saved
// (raw, then the mix) before it moves on, a failed upload keeps the take in hand, and Redo starts over.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
vi.mock('./voice-recorder.js', () => ({
  // The microphone, as a button: a press is a finished recording.
  VoiceRecorder: ({ onStart, onStop }: { onStart?: () => void; onStop: (m: { blob: Blob; mime: string }) => void }) => (
    <button type="button" data-fake-mic onClick={() => { onStart?.(); onStop({ blob: new Blob(['voice'], { type: 'audio/webm' }), mime: 'audio/webm' }) }}>mic</button>
  ),
  AudioPlay: ({ src }: { src: string }) => <span data-play={src} />,
}))
import { Recorder, type RecorderProps } from './recorder.js'
import type { RecordBatch } from '../artifacts/record-store.js'

const batch: RecordBatch = {
  id: 'abcdefgh23', title: 'Thanksgiving', music: 'https://cdn.example.com/bed.mp3', createdAt: '2026-11-24T00:00:00Z', order: ['sam', 'dana', 'lee'],
  entries: {
    sam: { slug: 'sam', name: 'Sam', note: 'The year.', status: 'recorded', raw: 'private:sam-raw.webm' },
    dana: { slug: 'dana', name: 'Dana', note: 'The move.', status: 'waiting' },
    lee: { slug: 'lee', name: 'Lee', note: 'The dinners.', status: 'waiting' },
  },
}
let root: Root | null = null
const calls: { url: string; method: string; body?: unknown }[] = []
let failRaw = false
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  calls.length = 0
  failRaw = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method ?? 'GET', body })
    if (url.startsWith('https://storage.example.com')) return new Response(null, { status: failRaw ? 500 : 200 })
    if (body && !body.done) return new Response(JSON.stringify({ uploadUrl: 'https://storage.example.com/put', headers: {} }), { status: 201 })
    return new Response(JSON.stringify({ entry: { [body.kind]: `private:${body.kind}`, status: 'recorded' } }), { status: 200 })
  }))
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2]).buffer } })
  vi.stubGlobal('Audio', class { onerror?: () => void; constructor() { setTimeout(() => this.onerror?.(), 0) } })
  Object.assign(URL, { createObjectURL: () => 'blob:take' })
})
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals() })

async function mount(mix = vi.fn(async () => ({ wav: new Blob(['mix'], { type: 'audio/wav' }), voiceDelay: 4, seconds: 3 })), bed?: { url: string; startAt: number }, tighten?: RecorderProps['tighten']) {
  document.body.innerHTML = '<div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(<Recorder batch={batch} mix={mix} bed={bed} tighten={tighten} />) })
  return mix
}
const q = (s: string) => document.querySelector<HTMLElement>(s)
const press = async (s: string) => { await act(async () => { q(s)!.click(); await vi.advanceTimersByTimeAsync(0) }) }

describe('the recorder', () => {
  it('opens at the first person with no take, with their name and note', async () => {
    await mount()
    expect(q('[data-recorder-person]')!.getAttribute('data-recorder-person')).toBe('dana')
    expect(q('[data-recorder-note]')!.textContent).toBe('The move.')
    expect(q('[data-recorder-count]')!.textContent).toBe('1 of 3 recorded')
  })
  it('one tap records, one tap saves the raw take then the mix, and it moves to the next person', async () => {
    const mix = await mount()
    await press('[data-fake-mic]')
    expect(q('[data-recorder-save]')).not.toBeNull()
    await press('[data-recorder-save]')
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const posts = calls.filter((c) => c.method === 'POST').map((c) => [c.url, c.body])
    expect(posts).toEqual([
      ['/api/record/abcdefgh23/dana/take', { kind: 'raw', type: 'audio/webm', digest: 'deadbeef' }],
      ['/api/record/abcdefgh23/dana/take', { kind: 'raw', type: 'audio/webm', digest: 'deadbeef', done: true }],
      ['/api/record/abcdefgh23/dana/take', { kind: 'mixed', type: 'audio/wav', digest: 'deadbeef' }],
      ['/api/record/abcdefgh23/dana/take', { kind: 'mixed', type: 'audio/wav', digest: 'deadbeef', done: true, voiceDelay: 4, seconds: 3 }],
    ])
    expect(mix).toHaveBeenCalledWith(expect.any(Blob), 'https://cdn.example.com/bed.mp3', expect.objectContaining({ musicStart: 0 }))
    expect(q('[data-recorder-saved]')!.textContent).toBe('Saved for Dana')
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(q('[data-recorder-person]')!.getAttribute('data-recorder-person')).toBe('lee')
    expect(q('[data-recorder-count]')!.textContent).toBe('2 of 3 recorded')
  })
  it('a catalog bed the page resolved plays from its own address, from the part of the song the catalog names', async () => {
    const mix = await mount(undefined, { url: 'https://media.example.com/music/hilltoptrio_silent-night.wav', startAt: 88 })
    await press('[data-fake-mic]')
    await press('[data-recorder-save]')
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(mix).toHaveBeenCalledWith(expect.any(Blob), 'https://media.example.com/music/hilltoptrio_silent-night.wav', expect.objectContaining({ musicStart: 88, voiceDelay: 4 }))
  })
  it('the take is tightened before review: what plays is what is sent, and the mix does not tighten it twice', async () => {
    Object.assign(URL, { createObjectURL: (b: Blob) => `blob:${b.type}` })
    const tighten = vi.fn(async () => ({ wav: new Blob(['tight'], { type: 'audio/x-tight' }), segments: [{ start: 1.75, end: 3.3 }], seconds: 1.55, rawSeconds: 6 }))
    const mix = await mount(undefined, undefined, tighten)
    await press('[data-fake-mic]')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(tighten).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ tighten: true }))
    expect(q('[data-play]')!.getAttribute('data-play')).toBe('blob:audio/x-tight')
    await press('[data-recorder-save]')
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const raw = calls.find((c) => c.method === 'POST' && (c.body as { kind?: string }).kind === 'raw')
    expect(raw?.body).toMatchObject({ type: 'audio/x-tight' })
    const [voice, , settings] = mix.mock.calls[0] as unknown as [Blob, string, { tighten: boolean }]
    expect(voice.type).toBe('audio/x-tight')
    expect(settings.tighten).toBe(false)
  })
  it('a take with no speech is not offered for saving: it says so and goes back to the microphone', async () => {
    const tighten = vi.fn(async () => ({ silent: true as const }))
    await mount(undefined, undefined, tighten)
    await press('[data-fake-mic]')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(q('[data-recorder-save]')).toBeNull()
    expect(q('[role="alert"]')!.textContent).toBe("We didn't catch any sound. Record again.")
    expect(q('[data-recorder-mic]')).not.toBeNull()
  })
  it('an upload that fails keeps the take in hand to save again, and moves nowhere', async () => {
    await mount()
    failRaw = true
    await press('[data-fake-mic]')
    await press('[data-recorder-save]')
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(q('[role="alert"]')!.textContent).toContain('did not upload')
    expect(q('[data-recorder-save]')).not.toBeNull()
    expect(q('[data-recorder-person]')!.getAttribute('data-recorder-person')).toBe('dana')
  })
  it('Redo drops the take and goes back to the microphone', async () => {
    await mount()
    await press('[data-fake-mic]')
    await press('[data-recorder-redo]')
    expect(q('[data-fake-mic]')).not.toBeNull()
    expect(calls).toEqual([])
  })
  it('a person already recorded plays their take and can be redone', async () => {
    await mount()
    await press('[aria-label="Sam, recorded"]')
    expect(q('[data-recorder-recorded] [data-play]')!.getAttribute('data-play')).toBe('/api/record/abcdefgh23/sam/take?kind=raw')
    await press('[data-recorder-redo]')
    expect(q('[data-fake-mic]')).not.toBeNull()
  })
})
