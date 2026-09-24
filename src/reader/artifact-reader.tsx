'use client'

// Speechify-style read-along for a published artifact. The narration was generated
// from the same rendered text this page shows (see lib/artifacts/narration.ts), so
// the highlighter walks the DOM in reading order, wraps each word, and aligns that
// sequence to the word timings by normalized token, resyncing within a short window
// when the two disagree. Click a word to seek; the bar at the bottom plays and paces.
import { useEffect, useRef, useState } from 'react'

export type WordTiming = { w: string; s: number; e: number }

const SKIP = '[data-nospeak], [data-artifact-links], pre, [data-footnotes], sup, img'

function normalize(w: string) {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Wrap every word inside `root` (except skipped subtrees) in a span; return them in order. */
function wrapWords(root: HTMLElement): HTMLSpanElement[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement
      if (!el || el.closest(SKIP)) return NodeFilter.FILTER_REJECT
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const spans: HTMLSpanElement[] = []
  for (const node of nodes) {
    const parts = node.nodeValue!.split(/(\s+)/)
    const frag = document.createDocumentFragment()
    for (const part of parts) {
      if (!part) continue
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
      const el = (e.target as HTMLElement).closest('.artifact-word') as HTMLSpanElement | null
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
      // Binary search the word at `now`.
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
      const el = idx >= 0 && now <= words[idx].e + 0.25 ? mapRef.current[idx] : null
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
      <style>{`
        .artifact-word { border-radius: 3px; transition: background-color 120ms; }
        .artifact-word:hover { background: rgba(255,255,255,0.08); cursor: pointer; }
        .artifact-word-lit { background: ${accent}59; color: #fff; }
      `}</style>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration)}
        onRateChange={(e) => setRate((e.target as HTMLAudioElement).playbackRate)}
      />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 backdrop-blur" style={{ background: `${ground}e6` }}>
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause narration' : 'Play narration'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ background: accent, color: ground }}
          >
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: accent }}>
              {narrator}
            </div>
            <input
              type="range"
              min={0}
              max={dur || 0}
              step={0.1}
              value={Math.min(t, dur || 0)}
              onChange={(e) => {
                if (audioRef.current) audioRef.current.currentTime = Number(e.target.value)
              }}
              aria-label="Seek"
              className="mt-1 w-full"
              style={{ accentColor: accent }}
            />
          </div>
          <div className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400">
            {fmt(t)} / {fmt(dur)}
          </div>
          <button
            type="button"
            onClick={() => {
              const next = rate >= 1.5 ? 1 : rate + 0.25
              if (audioRef.current) audioRef.current.playbackRate = next
            }}
            className="shrink-0 rounded border border-white/15 px-2 py-1 text-xs text-zinc-300"
            aria-label="Playback speed"
          >
            {rate}x
          </button>
        </div>
      </div>
      <div className="h-20" aria-hidden />
    </>
  )
}
