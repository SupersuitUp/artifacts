// "Reply with your voice" on a voice eCard (Gary, 2026-11-25: "Remove comment feature methinks ya?"):
// the one way to answer. It opens straight into the recorder, uploads the memo as a comment's
// recording, and appends it to the page's comments slot, the record the owner's summary reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
vi.mock('./voice-recorder.js', () => ({
  VoiceRecorder: ({ onStart, onStop }: { onStart?: () => void; onStop: (m: { blob: Blob; mime: string }) => void }) => (
    <button type="button" data-fake-mic onClick={() => { onStart?.(); onStop({ blob: new Blob(['voice'], { type: 'audio/webm' }), mime: 'audio/webm' }) }}>mic</button>
  ),
  AudioPlay: ({ src }: { src: string }) => <span data-play={src} />,
}))
import { VoiceReply } from './voice-reply.js'

let root: Root | null = null
const posts: { url: string; body: any }[] = []
let stateStatus = 200
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  posts.length = 0
  stateStatus = 200
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(stateStatus === 200 ? { entries: [] } : { error: 'comments are closed on this page' }), { status: stateStatus })
  }))
  Object.assign(URL, { createObjectURL: () => 'blob:take' })
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

describe('Reply with your voice', () => {
  it('opens straight into the recorder: no comment card, no thread, no "Comment"', async () => {
    await mount()
    expect(q('[data-fake-mic]')).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/comment/i)
    expect(q('textarea')).toBeNull()
  })
  it('records, then sends: the memo uploads as a comment\'s recording and is appended to the comments slot', async () => {
    await mount()
    await press('[data-fake-mic]')
    expect(q('[data-play]')).not.toBeNull()
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(voice.upload).toHaveBeenCalledWith(expect.objectContaining({ mime: 'audio/webm' }), 'comment')
    expect(posts).toEqual([{ url: '/api/artifacts/card2345/state', body: { slot: 'comments', op: 'append', value: { anchor: { kind: 'time', block: 'b-card-0123abcd', at: 7 }, body: '', version: 1, audio: 'comments/abcdefghijklmnop1234.webm' } } }])
    expect(q('[data-voice-reply-sent]')!.textContent).toBe('Sent. Sam will hear it.')
  })
  it('record again drops the take', async () => {
    await mount()
    await press('[data-fake-mic]')
    await press('[data-voice-reply-again]')
    expect(q('[data-fake-mic]')).not.toBeNull()
    expect(posts).toEqual([])
  })
  it('a refused save says why and keeps the take to send again', async () => {
    await mount()
    stateStatus = 403
    await press('[data-fake-mic]')
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(q('[role="alert"]')!.textContent).toBe('comments are closed on this page')
    expect(q('[data-voice-reply-send]')).not.toBeNull()
  })
  it('asks for a first name only where the page requires one, and sends it', async () => {
    await mount({ requireName: true })
    await press('[data-fake-mic]')
    const input = q('input[name="by"]') as HTMLInputElement
    expect(input).not.toBeNull()
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'Robin')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press('[data-voice-reply-send]')
    await act(async () => { await Promise.resolve() })
    expect(posts[0].body.value.by).toBe('Robin')
  })
})
