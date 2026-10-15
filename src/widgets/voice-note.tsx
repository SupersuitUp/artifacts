'use client'
// A voice note in the reader's browser: a recording tucked into the page like a note in a letter.
// The caption, a play button and a seek line drawn in the page's brand (never the native bar), and
// the speaker's own words beneath, lit one at a time as they are spoken: words already said read
// normally, the word being said carries the same highlight as the page's narration (karaoke.ts),
// and the words to come are a little muted. Tapping a word plays from there.
//
// The whole note is data-nospeak, so the page's own narration skips it: a reader hears the person,
// never a robot reading the person. The words are server-rendered, so the transcript reads as text
// before anything loads; only the lighting needs the browser.
//
// iPhone Safari: no autoplay, `preload="none"` (nothing fetched until play), `playsinline`. A seek
// asked for before the clip has loaded waits for its metadata, since Safari drops it otherwise.
// `data-artifact-media` stays on the <audio>, so play tracking counts it like any clip.
import { useEffect, useMemo, useRef, useState } from 'react'
import { begunCount, litDeclarations, litWordIndex, type WordTiming } from '../reader/karaoke.js'

const CSS =
  '[data-artifact-voicenote] .vn-word{border-radius:3px;cursor:pointer;transition:background-color 120ms,opacity 200ms;-webkit-tap-highlight-color:transparent}' +
  '[data-artifact-voicenote] .vn-word:hover{background:var(--a-surface-strong,rgba(127,127,127,0.12))}' +
  '[data-artifact-voicenote] .vn-word.vn-ahead{opacity:0.5}' +
  `[data-artifact-voicenote] .vn-word.vn-word-lit{${litDeclarations('var(--a-accent)')}opacity:1}` +
  '[data-artifact-voicenote] input[type=range]{accent-color:var(--a-accent)}' +
  '[data-artifact-voicenote] button:focus-visible,[data-artifact-voicenote] input:focus-visible{outline:2px solid var(--a-accent);outline-offset:2px}'

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function VoiceNote({ src, label, media, paragraphs, block }: {
  src: string
  label: string
  /** The stored file's name, for play tracking. */
  media: string
  paragraphs: WordTiming[][]
  /** The comment anchor the audio line carried. */
  block?: Record<string, string>
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const words = useMemo(() => paragraphs.flat(), [paragraphs])
  const spans = useRef<HTMLSpanElement[]>([])
  const shown = useRef({ lit: -1, begun: -1 })
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const startedRef = useRef(false)
  const [t, setT] = useState(0)
  const [duration, setDuration] = useState(0)
  const total = duration || words[words.length - 1]?.e || 0

  /** Light the word at the audio's current time; touch only the spans whose state changed. */
  const sync = () => {
    const a = audioRef.current
    if (!a) return
    const now = a.currentTime
    setT(now)
    if (!startedRef.current) return
    const lit = litWordIndex(words, now, true)
    const begun = a.ended ? words.length : begunCount(words, now)
    const was = shown.current
    if (lit === was.lit && begun === was.begun) return
    if (was.lit !== lit) {
      spans.current[was.lit]?.classList.remove('vn-word-lit')
      spans.current[lit]?.classList.add('vn-word-lit')
    }
    const from = Math.max(0, Math.min(begun, was.begun < 0 ? 0 : was.begun))
    const to = was.begun < 0 ? spans.current.length : Math.max(begun, was.begun)
    for (let i = from; i < to; i++) spans.current[i]?.classList.toggle('vn-ahead', i >= begun)
    shown.current = { lit, begun }
  }

  const start = () => {
    if (startedRef.current) return
    startedRef.current = true
    setStarted(true)
  }

  // While it plays, follow the voice every frame; Safari's timeupdate alone is four times a second.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      sync()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  const play = () => {
    const a = audioRef.current
    if (!a) return
    start()
    // One voice at a time: the narration or another note stops when this one starts.
    for (const other of Array.from(document.querySelectorAll('audio'))) if (other !== a && !other.paused) other.pause()
    void a.play()?.catch?.(() => setPlaying(false))
  }
  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) play()
    else a.pause()
  }
  const seekTo = (s: number) => {
    const a = audioRef.current
    if (!a) return
    start()
    const go = () => {
      a.currentTime = s
      sync()
    }
    if (a.readyState >= 1) go()
    else a.addEventListener('loadedmetadata', go, { once: true })
  }

  let k = 0
  spans.current = []
  return (
    <div
      {...block}
      ref={rootRef}
      data-nospeak
      data-artifact-voicenote
      {...(started ? { 'data-started': '' } : {})}
      className="my-8 rounded-xl border border-[color:var(--a-line)] bg-[color:var(--a-surface)] px-5 pb-5 pt-4 shadow-sm"
    >
      <style>{CSS}</style>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        playsInline
        data-artifact-media={media}
        onPlay={() => { start(); setPlaying(true) }}
        onPause={() => { setPlaying(false); sync() }}
        onEnded={() => { setPlaying(false); sync() }}
        onTimeUpdate={sync}
        onSeeked={sync}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d) }}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d) }}
      />
      <span className="block text-[11px] uppercase tracking-[0.2em] text-[color:var(--a-accent)]">Voice note</span>
      {label ? <span className="mt-1 block font-serif text-lg italic text-[color:var(--a-strong)]">{label}</span> : null}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? 'Pause' : 'Play'} voice note${label ? `: ${label}` : ''}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--a-accent)] text-[color:var(--a-on-accent)]"
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={total || 1}
          step={0.01}
          value={Math.min(t, total || 1)}
          onChange={(e) => seekTo(Number(e.currentTarget.value))}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0 font-mono text-xs tabular-nums text-[color:var(--a-muted)]">{fmt(t)} / {fmt(total)}</span>
      </div>
      <div className="mt-4 leading-relaxed text-[color:var(--a-body)]">
        {paragraphs.map((p, pi) => (
          <p key={pi} data-vn-paragraph className="my-2">
            {p.map((w, wi) => {
              const i = k++
              return (
                <span key={wi}>
                  {wi ? ' ' : null}
                  <span
                    ref={(el) => { if (el) spans.current[i] = el }}
                    className="vn-word"
                    onClick={() => { seekTo(w.s); play() }}
                  >
                    {w.w}
                  </span>
                </span>
              )
            })}
          </p>
        ))}
      </div>
    </div>
  )
}
