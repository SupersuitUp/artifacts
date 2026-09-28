'use client'

// Read-along for a page with no recorded narration: the browser's own voice (speechSynthesis)
// reads the same word spans the recorded reader lights, and its word-boundary events light them.
// It sounds worse than a recorded narrator and sends nothing anywhere.
//
// One utterance per sentence (see speech-plan.ts). Safari's boundary charIndex drifts on long
// passages; every new utterance restarts it at zero against offsets we know, so a drift cannot
// outlast the sentence it began in. Every utterance carries the generation it was spoken in, and
// an event from an older generation (a sentence cancelled by a click, a seek or a speed change,
// whose end or error the engine still reports) is ignored.
//
// The mount is rendered hidden and empty on the server and on the first client render, so the
// markup always hydrates; it shows only once the browser is known to have speechSynthesis. It
// never carries data-artifact-player while hidden, because the popovers measure that element to
// keep clear of the bar, and a hidden element measures as the whole screen.
import { useEffect, useRef, useState } from 'react'
import { BLOCK, seekableWord, wrapWords } from './artifact-reader.js'
import { nextRate, PlayerBar } from './player-bar.js'
import { fromWord, planSentences, wordAt, type Sentence } from './speech-plan.js'

export const BROWSER_READER_LABEL = 'Read aloud by your browser'

function spokenWords(spans: HTMLSpanElement[]): { words: string[]; starts: Set<number> } {
  const words: string[] = []
  const starts = new Set<number>()
  let prevBlock: Element | null = null
  spans.forEach((span, i) => {
    // Punctuation glued on across an element edge ("**bold**.") is a tail, not a word; it is
    // spoken with the word it follows, which is also what lets it end a sentence.
    const tail = span.nextSibling instanceof HTMLElement && span.nextSibling.classList.contains('artifact-word-tail') ? span.nextSibling.textContent ?? '' : ''
    words.push((span.textContent ?? '') + tail)
    const block = span.closest(BLOCK)
    if (i > 0 && block !== prevBlock) starts.add(i)
    prevBlock = block
  })
  return { words, starts }
}

export function BrowserReader({
  rootId,
  label = BROWSER_READER_LABEL,
  accent,
  ground,
}: {
  rootId: string
  /** The line under the play button. */
  label?: string
  accent: string
  ground: string
}) {
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(-1)
  const [count, setCount] = useState(0)
  const [rate, setRate] = useState(1)
  const spansRef = useRef<HTMLSpanElement[]>([])
  const planRef = useRef<Sentence[]>([])
  const genRef = useRef(0)
  const rateRef = useRef(1)
  const currentRef = useRef(-1)
  const playingRef = useRef(false)
  // True from the first play until the page is finished: pause and resume act on a live queue.
  const startedRef = useRef(false)
  const litRef = useRef<HTMLSpanElement | null>(null)

  const setPlay = (p: boolean) => {
    playingRef.current = p
    setPlaying(p)
  }

  const light = (i: number) => {
    const el = i >= 0 ? spansRef.current[i] ?? null : null
    if (el !== litRef.current) {
      litRef.current?.classList.remove('artifact-word-lit')
      el?.classList.add('artifact-word-lit')
      litRef.current = el
      if (el && playingRef.current) {
        const r = el.getBoundingClientRect()
        if (r.top < 80 || r.bottom > window.innerHeight - 140) el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      }
    }
    currentRef.current = i
    setCurrent(i)
  }

  const finish = () => {
    startedRef.current = false
    setPlay(false)
    light(-1)
  }

  const speak = (s: Sentence, gen: number) => {
    const synth = window.speechSynthesis
    const u = new SpeechSynthesisUtterance(s.text)
    u.rate = rateRef.current
    u.onboundary = (e) => {
      if (gen !== genRef.current || e.name !== 'word') return
      light(wordAt(s, e.charIndex))
    }
    u.onend = () => {
      if (gen !== genRef.current) return
      const next = s.first + s.offsets.length
      if (next < spansRef.current.length) speak(fromWord(planRef.current, next), gen)
      else finish()
    }
    u.onerror = () => {
      if (gen === genRef.current) finish()
    }
    // Light the sentence's first word now: some engines send no boundary events at all, and the
    // page should still show where it is.
    light(s.first)
    synth.speak(u)
  }

  /** Cancel whatever is speaking and read from word `i` on. */
  const speakFrom = (i: number) => {
    if (!planRef.current.length) return
    const synth = window.speechSynthesis
    const gen = ++genRef.current
    synth.cancel()
    // An engine paused before the cancel stays paused for the next utterance in some browsers.
    synth.resume()
    startedRef.current = true
    setPlay(true)
    speak(fromWord(planRef.current, Math.max(0, Math.min(i, spansRef.current.length - 1))), gen)
  }

  const speakFromRef = useRef(speakFrom)
  speakFromRef.current = speakFrom

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const root = document.getElementById(rootId)
    if (!root) return
    const spans = wrapWords(root)
    if (!spans.length) return
    const { words, starts } = spokenWords(spans)
    spansRef.current = spans
    planRef.current = planSentences(words, starts)
    setCount(spans.length)
    setReady(true)
    const onClick = (e: MouseEvent) => {
      const el = seekableWord(e.target as Element)
      if (!el) return
      const idx = spansRef.current.indexOf(el)
      if (idx !== -1) speakFromRef.current(idx)
    }
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      genRef.current++
      window.speechSynthesis.cancel()
    }
  }, [rootId])

  const toggle = () => {
    const synth = window.speechSynthesis
    if (!startedRef.current) speakFrom(0)
    else if (playingRef.current) {
      synth.pause()
      setPlay(false)
    } else {
      synth.resume()
      setPlay(true)
    }
  }

  if (!ready) return <div data-artifact-reader="browser" hidden />

  return (
    <div data-artifact-reader="browser">
      <PlayerBar
        playing={playing}
        onToggle={toggle}
        label={label}
        accent={accent}
        ground={ground}
        value={Math.max(current, 0)}
        max={Math.max(count - 1, 0)}
        step={1}
        onSeek={(v) => speakFrom(v)}
        progress={`${current + 1} / ${count}`}
        rate={rate}
        onRate={() => {
          const r = nextRate(rateRef.current)
          rateRef.current = r
          setRate(r)
          // The engine fixes the rate when an utterance starts, so restart at the current word.
          if (startedRef.current && playingRef.current) speakFrom(Math.max(currentRef.current, 0))
        }}
      />
    </div>
  )
}
