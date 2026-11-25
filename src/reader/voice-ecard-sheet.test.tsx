// The reply sheet (Gary, 2026-11-25: "I think that the controls should sit above the letter or
// whatever. So it's more like a pop-up or something."). "Reply with your voice" opens a sheet over
// the card, in real screen pixels; the letter never shrinks, reflows or moves for it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let recording = false
let finish: ((m: { blob: Blob; mime: string }) => void) | null = null
vi.mock('./voice-recorder.js', async (orig) => ({
  ...(await orig<typeof import('./voice-recorder.js')>()),
  useVoiceRecording: ({ onStart, onStop }: { onStart?: () => void; onStop: (m: { blob: Blob; mime: string }) => void }) => ({
    supported: true, live: false, note: false, recording, elapsed: 0,
    start: async () => { recording = true; finish = onStop; onStart?.() },
    stop: () => { recording = false; finish?.({ blob: new Blob(['voice'], { type: 'audio/webm' }), mime: 'audio/webm' }) },
  }),
}))
import { VoiceEcard, type VoiceEcardProps } from './voice-ecard.js'
import { VOICE_REPLY_CSS, REPLY_SHEET_CSS } from './voice-reply.js'
import type { VoiceEcardTiming } from '../artifacts/voice-ecard.js'

const WORDS: VoiceEcardTiming[] = [
  { w: 'Dear', s: 4.0, e: 4.3 }, { w: 'Robin,', s: 4.35, e: 4.9, br: 1 },
  { w: 'Thank', s: 5.6, e: 5.9 }, { w: 'you.', s: 5.95, e: 6.4 },
]
const props: VoiceEcardProps = {
  rootId: 'voice-ecard-root', to: 'Robin', from: 'Sam', letter: 'Dear Robin,\n\nThank you.', words: WORDS,
  envelope: 'url("data:image/webp;base64,AA")', liner: 'none', paper: 'none', cover: 'https://cdn.example.com/wrap.webp',
  audio: 'https://cdn.example.com/card.m4a', media: 'card.m4a', foil: '#e7cb75', navy: '#09164d', face: 'Georgia', italic: true,
  title: 'Georgia', mark: true, reply: true, blockId: 'b-card-0123abcd', artifactId: 'card2345', version: 1, ownerName: 'Sam',
}

let roots: Root[] = []
let reducedMotion = false
function size(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: w })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: h })
}
function render(over: Partial<VoiceEcardProps> = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(<VoiceEcard {...props} {...over} />))
  return el
}
const q = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)
const phase = () => q('[data-voice-ecard]')!.getAttribute('data-phase')
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
/** The three timed phases, one at a time (each timer is set by the phase before it). */
const openAll = async () => { await advance(800); await advance(950); await advance(700) }
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
/** A finger: the pointer says touch, then the click lands. */
const tap = (el: Element | null) => act(() => {
  const down = new MouseEvent('pointerdown', { bubbles: true }) as MouseEvent & { pointerType: string }
  Object.defineProperty(down, 'pointerType', { value: 'touch' })
  el!.dispatchEvent(down)
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  reducedMotion = false
  size(1280, 800)
  document.body.innerHTML = ''
  window.matchMedia = ((m: string) => ({ matches: m.includes('reduce') ? reducedMotion : m.includes('hover: none') ? window.innerWidth < 768 : false, media: m, addEventListener() {}, removeEventListener() {} })) as any
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: function () { return Promise.resolve() } })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})


async function openCard(w = 1280, h = 800) {
  size(w, h)
  render()
  if (w < 768) { tap(q('.ve-letter')); tap(q('.ve-letter')) } else click(q('.ve-letter'))
  await openAll()
}
const letterLook = () => {
  const page = q<HTMLElement>('.ve-page')!, script = q<HTMLElement>('[data-voice-ecard-letter]')!
  return { font: script.style.fontSize, scriptZoom: script.style.zoom, pageZoom: page.style.zoom, panelInPage: !!page.querySelector('[data-voice-reply-panel]') }
}
const openSheet = async () => { click(q('[data-voice-reply]')); await advance(0) }

describe('the reply sheet', () => {
  beforeEach(() => { recording = false; Object.assign(URL, { createObjectURL: () => 'blob:take' }) })
  it('opens over the card, outside the scaled letter page, and the letter does not change at all', async () => {
    await openCard()
    const before = letterLook()
    await openSheet()
    const sheet = q('[data-reply-sheet]')!
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(q('[data-voice-ecard-page]')!.contains(sheet)).toBe(false)
    expect(q('[data-reply-dim]')).not.toBeNull()
    expect(letterLook()).toEqual(before)
    expect(before.panelInPage).toBe(false)
  })
  it('lives in screen pixels: nothing above it is scaled, so its controls are their full size at 844x390', async () => {
    await openCard(844, 390)
    await openSheet()
    for (let el: HTMLElement | null = q('[data-reply-sheet]'); el; el = el.parentElement) expect(el.style.transform, el.className).toBe('')
    // The control sizes it draws, in CSS pixels: every one 44 px or more.
    const css = VOICE_REPLY_CSS + REPLY_SHEET_CSS
    const px = (sel: string, prop: string) => {
      const at = css.indexOf(`${sel} {`)
      const rule = css.slice(at, css.indexOf('}', at))
      return at === -1 ? NaN : Number(new RegExp(`(?:^|[ ;{])${prop}:\\s*(\\d+)px`).exec(rule)?.[1])
    }
    expect(px('.ve-rr-record', 'width')).toBeGreaterThanOrEqual(44)
    expect(px('.ve-rr-play', 'width')).toBeGreaterThanOrEqual(44)
    expect(px('.ve-rr-send, .ve-rr-again', 'min-height')).toBeGreaterThanOrEqual(44)
    expect(px('.ve-sheet-close', 'width')).toBeGreaterThanOrEqual(44)
  })
  it('the letter stops when the sheet opens, focus moves in, and Escape closes the sheet but not the card', async () => {
    await openCard()
    const a = q<HTMLAudioElement>('audio')!
    const paused = vi.fn()
    Object.defineProperty(a, 'pause', { configurable: true, value: paused })
    click(q('.ve-listen'))
    q<HTMLButtonElement>('[data-voice-reply]')!.focus()
    await openSheet()
    expect(paused).toHaveBeenCalled()
    expect(q('[data-reply-sheet]')!.contains(document.activeElement)).toBe(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await advance(0)
    expect(q('[data-reply-sheet]')).toBeNull()
    expect(q('[data-voice-ecard]')!.getAttribute('data-phase')).toBe('open')
    expect(document.activeElement).toBe(q('[data-voice-reply]'))
  })
  it('the close control and the dim close it', async () => {
    await openCard()
    await openSheet()
    expect(q('[data-sheet-close]')!.getAttribute('aria-label')).toBe('Close')
    click(q('[data-sheet-close]')); await advance(0)
    expect(q('[data-reply-sheet]')).toBeNull()
    await openSheet()
    click(q('[data-reply-dim]')); await advance(0)
    expect(q('[data-reply-sheet]')).toBeNull()
  })
  it('a recorded take is kept: closing and reopening returns to it', async () => {
    await openCard()
    await openSheet()
    click(q('[data-reply-record]')); click(q('[data-reply-record]')); await advance(0)
    expect(q('[data-reply-play]')).not.toBeNull()
    click(q('[data-sheet-close]')); await advance(0)
    await openSheet()
    expect(q('[data-reply-play]')).not.toBeNull()
    expect(q('[data-voice-reply-send]')!.textContent).toBe('Send to Sam')
  })
  it('closing mid-recording stops and discards it: reopening is back at the record button', async () => {
    await openCard()
    await openSheet()
    click(q('[data-reply-record]')); await advance(0)
    expect(q('[data-reply-record]')!.getAttribute('aria-label')).toBe('Stop recording')
    click(q('[data-sheet-close]')); await advance(0)
    expect(recording).toBe(false)
    await openSheet()
    expect(q('[data-reply-play]')).toBeNull()
    expect(q('[data-reply-record]')!.getAttribute('aria-label')).toBe('Record your reply')
  })
})
