'use client'

// Speechify-style read-along for a published artifact. The narration was generated
// from the same rendered text this page shows (see lib/artifacts/narration.ts), so
// the highlighter walks the DOM in reading order, wraps each word, and aligns that
// sequence to the word timings by normalized token, resyncing within a short window
// when the two disagree. Click a word to seek; the bar at the bottom plays and paces.
import { useEffect, useRef, useState } from 'react'
import { nextRate, PlayerBar } from './player-bar.js'

export type WordTiming = { w: string; s: number; e: number }

const SKIP = '[data-nospeak], [data-artifact-links], pre, [data-footnotes], sup, img, style, script'

/** The elements that hold a run of text; a word whose block differs from the previous word's
 *  starts a new sentence in the browser read-aloud. */
export const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, aside, dt, dd, figcaption, div'

function normalize(w: string) {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

// Set on a root once its words are wrapped. Wrapping twice would nest a span inside every span
// (React's development double-mount, or a host that mounts both readers), and the second set of
// spans would never be the ones the first reader lights.
const WRAPPED = 'data-artifact-words'

/** Wrap every word inside `root` (except skipped subtrees) in a span; return them in order.
 *  Idempotent: a root already wrapped returns the spans it already has. */
export function wrapWords(root: HTMLElement): HTMLSpanElement[] {
  if (root.hasAttribute(WRAPPED)) return Array.from(root.querySelectorAll<HTMLSpanElement>('.artifact-word'))
  root.setAttribute(WRAPPED, '')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement
      if (!el || el.closest(SKIP) || el.closest('.artifact-word, .artifact-word-tail')) return NodeFilter.FILTER_REJECT
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const spans: HTMLSpanElement[] = []
  let prev: { text: string; block: Element | null } | null = null
  for (const node of nodes) {
    const parts = node.nodeValue!.split(/(\s+)/)
    const frag = document.createDocumentFragment()
    const block = node.parentElement!.closest(BLOCK)
    // Punctuation that continues the previous word across an element edge ("Edge" in a defined
    // term, then ", which"; "**bold**,") is one spoken token with it. It is wrapped as a tail,
    // not a word, so the word sequence matches the narration's whitespace tokens.
    const glued = !!prev && prev.block === block && /\S$/.test(prev.text) && /^\S/.test(node.nodeValue!)
    prev = { text: node.nodeValue!, block }
    let first = true
    for (const part of parts) {
      if (!part) continue
      const lead = first
      first = false
      if (lead && glued && !normalize(part)) {
        const tail = document.createElement('span')
        tail.textContent = part
        tail.className = 'artifact-word-tail'
        frag.appendChild(tail)
        continue
      }
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part))
        continue
      }
      const span = document.createElement('span')
      span.textContent = part
      span.className = 'artifact-word'
      frag.appendChild(span)
      spans.push(span)
    }
    node.parentNode!.replaceChild(frag, node)
  }
  return spans
}

/** The karaoke word a click lands on, or null. A defined term is a control that opens its
 *  definition, so a tap on it must never seek or start the narration. */
export function seekableWord(target: Element | null): HTMLSpanElement | null {
  if (!target || target.closest('[data-defined-term]')) return null
  return target.closest('.artifact-word') as HTMLSpanElement | null
}

/** Map each timing index to a DOM span index, tolerating small mismatches. */
function align(spans: HTMLSpanElement[], words: WordTiming[]): (HTMLSpanElement | null)[] {
  const out: (HTMLSpanElement | null)[] = []
  let j = 0
  for (let i = 0; i < words.length; i++) {
    const target = normalize(words[i].w)
    if (!target) {
      out.push(null)
      continue
    }
    let found = -1
    for (let k = j; k < Math.min(spans.length, j + 6); k++) {
      if (normalize(spans[k].textContent ?? '') === target) {
        found = k
        break
      }
    }
    if (found === -1) {
      out.push(null)
      continue
    }
    out.push(spans[found])
    j = found + 1
  }
  return out
}

/** The word to light at `now`, or -1. Nothing lights until narration has started: the first
 *  word begins at 0, so an untouched page would otherwise sit with its first word highlighted. */
export function litWordIndex(words: WordTiming[], now: number, started: boolean): number {
  if (!started) return -1
  let lo = 0
  let hi = words.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].s <= now) {
      idx = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return idx >= 0 && now <= words[idx].e + 0.25 ? idx : -1
}

function fmt(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function ArtifactReader({
  src,
  words,
  rootId,
  label,
  accent,
  ground,
}: {
  src: string
  words: WordTiming[]
  rootId: string
  /** The line under the play button; the brand pack decides it from the voice. */
  label: string
  accent: string
  ground: string
}) {
  const narrator = label
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mapRef = useRef<(HTMLSpanElement | null)[]>([])
  const litRef = useRef<HTMLSpanElement | null>(null)
  // Set on the first play or seek; the highlight stays off until then.
  const startedRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)

  useEffect(() => {
    const root = document.getElementById(rootId)
    if (!root) return
    const spans = wrapWords(root)
    mapRef.current = align(spans, words)
    const onClick = (e: MouseEvent) => {
      const el = seekableWord(e.target as Element)
      if (!el) return
      const idx = mapRef.current.indexOf(el)
      if (idx === -1 || !audioRef.current) return
      audioRef.current.currentTime = words[idx].s
      void audioRef.current.play()
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [rootId, words])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    let raf = 0
    const tick = () => {
      const now = a.currentTime
      setT(now)
      const idx = litWordIndex(words, now, startedRef.current)
      const el = idx >= 0 ? mapRef.current[idx] : null
      if (el !== litRef.current) {
        litRef.current?.classList.remove('artifact-word-lit')
        el?.classList.add('artifact-word-lit')
        litRef.current = el
        if (el && playing) {
          const r = el.getBoundingClientRect()
          if (r.top < 80 || r.bottom > window.innerHeight - 140) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [words, playing])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => {
          startedRef.current = true
          setPlaying(true)
        }}
        onSeeking={() => {
          startedRef.current = true
        }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration)}
        onRateChange={(e) => setRate((e.target as HTMLAudioElement).playbackRate)}
      />
      <PlayerBar
        playing={playing}
        onToggle={toggle}
        label={narrator}
        accent={accent}
        ground={ground}
        value={t}
        max={dur}
        step={0.1}
        onSeek={(v) => {
          if (audioRef.current) audioRef.current.currentTime = v
        }}
        progress={`${fmt(t)} / ${fmt(dur)}`}
        rate={rate}
        onRate={() => {
          if (audioRef.current) audioRef.current.playbackRate = nextRate(rate)
        }}
      />
    </>
  )
}
