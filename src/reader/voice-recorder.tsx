'use client'
// Say it instead of typing it. The microphone in the comment card: MediaRecorder for the memo
// itself, and, where the browser has it, speech recognition writing into the box while you speak.
//
// Chrome records audio/webm (opus), iPhone Safari audio/mp4; the first the browser supports is
// used, else the browser's own default, and a type the page cannot keep is refused before upload.
// A memo stops itself at three minutes. The host's transcription (if it has one) happens after the
// recording stops, in the card, through `hostVoice`, which never sees a key: it only calls this
// page's own routes.
//
// Everything here draws with the page's theme variables (--a-*) and the accent it is handed: the
// card is portalled onto document.body, and a hard-coded colour there is dark text on a dark page.
import { useEffect, useRef, useState } from 'react'
import { MAX_MEMO_MS, audioExtFor, baseMime } from '../artifacts/audio.js'

export type VoiceMemo = { blob: Blob; mime: string }
export type VoiceScope = 'comment' | 'personal'

/** The page's own voice routes, from the reader's browser. */
export type VoiceHost = {
  /** Upload a memo; the stored path, or null when the page could not keep it. */
  upload(memo: VoiceMemo, scope: VoiceScope): Promise<string | null>
  /** The host's transcript of an uploaded memo; null when it has no transcriber (404) or failed. */
  transcribe(path: string): Promise<string | null>
}

export const LIVE_LINE = 'Your browser transcribes this as you speak.'
const SEEN_KEY = 'artifact-voice-live-seen'

/** The recording type to ask for: the first this browser supports, else its default. */
export function pickRecordingType(isSupported: (t: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string | undefined {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4']) {
    try { if (isSupported(t)) return t } catch { /* an engine that throws on the question supports neither */ }
  }
  return undefined
}

/** A memo's random file id: 22 url-safe characters, drawn in the browser. */
export function newMemoId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]
  return s + Date.now().toString(36).slice(-6)
}

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null
  onerror: (() => void) | null
  start(): void; stop(): void
}
type RecognitionCtor = new () => Recognition
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
const canRecord = () => typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** The page's own routes as a VoiceHost. Every failure is a null, never a throw. */
export function hostVoice(artifactId: string): VoiceHost {
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    async upload(memo, scope) {
      try {
        const ext = audioExtFor(memo.mime)
        if (!ext) return null
        const url = `/api/artifacts/${artifactId}/uploads/${newMemoId()}.${ext}`
        const signed = await post(url, { audio: scope })
        if (signed.status !== 201) return null
        const { uploadUrl, headers } = (await signed.json()) as { uploadUrl: string; headers: Record<string, string> }
        const put = await fetch(uploadUrl, { method: 'PUT', headers, body: memo.blob })
        if (!put.ok) return null
        const done = await post(url, { audio: scope, done: true })
        return done.status === 201 ? ((await done.json()) as { path: string }).path : null
      } catch {
        return null
      }
    },
    async transcribe(path) {
      try {
        const r = await post(`/api/artifacts/${artifactId}/transcribe`, { asset: path })
        if (r.status !== 200) return null
        const b = (await r.json()) as { text?: unknown }
        return typeof b.text === 'string' && b.text.trim() ? b.text.trim() : null
      } catch {
        return null
      }
    },
  }
}

const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** The mic button. Renders nothing where the browser cannot record. */
export function VoiceRecorder({ onStart, onLive, onStop, onError, accent = 'currentColor', maxMs = MAX_MEMO_MS }: {
  onStart?: () => void
  /** The live transcript so far, whole, each time it changes. */
  onLive?: (text: string) => void
  onStop: (memo: VoiceMemo) => void
  onError?: (message: string) => void
  accent?: string
  maxMs?: number
}) {
  const [supported, setSupported] = useState(false)
  const [live, setLive] = useState(false)
  const [note, setNote] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; recog: Recognition | null; timer: ReturnType<typeof setTimeout>; tick: ReturnType<typeof setInterval> } | null>(null)

  useEffect(() => {
    setSupported(canRecord())
    const has = !!recognitionCtor()
    setLive(has)
    try { setNote(has && !window.localStorage.getItem(SEEN_KEY)) } catch { setNote(has) }
    return () => { const r = rec.current; if (r) { clearTimeout(r.timer); clearInterval(r.tick); r.recog?.stop(); r.stream.getTracks().forEach((t) => t.stop()) } }
  }, [])

  const stop = () => {
    const r = rec.current
    if (!r) return
    clearTimeout(r.timer)
    clearInterval(r.tick)
    try { r.recog?.stop() } catch { /* already stopped */ }
    if (r.recorder.state !== 'inactive') r.recorder.stop()
  }

  const start = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError?.('The microphone is blocked. Allow it for this site in your browser, then try again.')
      return
    }
    const asked = pickRecordingType()
    let recorder: MediaRecorder
    try {
      recorder = asked ? new MediaRecorder(stream, { mimeType: asked }) : new MediaRecorder(stream)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      onError?.('This browser cannot record here.')
      return
    }
    const chunks: Blob[] = []
    recorder.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size) chunks.push(e.data) }
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      rec.current = null
      setRecording(false)
      const type = recorder.mimeType || asked || chunks[0]?.type || ''
      if (!audioExtFor(type)) { onError?.('This browser records in a format the page cannot keep.'); return }
      onStop({ blob: new Blob(chunks, { type: baseMime(type) }), mime: baseMime(type) })
    }
    let recog: Recognition | null = null
    const Ctor = recognitionCtor()
    if (Ctor) {
      try {
        recog = new Ctor()
        recog.continuous = true
        recog.interimResults = true
        recog.lang = document.documentElement.lang || navigator.language || 'en-US'
        recog.onresult = (e) => {
          let text = ''
          for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? ''
          onLive?.(text.replace(/\s+/g, ' ').trim())
        }
        recog.onerror = () => { /* the recording carries on; only the live words stop */ }
        recog.start()
      } catch {
        recog = null
      }
      try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* private window */ }
    }
    const began = Date.now()
    rec.current = {
      recorder, stream, recog,
      timer: setTimeout(stop, maxMs),
      tick: setInterval(() => setElapsed(Date.now() - began), 250),
    }
    setElapsed(0)
    setRecording(true)
    onStart?.()
    recorder.start(1000)
  }

  if (!supported) return null
  return (
    <div data-voice-recorder className="mt-2 text-[13px] text-[color:var(--a-strong)]">
      <button type="button" data-voice-mic aria-pressed={recording} onClick={() => (recording ? stop() : void start())}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
        style={recording ? { borderColor: accent, background: accent, color: 'var(--a-on-accent, currentColor)' } : { borderColor: accent, color: accent }}>
        <span aria-hidden>{recording ? '■' : '●'}</span>
        {recording ? `Stop · ${clock(elapsed)}` : 'Record'}
      </button>
      {live && note ? <p data-voice-live-note className="m-0 mt-1 text-xs opacity-70">{LIVE_LINE}</p> : null}
    </div>
  )
}

/** A small play control for a saved memo. `src` is a URL (signed, or a blob: URL on the device). */
export function AudioPlay({ src, accent = 'currentColor' }: { src: string; accent?: string }) {
  const [playing, setPlaying] = useState(false)
  const el = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => { el.current?.pause() }, [])
  const toggle = () => {
    if (!el.current) {
      el.current = new Audio(src)
      el.current.onended = () => setPlaying(false)
      el.current.onpause = () => setPlaying(false)
      el.current.onplay = () => setPlaying(true)
    }
    if (el.current.paused) void el.current.play()?.catch?.(() => setPlaying(false))
    else el.current.pause()
  }
  return (
    <button type="button" data-voice-play onClick={toggle} aria-label={playing ? 'Pause the recording' : 'Play the recording'}
      className="mr-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-[color:var(--a-strong)]" style={{ borderColor: accent }}>
      <span aria-hidden style={{ color: accent }}>{playing ? '❚❚' : '▶'}</span>{playing ? 'Pause' : 'Play'}
    </button>
  )
}
