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
// `data-artifact-media` stays on the <audio> or <video>, so play tracking counts it like any clip.
//
// A note of kind "video" (a screen recording) draws the video above its words, with no native bar:
// the same button and seek line drive it, a click on the picture toggles play, and each paragraph
// opens with its time, a button that seeks there.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type SyntheticEvent } from 'react'
import type { NoteKind } from '../artifacts/voice-note.js'
import { NOTE_AT, SEEK_TO } from '../reader/page-bridge.js'
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

export function VoiceNote({ src, label, media, paragraphs, block, kind = 'audio' }: {
  src: string
  label: string
  /** The stored file's name, for play tracking. */
  media: string
  paragraphs: WordTiming[][]
  /** The comment anchor the audio line carried. */
  block?: Record<string, string>
  kind?: NoteKind
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
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
  const blockId = block?.['data-block']
  // "Note at 0:14" shows only where the page takes comments (the comment layer sets this mark).
  const [noting, setNoting] = useState(false)
  // It follows the mark, because the comment layer mounts after the page body and sets it later.
  useEffect(() => {
    const el = document.documentElement
    const read = () => setNoting(el.hasAttribute('data-comments-on'))
    read()
    const watch = new MutationObserver(read)
    watch.observe(el, { attributes: true, attributeFilter: ['data-comments-on'] })
    return () => watch.disconnect()
  }, [])

  /** Light the word at the audio's current time; touch only the spans whose state changed. */
  const sync = () => {
    const a = mediaRef.current
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
    const a = mediaRef.current
    if (!a) return
    start()
    // One voice at a time: the narration or another note stops when this one starts.
    for (const other of Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'))) if (other !== a && !other.paused) other.pause()
    void a.play()?.catch?.(() => setPlaying(false))
  }
  const toggle = () => {
    const a = mediaRef.current
    if (!a) return
    if (a.paused) play()
    else a.pause()
  }
  const seekTo = (s: number) => {
    const a = mediaRef.current
    if (!a) return
    start()
    const go = () => {
      a.currentTime = s
      sync()
    }
    if (a.readyState >= 1) go()
    else a.addEventListener('loadedmetadata', go, { once: true })
  }

  // A comment's "At 0:14" line moves this recording.
  useEffect(() => {
    if (!blockId) return
    const onSeek = (e: Event) => {
      const d = (e as CustomEvent<{ block: string; at: number }>).detail
      if (d?.block === blockId) actions.current.seekTo(d.at)
    }
    window.addEventListener(SEEK_TO, onSeek)
    return () => window.removeEventListener(SEEK_TO, onSeek)
  }, [blockId])

  // What an <audio> and a <video> share: the same clock, the same lit word, the same duration.
  const shared = {
    ref: (el: HTMLMediaElement | null) => { mediaRef.current = el },
    src,
    playsInline: true,
    'data-artifact-media': media,
    onPlay: () => { start(); setPlaying(true) },
    onPause: () => { setPlaying(false); sync() },
    onEnded: () => { setPlaying(false); sync() },
    onTimeUpdate: sync,
    onSeeked: sync,
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d) },
    onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d) },
  }

  // The words are drawn once, not on every tick of the clock: a twenty-minute take has thousands of them, and the
  // clock ticks every frame while it plays. The lighting touches the spans directly (sync), so they need no redraw.
  const actions = useRef({ seekTo, play })
  actions.current = { seekTo, play }
  const onWord = useCallback((s: number) => { actions.current.seekTo(s); actions.current.play() }, [])

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
      {kind !== 'video' ? (
        <audio {...shared} preload="none" />
      ) : null}
      <span className="block text-[11px] uppercase tracking-[0.2em] text-[color:var(--a-accent)]">{kind === 'video' ? 'Recording' : 'Voice note'}</span>
      {label ? <span className="mt-1 block font-serif text-lg italic text-[color:var(--a-strong)]">{label}</span> : null}
      {kind === 'video' ? (
        <div className="relative mt-3 overflow-hidden rounded-lg border border-[color:var(--a-line)] bg-black leading-[0]">
          <video
            {...shared}
            preload="metadata"
            onClick={toggle}
            className="block h-auto w-full cursor-pointer"
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 transition-opacity duration-200 ${playing ? 'opacity-0' : 'opacity-100'}`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--a-accent)] text-[color:var(--a-on-accent)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? 'Pause' : 'Play'} ${kind === 'video' ? 'recording' : 'voice note'}${label ? `: ${label}` : ''}`}
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
        {noting && blockId ? (
          <button type="button" data-note-at onClick={() => window.dispatchEvent(new CustomEvent(NOTE_AT, { detail: { block: blockId, at: Math.floor(t) } }))}
            className="min-h-11 shrink-0 text-xs font-semibold text-[color:var(--a-strong)] underline underline-offset-2">{`Note at ${fmt(t)}`}</button>
        ) : null}
      </div>
      <Words paragraphs={paragraphs} kind={kind} spans={spans} onWord={onWord} />
    </div>
  )
}

/** Every paragraph of the words, with a time stamp first on a recording. Memoized: drawn again only when the words change. */
const Words = memo(function Words({ paragraphs, kind, spans, onWord }: {
  paragraphs: WordTiming[][]
  kind: NoteKind
  spans: MutableRefObject<HTMLSpanElement[]>
  onWord(s: number): void
}) {
  let k = 0
  spans.current = []
  return (
    <div className="mt-4 leading-relaxed text-[color:var(--a-body)]">
      {paragraphs.map((p, pi) => (
        <p key={pi} data-vn-paragraph className={kind === 'video' ? 'my-2 flex items-baseline gap-[0.6rem]' : 'my-2'}>
          {kind === 'video' && p.length ? (
            <button
              type="button"
              data-vn-at={String(p[0].s)}
              onClick={() => onWord(p[0].s)}
              className="-ml-1 min-h-7 shrink-0 rounded px-1 py-[0.15rem] font-mono text-xs tabular-nums text-[color:var(--a-accent)] hover:bg-[color:var(--a-surface-strong)]"
            >
              {fmt(p[0].s)}
            </button>
          ) : null}
          {/* min-w-0 and overflow-wrap: a word with no spaces (an address) wraps instead of widening a phone's page. */}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {p.map((w, wi) => {
              const i = k++
              return (
                <span key={wi}>
                  {wi ? ' ' : null}
                  <span
                    ref={(el) => { if (el) spans.current[i] = el }}
                    className="vn-word"
                    onClick={() => onWord(w.s)}
                  >
                    {w.w}
                  </span>
                </span>
              )
            })}
          </span>
        </p>
      ))}
    </div>
  )
})
