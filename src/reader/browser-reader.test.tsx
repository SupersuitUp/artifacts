import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserReader } from './browser-reader.js'
import { ArtifactReader, wrapWords } from './artifact-reader.js'

type Utt = {
  text: string
  rate: number
  onboundary: ((e: { name: string; charIndex: number }) => void) | null
  onend: (() => void) | null
}

let spoken: Utt[]
let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }
let root: Root | null

function installSpeech() {
  spoken = []
  synth = {
    speak: vi.fn((u: Utt) => { spoken.push(u) }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }
  ;(window as any).speechSynthesis = synth
  ;(globalThis as any).SpeechSynthesisUtterance = class {
    text: string
    rate = 1
    onboundary = null
    onend = null
    constructor(text: string) { this.text = text }
  }
}

const PAGE = `
  <div id="page">
    <h1>A title</h1>
    <p data-nospeak>Version 3</p>
    <p>One two. Three four five.</p>
  </div>
  <div id="mount"></div>`

async function mount() {
  root = createRoot(document.getElementById('mount')!)
  await act(async () => {
    root!.render(<BrowserReader rootId="page" accent="#f80" ground="#000" />)
  })
}

const spans = () => Array.from(document.querySelectorAll<HTMLSpanElement>('#page .artifact-word'))
const lit = () => Array.from(document.querySelectorAll('.artifact-word-lit')).map((e) => e.textContent)
const play = () => act(() => { document.querySelector<HTMLButtonElement>('[aria-label="Play narration"]')!.click() })

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = PAGE
  root = null
})
afterEach(() => {
  act(() => root?.unmount())
  delete (window as any).speechSynthesis
})

describe('BrowserReader', () => {
  it('shows nothing, and wraps nothing, when the browser has no speechSynthesis', async () => {
    delete (window as any).speechSynthesis
    await mount()
    // The mount is there (server markup and first client render agree) but hidden and empty.
    // It must NOT carry data-artifact-player: the popovers measure that element to clear the bar.
    expect(document.querySelector('[data-artifact-reader="browser"]')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('[data-artifact-player]')).toBeNull()
    expect(document.querySelector('#mount button')).toBeNull()
    expect(spans()).toHaveLength(0)
  })

  it('play speaks the first sentence, headings as their own sentence, and nothing marked data-nospeak', async () => {
    installSpeech()
    await mount()
    expect(document.querySelector('[data-artifact-reader="browser"]')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('[data-artifact-player]')).not.toBeNull()
    expect(document.querySelector('#mount')!.textContent).toContain('Read aloud by your browser')
    await play()
    expect(spoken.map((u) => u.text)).toEqual(['A title'])
    expect(spans().map((s) => s.textContent)).not.toContain('Version')
  })

  it('a word-boundary event lights the word it names, and onend moves on to the next sentence', async () => {
    installSpeech()
    await mount()
    await play()
    act(() => spoken[0].onend!())
    expect(spoken[1].text).toBe('One two.')
    act(() => spoken[1].onboundary!({ name: 'word', charIndex: 4 }))
    expect(lit()).toEqual(['two.'])
    act(() => spoken[1].onboundary!({ name: 'sentence', charIndex: 0 }))
    expect(lit()).toEqual(['two.'])
    act(() => spoken[1].onend!())
    expect(spoken[2].text).toBe('Three four five.')
    act(() => spoken[2].onend!())
    expect(spoken).toHaveLength(3)
    expect(lit()).toEqual([])
  })

  it('clicking a word cancels and speaks from that word, and the old utterance ending is ignored', async () => {
    installSpeech()
    await mount()
    await play()
    const four = spans().find((s) => s.textContent === 'four')!
    act(() => { four.click() })
    expect(synth.cancel).toHaveBeenCalled()
    const from = spoken[spoken.length - 1]
    expect(from.text).toBe('four five.')
    act(() => from.onboundary!({ name: 'word', charIndex: 5 }))
    expect(lit()).toEqual(['five.'])
    const n = spoken.length
    act(() => spoken[0].onend!())
    expect(spoken).toHaveLength(n)
  })

  it('pause and resume go to the engine; the speed button restarts the current word at the new rate', async () => {
    installSpeech()
    await mount()
    await play()
    act(() => { document.querySelector<HTMLButtonElement>('[aria-label="Pause narration"]')!.click() })
    expect(synth.pause).toHaveBeenCalled()
    await play()
    expect(synth.resume).toHaveBeenCalled()
    act(() => { document.querySelector<HTMLButtonElement>('[aria-label="Playback speed"]')!.click() })
    const last = spoken[spoken.length - 1]
    expect(last.rate).toBe(1.25)
    expect(last.text).toBe('A title')
  })

  it('stops speaking when it unmounts', async () => {
    installSpeech()
    await mount()
    await play()
    synth.cancel.mockClear()
    act(() => root!.unmount())
    root = null
    expect(synth.cancel).toHaveBeenCalled()
  })
})

describe('wrapping words once', () => {
  it('a second wrap of the same page returns the same spans instead of nesting new ones', () => {
    const first = wrapWords(document.getElementById('page')!)
    const second = wrapWords(document.getElementById('page')!)
    expect(second).toEqual(first)
    expect(document.querySelectorAll('.artifact-word .artifact-word')).toHaveLength(0)
  })
  it('the audio reader and the browser reader mounted on one page do not double-wrap it', async () => {
    installSpeech()
    root = createRoot(document.getElementById('mount')!)
    await act(async () => {
      root!.render(
        <>
          <ArtifactReader src="x.mp3" words={[{ w: 'A', s: 0, e: 1 }]} rootId="page" label="Narrated" accent="#f80" ground="#000" />
          <BrowserReader rootId="page" accent="#f80" ground="#000" />
        </>,
      )
    })
    expect(document.querySelectorAll('.artifact-word .artifact-word')).toHaveLength(0)
    expect(spans().map((s) => s.textContent)).toEqual(['A', 'title', 'One', 'two.', 'Three', 'four', 'five.'])
  })
})
