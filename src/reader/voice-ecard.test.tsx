// The voice eCard in a browser (jsdom): the phases on BlessOut's clock, Esc and the medallion back
// to idle, the geometry at a phone, a landscape phone and a desktop with the re-layout on rotation,
// the reduced-motion fade, the read-along off the recording's clock, the reply sheet, and the
// listen signal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VoiceEcard, type VoiceEcardProps } from './voice-ecard.js'
import { LISTENED } from './page-bridge.js'
import { REF_PAGE, REF_LETTER_FONT, closeSpot, letterFontPx, spreadGeom, type VoiceEcardTiming } from '../artifacts/voice-ecard.js'

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

describe('the opening, on BlessOut\'s clock', () => {
  it('idle → rising 800 → opening 950 → zooming 700 → open', async () => {
    render()
    expect(phase()).toBe('idle')
    click(q('.ve-letter'))
    expect(phase()).toBe('rising')
    await advance(799); expect(phase()).toBe('rising')
    await advance(1); expect(phase()).toBe('opening')
    expect(q('.ve-fold')!.className).toContain('is-open')
    await advance(949); expect(phase()).toBe('opening')
    await advance(1); expect(phase()).toBe('zooming')
    await advance(699); expect(phase()).toBe('zooming')
    await advance(1); expect(phase()).toBe('open')
    expect(q('[data-voice-ecard-page]')).not.toBeNull()
    expect(q('.ve-li')).toBeNull()
  })
  it('the scene recedes while the card flies, and the card art was warmed while it idled', async () => {
    const made: string[] = []
    vi.stubGlobal('Image', class { set src(v: string) { made.push(v) } })
    render({ inner: 'https://cdn.example.com/inner.webp' })
    expect(made).toEqual(['https://cdn.example.com/wrap.webp', 'https://cdn.example.com/inner.webp'])
    click(q('.ve-letter'))
    expect(q('.ve-hover')!.className).toContain('ve-receding')
  })
  it('Esc closes: closing for 450 ms, then idle with the envelope back', async () => {
    render()
    click(q('.ve-letter'))
    await openAll()
    expect(phase()).toBe('open')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(phase()).toBe('closing')
    expect(q('.ve-hover')!.className).toContain('ve-returning')
    await advance(449); expect(phase()).toBe('closing')
    await advance(1); expect(phase()).toBe('idle')
    expect(q('.ve-li')).not.toBeNull()
  })
  it('the medallion on the card\'s corner closes it too', async () => {
    render()
    click(q('.ve-letter'))
    await openAll()
    const btn = q<HTMLButtonElement>('button[aria-label="Close card"]')!
    const spot = closeSpot(spreadGeom({ vw: 1280, vh: 800 }))
    expect(parseFloat(btn.style.top)).toBeCloseTo(spot.top)
    expect(parseFloat(btn.style.left)).toBeCloseTo(spot.left)
    click(btn)
    await advance(450)
    expect(phase()).toBe('idle')
  })
  it('Enter on the envelope opens it from a keyboard', async () => {
    render()
    act(() => { q('.ve-li')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(phase()).toBe('rising')
  })
  it('reduced motion: straight to the open card, no flight, and a short fade back', async () => {
    reducedMotion = true
    render()
    click(q('.ve-letter'))
    expect(phase()).toBe('open')
    click(q('button[aria-label="Close card"]'))
    await advance(320)
    expect(phase()).toBe('idle')
  })
})

describe('desktop hover and phone tap', () => {
  it('a desktop says "Hover over me" and a click opens the card; a phone says "Tap me", and its first tap opens the flap, its second the card', async () => {
    render()
    expect(q('.ve-hover-text')!.textContent).toBe('Hover over me')
    for (const r of roots.splice(0)) act(() => r.unmount())
    document.body.innerHTML = ''
    size(390, 844)
    render()
    expect(q('.ve-hover-text')!.textContent).toBe('Tap me')
    tap(q('.ve-letter'))
    expect(phase()).toBe('idle')
    expect(q('.ve-li')!.className).toContain('is-open')
    tap(q('.ve-letter'))
    expect(phase()).toBe('rising')
  })
})

describe('geometry: one card, scaled as a unit', () => {
  const host = () => q<HTMLElement>('[data-voice-ecard-page]')!
  /** The letter page as drawn: its reference box, scaled from its top-left corner. */
  const drawn = () => {
    const h = host()
    const s = Number(/scale\(([\d.]+)\)/.exec(h.style.transform)?.[1])
    return { left: parseFloat(h.style.left), top: parseFloat(h.style.top), width: parseFloat(h.style.width) * s, height: parseFloat(h.style.height) * s, s }
  }
  const sizes: [number, number][] = [[844, 390], [390, 844], [932, 430], [1280, 800], [2000, 921]]
  for (const [w, h] of sizes) {
    it(`${w}x${h}: the letter page is the reference page scaled to fit, its type a fixed size inside it`, async () => {
      size(w, h)
      render()
      const press = w < 768 ? tap : click
      press(q('.ve-letter')); if (w < 768) press(q('.ve-letter'))
      await openAll()
      const g = spreadGeom({ vw: w, vh: h })
      const d = drawn()
      expect(host().style.width).toBe(`${REF_PAGE.w}px`)
      expect(host().style.height).toBe(`${REF_PAGE.h}px`)
      expect(d.s).toBeCloseTo(g.scale, 6)
      expect(d.left).toBeCloseTo(g.spineX)
      expect(d.top + d.height).toBeLessThanOrEqual(h)
      expect(d.left + d.width).toBeLessThanOrEqual(w)
      expect(d.width / d.height).toBeCloseTo(3 / 4, 2)
      // On screen the letter's type is the reference size times the scale, whatever the screen.
      expect(q<HTMLElement>('[data-voice-ecard-letter]')!.style.fontSize).toBe(`${REF_LETTER_FONT}px`)
      expect(REF_LETTER_FONT * d.s).toBeCloseTo(letterFontPx(g), 6)
      expect(!!q('.ve-tilt')).toBe(w < 768 && h > w)
    })
  }
  it('a rotation from 390x844 to 844x390 re-lays out to the whole spread and the hint goes', async () => {
    size(390, 844)
    render()
    tap(q('.ve-letter')); tap(q('.ve-letter'))
    await openAll()
    expect(q('.ve-tilt')).not.toBeNull()
    size(844, 390)
    act(() => { window.dispatchEvent(new Event('orientationchange')) })
    await advance(900)
    const g = spreadGeom({ vw: 844, vh: 390 })
    expect(drawn().left).toBe(422)
    expect(drawn().s).toBeCloseTo(g.scale, 6)
    expect(q('.ve-tilt')).toBeNull()
  })
})

describe('the letter on the open card', () => {
  async function opened(over: Partial<VoiceEcardProps> = {}) {
    render(over)
    click(q('.ve-letter'))
    await openAll()
  }
  it('is the timings\' words, in their paragraphs, inside the comment root', async () => {
    await opened()
    const letter = q('#voice-ecard-root [data-voice-ecard-letter]')!
    expect([...letter.querySelectorAll('p')].map((p) => p.textContent!.trim())).toEqual(['Dear Robin,', 'Thank you.'])
    expect(q('#voice-ecard-root [data-block="b-card-0123abcd"]')).not.toBeNull()
  })
  it('the sign-off breaks after its comma, on the card and in the envelope\'s peek, every word still timed', async () => {
    const words: VoiceEcardTiming[] = [...WORDS.slice(0, 3), { w: 'you.', s: 5.95, e: 6.4, br: 1 }, { w: 'With', s: 7, e: 7.2 }, { w: 'love,', s: 7.25, e: 7.6 }, { w: 'Sam.', s: 7.7, e: 8 }]
    render({ words })
    expect(q('.ve-preview')!.textContent).toBe('Dear Robin,\nThank you.\nWith love,\nSam.')
    click(q('.ve-letter'))
    await openAll()
    const last = [...document.querySelectorAll('[data-voice-ecard-letter] p')].at(-1)!
    expect(last.innerHTML).toMatch(/love, <\/span><br data-letter-break="true"><span[^>]*data-word="6"/)
    expect([...document.querySelectorAll('.ve-word')].map((w) => w.getAttribute('data-word'))).toEqual(['0', '1', '2', '3', '4', '5', '6'])
  })
  it('lights the word at the recording\'s time, said words in full ink, the rest faded', async () => {
    await opened()
    const a = q<HTMLAudioElement>('audio')!
    expect(a.getAttribute('data-artifact-media')).toBe('card.m4a')
    let t = 0
    Object.defineProperty(a, 'currentTime', { configurable: true, get: () => t, set: (v) => { t = v } })
    click(q('.ve-listen'))
    const states = () => [...document.querySelectorAll('.ve-word')].map((w) => w.className.replace('ve-word', '').trim())
    t = 4.5; await advance(20)
    expect(states()).toEqual(['ve-said', 've-saying', 've-coming', 've-coming'])
    t = 5.7; await advance(20)
    expect(states()).toEqual(['ve-said', 've-said', 've-saying', 've-coming'])
  })
  it('tells the quiet view once when the play reaches the last word', async () => {
    await opened()
    const heard: unknown[] = []
    window.addEventListener(LISTENED, (e) => heard.push((e as CustomEvent).detail))
    const a = q<HTMLAudioElement>('audio')!
    let t = 0
    Object.defineProperty(a, 'currentTime', { configurable: true, get: () => t, set: (v) => { t = v } })
    click(q('.ve-listen'))
    t = 5.0; await advance(20)
    expect(heard).toEqual([])
    t = 6.0; await advance(40)
    expect(heard).toEqual([{ media: 'card.m4a' }])
  })
  it('"Reply with your voice" stops the voice and opens the reply sheet over the card: no comment card', async () => {
    await opened()
    const a = q<HTMLAudioElement>('audio')!
    const paused = vi.fn()
    Object.defineProperty(a, 'pause', { configurable: true, value: paused })
    click(q('.ve-listen'))
    click(q('[data-voice-reply]'))
    expect(paused).toHaveBeenCalled()
    expect(q('[data-reply-sheet] [data-voice-reply-panel]')).not.toBeNull()
    expect(q('[data-voice-ecard-page] [data-voice-reply-panel]')).toBeNull()
    expect(q('textarea')).toBeNull()
    expect(document.querySelector('[data-comment-layer], [data-comment-pin], [data-comment-button]')).toBeNull()
    expect(q('[data-reply-sheet]')!.textContent).not.toMatch(/comment/i)
  })
  it('no reply control when the page takes no comments; no Supersuit line with mark: false', async () => {
    await opened({ reply: false, mark: false })
    expect(q('[data-voice-reply]')).toBeNull()
    expect(document.body.textContent).not.toContain('Made with Supersuit')
  })
  it('the closed envelope says "Made with Supersuit", linking to supersuit.co', () => {
    render()
    expect(q<HTMLAnchorElement>('.ve-made')!.href).toBe('https://supersuit.co/')
  })
  it('draws the brand seal on the flap when it has one', () => {
    render({ seal: <svg data-test-mark /> })
    expect(q('.ve-seal [data-test-mark]')).not.toBeNull()
  })
})
