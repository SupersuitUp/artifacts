// The mic in the comment card, against stubbed MediaRecorder and SpeechRecognition: the live
// transcript filling the box, the host's transcript replacing it only while the box is unedited,
// both browsers' recording types, the path with no transcription at all, the three-minute cap,
// an anonymous reader's memo staying on the device, playback, and the theme.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CommentCard, type SavedMemo } from './comment-card.js'
import { CommentLayer } from './comment-layer.js'
import { LIVE_LINE, pickRecordingType, type VoiceHost } from './voice-recorder.js'
import type { DeviceAudio } from './device-audio.js'
import { deviceNotes } from './device-notes.js'
import { MAX_MEMO_MS } from '../artifacts/audio.js'

let supports: string[] = []
let recorders: FakeRecorder[] = []
let recognitions: FakeRecognition[] = []
class FakeRecorder {
  static isTypeSupported = (t: string) => supports.includes(t)
  mimeType: string
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_s: unknown, o?: { mimeType?: string }) { this.mimeType = o?.mimeType ?? 'audio/ogg'; recorders.push(this) }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['sound'], { type: this.mimeType }) })
    this.onstop?.()
  }
}
class FakeRecognition {
  continuous = false; interimResults = false; lang = ''
  onresult: ((e: unknown) => void) | null = null
  onerror: (() => void) | null = null
  started = false
  constructor() { recognitions.push(this) }
  start() { this.started = true }
  stop() { this.started = false }
  say(...parts: string[]) { this.onresult?.({ results: parts.map((p) => [{ transcript: p }]) }) }
}
const stopTrack = vi.fn()

function stubStorage() {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  })
}
/** A browser: `chrome` records webm with live recognition, `iphone` records mp4 with webkit's, `bare` neither recognises nor transcribes. */
function browser(kind: 'chrome' | 'iphone' | 'bare' | 'none') {
  recorders = []; recognitions = []
  supports = kind === 'chrome' ? ['audio/webm;codecs=opus', 'audio/mp4'] : kind === 'iphone' ? ['audio/mp4'] : []
  if (kind !== 'none') vi.stubGlobal('MediaRecorder', FakeRecorder)
  else vi.stubGlobal('MediaRecorder', undefined)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } })
  const w = window as unknown as Record<string, unknown>
  delete w.SpeechRecognition; delete w.webkitSpeechRecognition
  if (kind === 'chrome') w.SpeechRecognition = FakeRecognition
  if (kind === 'iphone') w.webkitSpeechRecognition = FakeRecognition
}
function fakeHost(opts: { transcript?: string | null; hold?: boolean } = {}) {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const host = {
    upload: vi.fn(async (m: { mime: string }, scope: string) => `${scope === 'comment' ? 'comments' : 'personal/dir'}/Memo1234567890abcd.${m.mime === 'audio/mp4' ? 'm4a' : 'webm'}`),
    transcribe: vi.fn(async () => { if (opts.hold) await gate; return opts.transcript === undefined ? 'the river runs north' : opts.transcript }),
  } satisfies VoiceHost
  return { host, release }
}

let root: Root | null = null
async function mount(el: React.ReactNode) {
  document.body.innerHTML = '<div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(el) })
}
afterEach(async () => {
  await act(async () => root?.unmount()); root = null
  vi.unstubAllGlobals(); vi.useRealTimers()
  const w = window as unknown as Record<string, unknown>
  delete w.SpeechRecognition; delete w.webkitSpeechRecognition
})
const mic = () => document.querySelector<HTMLButtonElement>('[data-voice-mic]')!
const box = () => document.querySelector('textarea')!
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box(), value)
    box().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const card = (host: VoiceHost | null, onSave = vi.fn(async () => null), extra: Record<string, unknown> = {}) =>
  <CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} voice={host} accent="var(--a-accent)" onSave={onSave} onCancel={() => {}} {...extra} />

describe('pickRecordingType', () => {
  it('asks for webm opus where it exists (Chrome), mp4 where only that does (iPhone), else the default', () => {
    expect(pickRecordingType((t) => ['audio/webm;codecs=opus', 'audio/mp4'].includes(t))).toBe('audio/webm;codecs=opus')
    expect(pickRecordingType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecordingType(() => false)).toBeUndefined()
  })
})

describe('the recorder in the card', () => {
  it('writes the live transcript into the box while you speak, and says so the first time', async () => {
    stubStorage(); browser('chrome')
    await mount(card(fakeHost().host))
    expect(document.querySelector('[data-voice-live-note]')!.textContent).toBe(LIVE_LINE)
    await act(async () => { mic().click() })
    await flush()
    expect(recognitions[0].started).toBe(true)
    expect(recognitions[0].continuous && recognitions[0].interimResults).toBe(true)
    await act(async () => { recognitions[0].say('the river ', 'runs north') })
    expect(box().value).toBe('the river runs north')
    // A second card, after that first use, does not repeat the line.
    await act(async () => root?.unmount())
    await mount(card(fakeHost().host))
    expect(document.querySelector('[data-voice-live-note]')).toBeNull()
  })

  it('on stop, the host transcript replaces an unedited box, and the save carries the memo and "host"', async () => {
    stubStorage(); browser('chrome')
    const { host } = fakeHost()
    const onSave = vi.fn<(b: string, s: boolean, m?: SavedMemo) => Promise<string | null>>(async () => null)
    await mount(card(host, onSave))
    await act(async () => { mic().click() }); await flush()
    await act(async () => { recognitions[0].say('the rivr runs') })
    await act(async () => { mic().click() }); await flush()
    expect(recorders[0].mimeType).toBe('audio/webm;codecs=opus')
    expect(host.upload).toHaveBeenCalledWith(expect.objectContaining({ mime: 'audio/webm' }), 'comment')
    expect(host.transcribe).toHaveBeenCalledWith('comments/Memo1234567890abcd.webm')
    expect(box().value).toBe('the river runs north')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    const [body, share, memo] = onSave.mock.calls[0]
    expect([body, share]).toEqual(['the river runs north', true])
    expect(memo!.transcript).toBe('host')
    expect(memo!.uploaded).toEqual({ scope: 'comment', path: 'comments/Memo1234567890abcd.webm' })
    expect(memo!.memo.blob.type).toBe('audio/webm')
  })

  it('an edit made before the host answers wins over the host transcript', async () => {
    stubStorage(); browser('chrome')
    const { host, release } = fakeHost({ hold: true })
    const onSave = vi.fn<(b: string, s: boolean, m?: SavedMemo) => Promise<string | null>>(async () => null)
    await mount(card(host, onSave))
    await act(async () => { mic().click() }); await flush()
    await act(async () => { recognitions[0].say('the rivr runs') })
    await act(async () => { mic().click() }); await flush()
    await type('The river, my words')
    await act(async () => { release() }); await flush()
    expect(box().value).toBe('The river, my words')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    expect(onSave.mock.calls[0][2]!.transcript).toBe('typed')
  })

  it('iPhone Safari: records audio/mp4 and live-transcribes with webkitSpeechRecognition', async () => {
    stubStorage(); browser('iphone')
    const { host } = fakeHost()
    await mount(card(host))
    await act(async () => { mic().click() }); await flush()
    expect(recorders[0].mimeType).toBe('audio/mp4')
    await act(async () => { recognitions[0].say('hello') })
    expect(box().value).toBe('hello')
    await act(async () => { mic().click() }); await flush()
    expect(host.upload).toHaveBeenCalledWith(expect.objectContaining({ mime: 'audio/mp4' }), 'comment')
  })

  it('with no live recognition and no host transcription, the memo is kept with an empty box and can be saved as audio', async () => {
    stubStorage(); browser('bare')
    const { host } = fakeHost({ transcript: null })
    const onSave = vi.fn<(b: string, s: boolean, m?: SavedMemo) => Promise<string | null>>(async () => null)
    await mount(card(host, onSave))
    expect(document.querySelector('[data-voice-live-note]')).toBeNull()
    await act(async () => { mic().click() }); await flush()
    await act(async () => { mic().click() }); await flush()
    expect(box().value).toBe('')
    expect(document.querySelector('[data-voice-kept]')!.textContent).toContain('Recording kept')
    const save = document.querySelector<HTMLButtonElement>('[data-comment-save]')!
    expect(save.disabled).toBe(false)
    await act(async () => { save.click() })
    expect(onSave.mock.calls[0][0]).toBe('')
    expect(onSave.mock.calls[0][2]!.transcript).toBeUndefined()
    expect(onSave.mock.calls[0][2]!.memo.mime).toBe('audio/ogg')
  })

  it('a browser that cannot record shows no mic at all', async () => {
    stubStorage(); browser('none')
    await mount(card(fakeHost().host))
    expect(document.querySelector('[data-voice-mic]')).toBeNull()
    expect(box()).not.toBeNull()
  })

  it('stops itself at three minutes', async () => {
    stubStorage(); browser('chrome')
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })
    await mount(card(fakeHost().host))
    await act(async () => { mic().click() }); await flush()
    expect(recorders[0].state).toBe('recording')
    await act(async () => { vi.advanceTimersByTime(MAX_MEMO_MS - 1000) })
    expect(recorders[0].state).toBe('recording')
    expect(mic().textContent).toContain('2:59')
    await act(async () => { vi.advanceTimersByTime(1000) }); await flush()
    expect(recorders[0].state).toBe('inactive')
    expect(stopTrack).toHaveBeenCalled()
  })

  it('draws with the page theme and the accent, never a colour of its own', async () => {
    stubStorage(); browser('chrome')
    await mount(card(fakeHost().host))
    await act(async () => { mic().click() }); await flush()
    await act(async () => { mic().click() }); await flush()
    const html = document.querySelector('[data-voice-recorder]')!.outerHTML + document.querySelector('[data-voice-kept]')!.outerHTML
    expect(html).toContain('var(--a-')
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|text-(white|black|gray|amber|red)/i)
  })
})

describe('memos in the comment layer', () => {
  const PAGE = '<div id="root"><p data-block="b-p-00000002">The river runs north, and the river floods.</p></div><div id="m"></div>'
  function stubFetch(shared: unknown[] = []) {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/state')) return new Response(JSON.stringify({ slots: { comments: { mine: [], shared } } }), { status: 200 })
      if (url.includes('/personal')) return new Response(JSON.stringify({ error: 'sign in', device: true }), { status: 401 })
      return new Response('{}', { status: 404 })
    }))
    return calls
  }
  async function mountLayer(props: Record<string, unknown>) {
    document.body.innerHTML = PAGE
    root = createRoot(document.getElementById('m')!)
    await act(async () => {
      root!.render(<CommentLayer artifactId="abc23456" rootId="root" ownerName="Robin Vale" comments="off" canShare={false} signedIn={false} isOwner={false} version={3} accent="#f80" ground="#000" {...props} />)
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
  async function openCard() {
    const p = document.querySelector('[data-block]')!.firstChild!
    const r = document.createRange(); r.setStart(p, 4); r.setEnd(p, 9)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(r)
    await act(async () => { document.getElementById('root')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-chip]')!.click() })
  }
  const memStore = () => {
    const m = new Map<string, Blob>()
    return { m, store: { put: vi.fn(async (k: string, b: Blob) => { m.set(k, b); return true }), get: vi.fn(async (k: string) => m.get(k) ?? null), remove: vi.fn(async (k: string) => void m.delete(k)) } satisfies DeviceAudio }
  }

  it('an anonymous personal memo stays on the device: into the audio store, nothing uploaded or transcribed', async () => {
    stubStorage(); browser('chrome'); const calls = stubFetch()
    const { host } = fakeHost()
    const { m, store } = memStore()
    await mountLayer({ voice: host, audioStore: store })
    await openCard()
    await act(async () => { mic().click() }); await flush()
    await act(async () => { recognitions[0].say('just for me') })
    await act(async () => { mic().click() }); await flush()
    expect(host.upload).not.toHaveBeenCalled()
    expect(host.transcribe).not.toHaveBeenCalled()
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() }); await flush()
    const notes = deviceNotes('abc23456')
    expect(notes).toHaveLength(1)
    expect(notes[0].value).toMatchObject({ body: 'just for me', transcript: 'browser' })
    expect(notes[0].value.audio).toMatch(/^device\/[A-Za-z0-9_-]+\.webm$/)
    expect(m.has(notes[0].value.audio!)).toBe(true)
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('a shared memo saves with its uploaded path, and the saved comment shows a play control', async () => {
    stubStorage(); browser('chrome')
    const anchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs' }
    const calls = stubFetch([{ id: 'c1', name: 'Sam', at: '2026-09-28T00:00:00Z', value: { anchor, body: '', version: 3, audio: 'comments/Memo1234567890abcd.webm' }, audioUrl: 'https://bucket.example.com/get/memo?sig=1' }])
    const { host } = fakeHost()
    await mountLayer({ voice: host, comments: 'anyone', canShare: true })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-pin]')!.click() })
    expect(document.querySelector('[data-comment-thread] [data-voice-play]')).not.toBeNull()
    await openCard()
    // The recorder sits in the portalled overlay, which carries the page's theme variables.
    expect(mic().closest('[data-comment-ui]')).not.toBeNull()
    await act(async () => { mic().click() }); await flush()
    await act(async () => { mic().click() }); await flush()
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() }); await flush()
    const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/state'))!
    expect(sent.body).toMatchObject({ slot: 'comments', op: 'append', value: { audio: 'comments/Memo1234567890abcd.webm', transcript: 'host', body: 'the river runs north' } })
    // Uploaded once, on stop, and reused at save.
    expect(host.upload).toHaveBeenCalledTimes(1)
  })

  it('on sign-in, a device memo is uploaded to the reader\'s account, the note names it there, and it leaves the device', async () => {
    stubStorage(); browser('bare')
    const anchor = { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs' }
    localStorage.setItem(`artifact-notes:${location.host}:abc23456`, JSON.stringify([{ id: 'd-1', at: '2026-09-28T00:00:00Z', value: { anchor, body: '', version: 3, audio: 'device/Memo1234567890abcd.webm' } }]))
    const { m, store } = memStore()
    m.set('device/Memo1234567890abcd.webm', new Blob(['sound'], { type: 'audio/webm' }))
    const posted: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/personal')) {
        if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)).value)
        return new Response(JSON.stringify({ notes: posted.map((v, i) => ({ id: `p${i}`, at: '2026-09-28T00:00:00Z', value: v })) }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }))
    const { host } = fakeHost()
    await mountLayer({ voice: host, audioStore: store, signedIn: true })
    await flush()
    expect(host.upload).toHaveBeenCalledWith(expect.objectContaining({ mime: 'audio/webm' }), 'personal')
    expect(posted).toEqual([expect.objectContaining({ audio: 'personal/dir/Memo1234567890abcd.webm' })])
    expect(deviceNotes('abc23456')).toEqual([])
    expect(m.size).toBe(0)
  })
})
