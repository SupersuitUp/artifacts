import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ArtifactReader, isUserScrollKey } from './artifact-reader.js'

const words = [
  { w: 'Your', s: 0, e: 0.3 },
  { w: 'best', s: 0.3, e: 0.6 },
  { w: 'attention', s: 0.6, e: 1.2 },
]
let root: Root | null = null
let audio: HTMLAudioElement
const played = vi.fn()

beforeEach(async () => {
  played.mockReset()
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: function (this: HTMLMediaElement) { played(this.currentTime); this.dispatchEvent(new Event('play')); return Promise.resolve() } })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')) } })
  Element.prototype.scrollIntoView = vi.fn()
  document.body.innerHTML = '<article id="page"><p>Your best attention</p></article><div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(<ArtifactReader src="/a.mp3" words={words} rootId="page" label="Freeda" accent="#f80" ground="#000" />) })
  audio = document.querySelector('audio')!
})
afterEach(async () => { await act(async () => root?.unmount()); root = null })

const word = (i: number) => document.querySelectorAll<HTMLSpanElement>('.artifact-word')[i]
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

describe('tapping a word', () => {
  it('when nothing is playing, offers Play from here instead of starting the audio', async () => {
    await click(word(2))
    expect(played).not.toHaveBeenCalled()
    const offer = document.querySelector<HTMLButtonElement>('[data-play-from-here]')!
    expect(offer.textContent).toContain('Play from here')
    await click(offer)
    expect(played).toHaveBeenCalledWith(0.6)
    expect(document.querySelector('[data-play-from-here]')).toBeNull()
  })
  it('while playing, jumps straight to the word with no bar in between', async () => {
    await act(async () => { void audio.play() })
    played.mockReset()
    await click(word(1))
    expect(audio.currentTime).toBe(0.3)
    expect(document.querySelector('[data-play-from-here]')).toBeNull()
  })
})

describe('scrolling while it plays', () => {
  it('stops following the voice when the reader scrolls, and offers a way back', async () => {
    await act(async () => { void audio.play() })
    expect(document.querySelector('[data-follow-voice]')).toBeNull()
    await act(async () => { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })) })
    const back = document.querySelector<HTMLButtonElement>('[data-follow-voice]')!
    expect(back).not.toBeNull()
    await click(back)
    expect(document.querySelector('[data-follow-voice]')).toBeNull()
  })
  it('a scroll while paused changes nothing', async () => {
    await act(async () => { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })) })
    expect(document.querySelector('[data-follow-voice]')).toBeNull()
  })
})

describe('isUserScrollKey', () => {
  it('counts the keys that scroll a page, and space only outside a text field', () => {
    for (const k of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) expect(isUserScrollKey(k, document.body)).toBe(true)
    expect(isUserScrollKey(' ', document.body)).toBe(true)
    expect(isUserScrollKey(' ', document.createElement('textarea'))).toBe(false)
    expect(isUserScrollKey('a', document.body)).toBe(false)
  })
})
