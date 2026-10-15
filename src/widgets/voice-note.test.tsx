import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from '../artifacts/render.js'

// A voice note in a page: the clip plays inside the letter, its own words light up as they are
// spoken, a tapped word seeks there, and the page's narration never reads it.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOTE = [
  'Dear family,',
  '',
  '![Robin, to the family](https://cdn.example.com/x/hello.abc12345.m4a)',
  '',
  '```transcript',
  '0.00 0.60 Hello!',
  '0.80 1.10 I',
  '1.10 1.30 hope',
  '',
  '2.00 2.40 Love,',
  '2.40 2.90 Robin',
  '```',
  '',
  'After the note.',
].join('\n')

const html = (md: string) => renderToStaticMarkup(<ArtifactMarkdown markdown={md} />)

describe('the voice note on the page', () => {
  it('draws one keepsake: caption, a custom control, the transcript as paragraphs, and no code block', () => {
    const out = html(NOTE)
    expect(out).toContain('data-artifact-voicenote')
    expect(out).toContain('Robin, to the family')
    expect(out).not.toContain('<pre')
    expect(out).not.toContain('0.80 1.10')
    // The transcript reads as text, one paragraph per blank-line group.
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const note = doc.querySelector('[data-artifact-voicenote]')!
    expect(note.querySelectorAll('[data-vn-paragraph]')).toHaveLength(2)
    expect([...note.querySelectorAll('.vn-word')].map((w) => w.textContent)).toEqual(['Hello!', 'I', 'hope', 'Love,', 'Robin'])
    // The narration skips it: the reader hears Robin, not a robot reading Robin.
    expect(note.hasAttribute('data-nospeak')).toBe(true)
    // The comment anchor the audio line had is kept.
    expect(note.getAttribute('data-block')).toMatch(/^b-img-/)
  })
  it('plays on iPhone: no autoplay, nothing fetched on open, inline, tracked by name, no native bar', () => {
    const doc = new DOMParser().parseFromString(html(NOTE), 'text/html')
    const audio = doc.querySelector('[data-artifact-voicenote] audio')!
    expect(audio.getAttribute('src')).toBe('https://cdn.example.com/x/hello.abc12345.m4a')
    expect(audio.getAttribute('data-artifact-media')).toBe('hello.abc12345.m4a')
    expect(audio.getAttribute('preload')).toBe('none')
    expect(audio.hasAttribute('playsinline')).toBe(true)
    expect(audio.hasAttribute('autoplay')).toBe(false)
    expect(audio.hasAttribute('controls')).toBe(false)
    const button = doc.querySelector('[data-artifact-voicenote] button')!
    expect(button.getAttribute('aria-label')).toBe('Play voice note: Robin, to the family')
    const seek = doc.querySelector('[data-artifact-voicenote] input[type="range"]')!
    expect(seek.getAttribute('aria-label')).toBe('Seek')
  })
  it('an audio line with no transcript renders exactly as it did before voice notes', () => {
    expect(html('![Hello from a friend](https://cdn.example.com/x/hello.abc12345.m4a)\n\nAfter.')).toBe(
      '<div class="break-words text-[17px] text-[color:var(--a-body)]"><p data-block="b-img-be0e7bc4" class="my-4 leading-relaxed"><span class="my-6 block rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-surface)] px-4 py-3"><span class="mb-2 block text-sm text-[color:var(--a-strong)]">Hello from a friend</span><span class="block"><audio src="https://cdn.example.com/x/hello.abc12345.m4a" aria-label="Hello from a friend" data-artifact-audio data-artifact-media="hello.abc12345.m4a" controls preload="none" class="block w-full"></audio></span></span></p>\n<p data-block="b-p-ca8bee5b" class="my-4 leading-relaxed">After.</p></div>',
    )
  })
  it('a caption with markup in it is text, never markup', () => {
    expect(html(NOTE.replace('Robin, to the family', 'a <b>x</b>'))).not.toContain('<b>x</b>')
  })
})

describe('the voice note in a browser', () => {
  let root: Root
  let host: HTMLDivElement
  let play: ReturnType<typeof vi.fn>
  beforeEach(() => {
    play = vi.fn(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const mount = () => act(() => root.render(<ArtifactMarkdown markdown={NOTE} />))
  const audio = () => host.querySelector<HTMLAudioElement>('[data-artifact-voicenote] audio')!
  const words = () => [...host.querySelectorAll<HTMLSpanElement>('.vn-word')]
  const at = (t: number) => {
    Object.defineProperty(audio(), 'readyState', { configurable: true, value: 4 })
    audio().currentTime = t
    act(() => { audio().dispatchEvent(new Event('timeupdate')) })
  }

  it('before it plays, every word reads normally and none is lit', () => {
    mount()
    expect(words().some((w) => w.classList.contains('vn-word-lit') || w.classList.contains('vn-ahead'))).toBe(false)
  })
  it('lights the word being spoken, keeps spoken words normal and mutes the words to come', () => {
    mount()
    act(() => { host.querySelector<HTMLButtonElement>('[data-artifact-voicenote] button')!.click() })
    expect(play).toHaveBeenCalled()
    at(1.2)
    const ws = words()
    expect(ws[2].classList.contains('vn-word-lit')).toBe(true)
    expect(ws.filter((w) => w.classList.contains('vn-word-lit'))).toHaveLength(1)
    expect(ws[0].classList.contains('vn-ahead')).toBe(false)
    expect(ws[1].classList.contains('vn-ahead')).toBe(false)
    expect(ws[3].classList.contains('vn-ahead')).toBe(true)
    expect(ws[4].classList.contains('vn-ahead')).toBe(true)
    at(2.5)
    expect(words()[4].classList.contains('vn-word-lit')).toBe(true)
    expect(words()[3].classList.contains('vn-ahead')).toBe(false)
  })
  it('a tapped word seeks there and plays', () => {
    mount()
    Object.defineProperty(audio(), 'readyState', { configurable: true, value: 4 })
    act(() => { words()[3].click() })
    expect(audio().currentTime).toBe(2)
    expect(play).toHaveBeenCalled()
  })
  it('a tapped word before the clip has loaded seeks once it can', () => {
    mount()
    Object.defineProperty(audio(), 'readyState', { configurable: true, value: 0 })
    act(() => { words()[4].click() })
    expect(play).toHaveBeenCalled()
    act(() => { audio().dispatchEvent(new Event('loadedmetadata')) })
    expect(audio().currentTime).toBe(2.4)
  })
  it('the button names what it will do', () => {
    mount()
    const button = host.querySelector<HTMLButtonElement>('[data-artifact-voicenote] button')!
    act(() => { button.click() })
    expect(button.getAttribute('aria-label')).toBe('Pause voice note: Robin, to the family')
  })
})
