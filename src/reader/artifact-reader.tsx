'use client'

// Speechify-style read-along for a published artifact. The narration was generated
// from the same rendered text this page shows (see lib/artifacts/narration.ts), so
// the highlighter walks the DOM in reading order, wraps each word, and aligns that
// sequence to the word timings by normalized token, resyncing within a short window
// when the two disagree. Tap a word while it plays to jump there; tap one while it is paused and a
// small bar offers to play from it, so reading and tapping never starts the audio by surprise. While
// it plays the page follows the voice, until the reader scrolls on their own: then it leaves them
// where they are and shows a button that brings them back to the voice.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])
/** Whether a key press is the reader scrolling the page themselves. Space scrolls only outside a
 *  field that takes text. */
export function isUserScrollKey(key: string, target: EventTarget | null): boolean {
  if (!SCROLL_KEYS.has(key)) return false
  const el = target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))) return false
  return true
}

/** The Play from here bar's width, so it can be kept inside the screen. */
const OFFER_WIDTH = 168

export function ArtifactReader({
  src,
  words,
  rootId,
  accent,
  ground,
}: {
  src: string
  words: WordTiming[]
  rootId: string
  /** Ignored since 0.33.1: the player bar names no narrator. Kept so an older caller compiles. */
  label?: string
  accent: string
  ground: string
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mapRef = useRef<(HTMLSpanElement | null)[]>([])
  const litRef = useRef<HTMLSpanElement | null>(null)
  // Set on the first play or seek; the highlight stays off until then.
  const startedRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  // Whether the page follows the voice. A reader scrolling on their own turns it off; the button
  // that appears, a word tapped while playing, or pressing play turns it back on.
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const playingRef = useRef(false)
  const follow = (on: boolean) => { followingRef.current = on; setFollowing(on) }
  // The Play from here bar, beside the word a paused reader tapped, in page coordinates so it
  // stays with the word when they scroll.
  const [offer, setOffer] = useState<{ idx: number; top: number; left: number; nudged?: boolean } | null>(null)
  const offerRef = useRef<HTMLDivElement>(null)
  // The bar is placed in its container's coordinates, which on a host that insets the page are not
  // the screen's; measure where it actually landed and nudge it back inside the screen.
  useLayoutEffect(() => {
    const el = offerRef.current
    if (!offer || !el || offer.nudged) return
    // Inside the screen AND inside whatever box clips the bar (a host's rounded page card).
    let lo = 0
    let hi = document.documentElement.clientWidth || window.innerWidth
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p)
      if (o.overflowX !== 'visible' || o.overflow !== 'visible') {
        const b = p.getBoundingClientRect()
        if (b.width > 0) { lo = Math.max(lo, b.left); hi = Math.min(hi, b.right) }
      }
    }
    // And inside the page's own text column, which is what a reader sees as the page.
    const col = document.getElementById(rootId)?.getBoundingClientRect()
    if (col && col.width > 0) { lo = Math.max(lo, col.left); hi = Math.min(hi, col.right) }
    const vw = hi
    const r = el.getBoundingClientRect()
    // No layout to measure (a server render, a test DOM): leave the placement as computed.
    const shift = r.width === 0 ? 0 : r.right > vw - 8 ? vw - 8 - r.right : r.left < lo + 8 ? lo + 8 - r.left : 0
    // Once per tap: measured again, an element with no layout would move forever.
    setOffer({ ...offer, left: offer.left + (Math.abs(shift) >= 1 ? shift : 0), nudged: true })
  }, [offer, rootId])

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
      if (playingRef.current) {
        audioRef.current.currentTime = words[idx].s
        follow(true)
        setOffer(null)
        return
      }
      const r = el.getBoundingClientRect()
      // Kept on screen: a word near the right edge would push the bar off it and wrap its label.
      const vw = window.innerWidth || document.documentElement.clientWidth || 1024
      setOffer({ idx, top: r.bottom + window.scrollY + 8, left: Math.max(8, Math.min(r.left, vw - OFFER_WIDTH - 8)) + window.scrollX })
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [rootId, words])

  // The reader scrolling on their own, while it plays, stops the page following the voice.
  useEffect(() => {
    const mine = () => { if (playingRef.current && followingRef.current) follow(false) }
    const onKey = (e: KeyboardEvent) => { if (isUserScrollKey(e.key, e.target)) mine() }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOffer(null) }
    window.addEventListener('wheel', mine, { passive: true })
    window.addEventListener('touchmove', mine, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('wheel', mine)
      window.removeEventListener('touchmove', mine)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onEsc)
    }
  }, [])

  const playFrom = (idx: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = words[idx].s
    follow(true)
    setOffer(null)
    void a.play()
  }
  const backToVoice = () => {
    follow(true)
    litRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

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
        if (el && playing && followingRef.current) {
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
          playingRef.current = true
          setPlaying(true)
          setOffer(null)
          follow(true)
        }}
        onSeeking={() => {
          startedRef.current = true
        }}
        onPause={() => { playingRef.current = false; setPlaying(false) }}
        onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration)}
        onRateChange={(e) => setRate((e.target as HTMLAudioElement).playbackRate)}
      />
      {offer ? (
        <div ref={offerRef} data-nospeak data-play-offer className="absolute z-50 flex items-center rounded-full font-sans text-[13px] leading-none shadow-lg"
          style={{ top: offer.top, left: offer.left, width: OFFER_WIDTH, whiteSpace: 'nowrap', background: accent, color: ground }}>
          <button type="button" data-play-from-here onClick={() => playFrom(offer.idx)}
            className="flex flex-1 items-center gap-1.5 rounded-l-full py-2 pl-3 pr-1 font-medium">
            <svg aria-hidden="true" width="10" height="11" viewBox="0 0 10 11"><path d="M1 1l8 4.5L1 10z" fill="currentColor" /></svg>
            Play from here
          </button>
          <button type="button" aria-label="Close" onClick={() => setOffer(null)}
            className="rounded-r-full py-2 pl-1 pr-3 text-base leading-none opacity-70">×</button>
        </div>
      ) : null}
      {playing && !following ? (
        <button type="button" data-follow-voice data-nospeak onClick={backToVoice}
          className="fixed left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)', background: accent, color: ground }}>
          Back to the voice
        </button>
      ) : null}
      <PlayerBar
        playing={playing}
        onToggle={toggle}
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
