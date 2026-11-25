'use client'
// "Reply with your voice" on a voice eCard: the one way to answer it (Gary, 2026-11-25: "Remove
// comment feature methinks ya?"). No comment layer, no selection to comment, no pins, no threads:
// it opens straight into a recorder drawn in the card's own language, and Send uploads the memo
// exactly as a comment's recording (hostVoice, scope `comment`) and appends it to the page's
// comments slot, anchored to the letter at the second the voice was at. That slot is the record the
// owner's reader summary reads, so the reply shows there and `goal: respond` counts it.
//
// THE CONTROL NEVER MOVES (Gary, 2026-11-25, iPhone: "It's hard to see the UI elements for playing
// your recording, and the record button becomes off-center when you click the record button").
// One round button in one fixed slot is the mic while idle and the stop while recording; the line
// under it is reserved and holds the label, then the time, in navy. A recorded take gets a real
// player: a solid navy play button, a progress bar, the time; then Send and Record again, full width.
// The recording is the mic button's own (useVoiceRecording), only the drawing is the card's.
import { useEffect, useMemo, useRef, useState } from 'react'
import { hostVoice, useVoiceRecording, type VoiceHost, type VoiceMemo } from './voice-recorder.js'
import { COMMENTS_SLOT, MAX_COMMENT_NAME_CHARS } from '../artifacts/comments.js'

/** The reply's colours on the card's parchment, checked against WCAG AA in the tests. */
export const REPLY_TOKENS = {
  ink: '#09164d', // the Gilded Stationer's navy: text, the record and play buttons
  muted: '#3a4473', // secondary text
  parchment: '#efe7d6', // the darkest of the letter paper's tones
  gold: '#e7cb75', // the Send button's fill
  goldEdge: '#7d5f17', // the Send button's edge, so the control reads against the paper
  track: '#6b7093', // the progress bar's track
} as const

/** WCAG relative-luminance contrast between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** m:ss. */
export const replyClock = (ms: number) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export type VoiceReplyProps = {
  artifactId: string
  /** The letter's block: the reply is pinned to it, at `at()` seconds into the recording. */
  blockId: string
  ownerName: string
  /** The version being read, stored on the reply. */
  version: number
  at: () => number
  /** A group link on a `comment_name: required` page: the reply carries a first name. */
  requireName?: boolean
  /** The page's voice routes; tests pass a stub. */
  voice?: VoiceHost
  /** What survives the sheet closing: a recorded take (and whether it was sent), so reopening
   *  returns to it. A recording still running when the sheet closes is stopped and dropped. */
  kept?: ReplyKept
  onKeep?: (k: ReplyKept) => void
}

export type ReplyKept = { memo: VoiceMemo | null; took: number; sent: boolean }

type Stage = 'ready' | 'recording' | 'review' | 'sending' | 'sent'

function MicGlyph() { return <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg> }
function StopGlyph() { return <span aria-hidden className="ve-rr-stop" /> }
function PlayGlyph() { return <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden><path d="M4.5 2.5v11l9-5.5z" fill="currentColor" /></svg> }
function PauseGlyph() { return <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" /></svg> }

// ---- Hearing it, and seeing it (Gary, 2026-11-25, iPhone Safari: "I'm unable to hear the
// recording that I recorded, and there was no waveforms that made me feel confident that my voice
// was being recorded"). A live meter on the microphone's own stream while recording; the take
// decoded after it stops, drawn as its waveform, checked for sound, and played through Web Audio
// (an AudioBufferSourceNode in a context resumed inside the tap), which iOS plays where an <audio>
// on a blob URL can stay silent. The bytes uploaded are the recorder's, untouched.

type AudioCtor = typeof AudioContext
const audioCtor = (): AudioCtor | null => (typeof window === 'undefined' ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ?? null))
const bytesOf = (b: Blob) => (typeof b.arrayBuffer === 'function' ? b.arrayBuffer() : new Response(b).arrayBuffer())

/** A take whose loudest sample is under this is silence: about -40 dBFS. */
export const SILENCE_PEAK = 0.01
export const SILENT_LINE = "We didn't catch any sound. Check that your microphone is allowed, then record again."
/** The waveform's bars. */
export const WAVE_BARS = 48
/** The live meter's bars. */
export const METER_BARS = 24

/** The loudest sample. */
export function takePeak(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > p) p = v }
  return p
}
/** The waveform: the loudest sample in each of `bins` equal slices, scaled so the loudest is 1. */
export function wavePeaks(samples: Float32Array, bins = WAVE_BARS): number[] {
  const out: number[] = []
  const per = Math.max(1, Math.floor(samples.length / bins))
  for (let b = 0; b < bins; b++) {
    let p = 0
    for (let i = b * per; i < Math.min(samples.length, (b + 1) * per); i++) { const v = Math.abs(samples[i]); if (v > p) p = v }
    out.push(p)
  }
  const top = Math.max(...out, 1e-9)
  return out.map((v) => v / top)
}
/** One live level from an analyser's time-domain bytes (128 is silence): the RMS, 0 to 1. */
export function meterLevel(bytes: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < bytes.length; i++) { const v = (bytes[i] - 128) / 128; sum += v * v }
  return Math.min(1, Math.sqrt(sum / Math.max(1, bytes.length)) * 3)
}

/** What the decoded take says: its buffer (null where the browser has no Web Audio), its waveform,
 *  and whether it holds any sound. */
export type TakeCheck = { buffer: AudioBuffer | null; peaks: number[]; silent: boolean; seconds: number | null }

export async function checkTake(blob: Blob): Promise<TakeCheck> {
  if (!blob.size) return { buffer: null, peaks: [], silent: true, seconds: null }
  const C = audioCtor()
  if (!C) return { buffer: null, peaks: [], silent: false, seconds: null }
  let ctx: AudioContext | null = null
  try {
    ctx = new C()
    const buffer = await ctx.decodeAudioData(await bytesOf(blob))
    const data = buffer.getChannelData(0)
    return { buffer, peaks: wavePeaks(data), silent: takePeak(data) < SILENCE_PEAK, seconds: buffer.duration }
  } catch {
    return { buffer: null, peaks: [], silent: true, seconds: null }
  } finally {
    void ctx?.close?.()
  }
}

/** The recorded take: play and pause, its waveform with the playhead, the time. The decoded buffer
 *  plays through Web Audio; only a browser without it falls back to an <audio> element, inline. */
function TakePlayer({ src, type, check, fallbackMs }: { src: string; type: string; check: TakeCheck | null; fallbackMs: number }) {
  const el = useRef<HTMLAudioElement>(null)
  const ctx = useRef<AudioContext | null>(null)
  const node = useRef<AudioBufferSourceNode | null>(null)
  const began = useRef(0)
  const offset = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const buffer = check?.buffer ?? null
  const total = Math.max(check?.seconds ?? fallbackMs / 1000, 0.001)

  useEffect(() => () => { try { node.current?.stop() } catch { /* already stopped */ } void ctx.current?.close?.() }, [])
  useEffect(() => {
    if (!playing) return
    const tick = setInterval(() => {
      if (buffer && ctx.current) setT(Math.min(total, ctx.current.currentTime - began.current))
      else setT(el.current?.currentTime ?? 0)
    }, 50)
    return () => clearInterval(tick)
  }, [playing, buffer, total])

  const toggle = () => {
    if (buffer) {
      if (playing) {
        const n = node.current
        node.current = null
        if (n) { n.onended = null; try { n.stop() } catch { /* already stopped */ } }
        offset.current = ctx.current ? Math.min(total, ctx.current.currentTime - began.current) : 0
        setPlaying(false)
        return
      }
      const C = audioCtor()
      if (!C) return
      // Made and resumed inside the tap: iOS plays nothing from a context it never saw a gesture for.
      const c = (ctx.current ??= new C())
      void c.resume?.()
      const n = c.createBufferSource()
      n.buffer = buffer
      n.connect(c.destination)
      const from = offset.current >= total - 0.05 ? 0 : offset.current
      n.onended = () => { if (node.current === n) { node.current = null; offset.current = 0; setT(0); setPlaying(false) } }
      began.current = c.currentTime - from
      n.start(0, from)
      node.current = n
      setPlaying(true)
      return
    }
    const a = el.current
    if (!a) return
    if (a.paused) void a.play()?.catch?.(() => setPlaying(false))
    else a.pause()
  }
  const played = Math.min(1, t / total)
  const peaks = check?.peaks.length ? check.peaks : Array.from({ length: WAVE_BARS }, () => 0.15)
  return (
    <div className="ve-rr-player">
      <button type="button" className="ve-rr-play" onClick={toggle} aria-label={playing ? 'Pause your reply' : 'Play your reply'} data-reply-play>
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      <div className="ve-rr-wave" role="progressbar" aria-label="How much of your reply has played" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)} data-reply-wave>
        {peaks.map((v, k) => (
          <span key={k} className={`ve-rr-bar${(k + 0.5) / peaks.length <= played ? ' is-played' : ''}`} style={{ height: `${Math.max(10, Math.round(v * 100))}%` }} data-wave-bar />
        ))}
        <span className="ve-rr-head" style={{ left: `${played * 100}%` }} aria-hidden />
      </div>
      <span className="ve-rr-time" data-reply-time>{`${replyClock(t * 1000)} / ${replyClock(total * 1000)}`}</span>
      {buffer ? null : (
        <audio ref={el} preload="auto" playsInline
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setT(0) }}>
          <source src={src} type={type} />
        </audio>
      )}
    </div>
  )
}

export function VoiceReply({ artifactId, blockId, ownerName, version, at, requireName = false, voice, kept, onKeep }: VoiceReplyProps) {
  const host = useMemo(() => voice ?? hostVoice(artifactId), [voice, artifactId])
  const [memo, setMemo] = useState<VoiceMemo | null>(kept?.memo ?? null)
  const [took, setTook] = useState(kept?.took ?? 0)
  const [stage, setStage] = useState<Stage>(kept?.sent ? 'sent' : kept?.memo ? 'review' : 'ready')
  const [check, setCheck] = useState<TakeCheck | null>(null)
  const [levels, setLevels] = useState<number[]>([])
  const discard = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const url = useMemo(() => (memo ? URL.createObjectURL(memo.blob) : null), [memo])
  const elapsedRef = useRef(0)
  const meter = useRef<{ ctx: AudioContext; src?: MediaStreamAudioSourceNode; tick?: ReturnType<typeof setInterval> } | null>(null)
  const stopMeter = () => {
    const m = meter.current
    meter.current = null
    if (!m) return
    if (m.tick) clearInterval(m.tick)
    try { m.src?.disconnect() } catch { /* already gone */ }
    void m.ctx.close?.()
    setLevels([])
  }
  const rec = useVoiceRecording({
    // No live words here: on iPhone Safari the recogniser and the recorder contend for the one
    // microphone, and the take can come out silent.
    transcribe: false,
    onStart: () => { setStage('recording'); setError(null) },
    onStream: (stream) => {
      const m = meter.current
      if (!m) return
      const src = m.ctx.createMediaStreamSource(stream)
      const an = m.ctx.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      const bytes = new Uint8Array(an.fftSize)
      m.src = src
      m.tick = setInterval(() => {
        an.getByteTimeDomainData(bytes)
        const lv = meterLevel(bytes)
        setLevels((l) => [...l, lv].slice(-METER_BARS))
      }, 60)
    },
    onStop: (m) => {
      stopMeter()
      // Closed mid-recording: the take is dropped, and the sheet reopens at the record button.
      if (discard.current) return
      setTook(elapsedRef.current); setMemo(m); setStage('review')
    },
    onError: (msg) => { stopMeter(); setError(msg); setStage('ready') },
    maxMs: 3 * 60 * 1000,
  })
  elapsedRef.current = rec.elapsed
  const recRef = useRef(rec)
  recRef.current = rec
  useEffect(() => { onKeep?.({ memo, took, sent: stage === 'sent' }) }, [memo, took, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopMeter(); if (recRef.current.recording) { discard.current = true; recRef.current.stop() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Every take is decoded and checked before it can be sent.
  useEffect(() => {
    setCheck(null)
    if (!memo) return
    let live = true
    void checkTake(memo.blob).then((c) => { if (live) setCheck(c) })
    return () => { live = false }
  }, [memo])

  const record = () => {
    if (rec.recording) { stopMeter(); rec.stop(); return }
    // The meter's audio context is made and resumed inside this tap: iOS wants the gesture.
    const C = audioCtor()
    if (C) {
      try { const ctx = new C(); void ctx.resume?.(); meter.current = { ctx } } catch { meter.current = null }
    }
    void rec.start()
  }

  const silent = check?.silent === true
  const send = async () => {
    if (!memo || !check || silent) return
    if (requireName && !name.trim()) { setError('Add your first name first.'); return }
    setStage('sending')
    setError(null)
    const path = await host.upload(memo, 'comment')
    if (!path) { setError('The recording did not upload. Try sending again.'); setStage('review'); return }
    const value = { anchor: { kind: 'time' as const, block: blockId, at: Math.max(0, Math.floor(at())) }, body: '', version, audio: path, ...(requireName ? { by: name.trim() } : {}) }
    try {
      const r = await fetch(`/api/artifacts/${artifactId}/state`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: COMMENTS_SLOT, op: 'append', value }) })
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: unknown }
        setError(typeof b.error === 'string' ? b.error : 'That did not send. Try again.')
        setStage('review')
        return
      }
    } catch {
      setError('That did not reach the page. Try again.')
      setStage('review')
      return
    }
    setStage('sent')
  }

  if (stage === 'sent') {
    return (
      <div className="ve-reply-panel" data-voice-reply-panel data-stage="sent">
        <p className="ve-rr-sent" role="status" data-voice-reply-sent>{`Sent to ${ownerName}`}</p>
        <p className="ve-rr-note">Your voice is on its way.</p>
      </div>
    )
  }
  const reviewing = stage === 'review' || stage === 'sending'
  return (
    <div className="ve-reply-panel" data-voice-reply-panel data-stage={stage}>
      {reviewing && url && memo ? (
        <>
          <TakePlayer src={url} type={memo.mime} check={check} fallbackMs={took} />
          {silent ? <p className="ve-rr-silent" role="alert" data-reply-silent>{SILENT_LINE}</p> : null}
          {requireName ? (
            <input name="by" className="ve-rr-name" placeholder="Your first name" maxLength={MAX_COMMENT_NAME_CHARS} value={name} onChange={(e) => setName(e.target.value)} />
          ) : null}
          <div className="ve-rr-actions">
            <button type="button" className="ve-rr-send" onClick={() => void send()} disabled={stage === 'sending' || !check || silent} data-voice-reply-send>
              {stage === 'sending' ? 'Sending…' : `Send to ${ownerName}`}
            </button>
            <button type="button" className="ve-rr-again" onClick={() => { setMemo(null); setTook(0); setStage('ready'); setError(null) }} disabled={stage === 'sending'} data-voice-reply-again>Record again</button>
          </div>
        </>
      ) : (
        <div className="ve-rr-slot" data-reply-slot>
          <span className={`ve-rr-ring${rec.recording ? ' is-on' : ''}`} aria-hidden data-reply-ring />
          <button type="button" className={`ve-rr-record${rec.recording ? ' is-recording' : ''}`} data-reply-record
            aria-label={rec.recording ? 'Stop recording' : 'Record your reply'} aria-pressed={rec.recording} onClick={record}>
            {rec.recording ? <StopGlyph /> : <MicGlyph />}
          </button>
          <span className="ve-rr-under" data-reply-under aria-live="polite">
            {rec.recording ? replyClock(rec.elapsed) : rec.supported ? 'Tap to record your reply' : 'This browser cannot record here.'}
          </span>
          <span className="ve-rr-meter" aria-hidden data-reply-meter-space>
            {rec.recording ? (
              <span className="ve-rr-meter-bars" data-reply-meter>
                {Array.from({ length: METER_BARS }, (_, k) => {
                  const v = levels[levels.length - METER_BARS + k] ?? 0
                  return <span key={k} className="ve-rr-mbar" style={{ height: `${Math.max(12, Math.round(v * 100))}%` }} data-meter-bar />
                })}
              </span>
            ) : null}
          </span>
        </div>
      )}
      {error ? <p className="ve-rr-error" role="alert">{error}</p> : null}
    </div>
  )
}

/** The sheet the reply lives in (Gary, 2026-11-25: "the controls should sit above the letter ...
 *  more like a pop-up"): over the open card, in real screen pixels (never inside the scaled card),
 *  sliding up from the bottom on a phone and a centred panel on a large screen. */
export const REPLY_SHEET_CSS = String.raw`
.ve-sheet-dim { position: fixed; inset: 0; z-index: 8; background: rgba(5, 10, 38, 0.45); animation: ve-fade-in 0.2s ease-out both; }
.ve-sheet { position: fixed; z-index: 9; left: 0; right: 0; bottom: 0; margin: 0 auto; width: 100%; max-width: 520px; max-height: 100dvh; overflow-y: auto; box-sizing: border-box;
  padding: 10px 18px calc(18px + env(safe-area-inset-bottom, 0px)); border-radius: 20px 20px 0 0; background: #f6efdf; background-image: var(--ve-paper); background-size: cover;
  border: 1px solid color-mix(in srgb, var(--ve-foil) 65%, transparent); border-bottom: none; box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35); color: ${REPLY_TOKENS.ink}; animation: ve-sheet-up 0.32s cubic-bezier(0.22, 0.9, 0.35, 1) both; }
.ve-sheet::before { content: ''; position: absolute; inset: 6px; border: 1px solid color-mix(in srgb, var(--ve-foil) 45%, transparent); border-radius: 15px 15px 0 0; border-bottom: none; pointer-events: none; }
@keyframes ve-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.ve-sheet-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 48px; margin-bottom: 4px; }
.ve-sheet-title { margin: 0; font: 600 13px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.28em; text-indent: 0.28em; text-transform: uppercase; color: ${REPLY_TOKENS.muted}; }
.ve-sheet-close { position: absolute; right: -6px; top: 2px; width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 1.5px solid ${REPLY_TOKENS.ink}; background: #fffaf0; color: ${REPLY_TOKENS.ink}; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.ve-sheet .ve-reply-panel { margin: 0; background: transparent; border: none; padding: 4px 0 0; }
@media (min-width: 768px) and (min-height: 560px) {
  .ve-sheet { top: 50%; bottom: auto; transform: translateY(-50%); border-radius: 20px; border-bottom: 1px solid color-mix(in srgb, var(--ve-foil) 65%, transparent); padding-bottom: 22px; animation: ve-fade-in 0.25s ease-out both; }
  .ve-sheet::before { border-radius: 15px; border-bottom: 1px solid color-mix(in srgb, var(--ve-foil) 45%, transparent); }
}
@media (max-height: 480px) { .ve-sheet { max-width: 560px; } .ve-sheet .ve-rr-actions { grid-template-columns: 1fr 1fr; } }
@media (prefers-reduced-motion: reduce) { .ve-sheet { animation: ve-fade-in 0.2s ease-out both; } }
`

/** The reply's stylesheet, drawn beside the voice eCard's. Sizes are
 *  real screen pixels (the sheet is never scaled with the card), so every control is its full size in every orientation. */
export const VOICE_REPLY_CSS = String.raw`
.ve-reply-panel { display: flex; flex-direction: column; align-items: stretch; gap: 12px; margin: 0 0 1.1rem; padding: 16px 16px 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--ve-foil) 70%, transparent); background: rgba(255, 252, 244, 0.55); font: 400 15px/1.3 system-ui, -apple-system, sans-serif; color: ${REPLY_TOKENS.ink}; }
.ve-rr-slot { position: relative; display: grid; grid-template-rows: 84px 26px 28px; justify-items: center; align-items: center; row-gap: 8px; }
.ve-rr-ring { grid-row: 1; grid-column: 1; width: 84px; height: 84px; border-radius: 50%; pointer-events: none; }
.ve-rr-ring.is-on { animation: ve-rr-pulse 1.4s ease-out infinite; }
@keyframes ve-rr-pulse { 0% { box-shadow: 0 0 0 0 rgba(9, 22, 77, 0.35); } 100% { box-shadow: 0 0 0 16px rgba(9, 22, 77, 0); } }
.ve-rr-record { grid-row: 1; grid-column: 1; width: 84px; height: 84px; padding: 0; border-radius: 50%; border: 2px solid var(--ve-foil); background: ${REPLY_TOKENS.ink}; color: #fff7df; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 6px 16px rgba(9, 22, 77, 0.28); -webkit-tap-highlight-color: transparent; }
.ve-rr-stop { display: block; width: 26px; height: 26px; border-radius: 5px; background: currentColor; }
.ve-rr-under { grid-row: 2; grid-column: 1; height: 26px; line-height: 26px; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${REPLY_TOKENS.ink}; white-space: nowrap; }
.ve-rr-meter { grid-row: 3; grid-column: 1; display: flex; align-items: center; justify-content: center; width: 168px; height: 28px; }
.ve-rr-meter-bars { display: flex; align-items: center; justify-content: center; gap: 3px; width: 100%; height: 100%; }
.ve-rr-mbar { display: block; width: 4px; min-height: 3px; border-radius: 2px; background: ${REPLY_TOKENS.ink}; transition: height 60ms linear; }
.ve-rr-player { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.ve-rr-wave { position: relative; display: flex; align-items: center; gap: 2px; height: 44px; }
.ve-rr-bar { flex: 1 1 0; min-width: 2px; border-radius: 2px; background: ${REPLY_TOKENS.track}; }
.ve-rr-bar.is-played { background: ${REPLY_TOKENS.ink}; }
.ve-rr-head { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: ${REPLY_TOKENS.ink}; border-radius: 1px; }
.ve-rr-silent { margin: 0; text-align: center; font-size: 15px; font-weight: 600; line-height: 1.35; color: #8f1d12; }
.ve-rr-play { width: 56px; height: 56px; padding: 0; border-radius: 50%; border: none; background: ${REPLY_TOKENS.ink}; color: #fff7df; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.ve-rr-time { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${REPLY_TOKENS.ink}; white-space: nowrap; }
.ve-rr-actions { display: grid; grid-template-columns: 1fr; gap: 10px; }
.ve-rr-send, .ve-rr-again { width: 100%; min-height: 60px; border-radius: 999px; font: 700 18px/1 system-ui, -apple-system, sans-serif; cursor: pointer; }
.ve-rr-send { background: linear-gradient(160deg, color-mix(in srgb, var(--ve-foil) 55%, white) 0%, var(--ve-foil) 45%, color-mix(in srgb, var(--ve-foil) 82%, black) 100%); color: ${REPLY_TOKENS.ink}; border: 1.5px solid ${REPLY_TOKENS.goldEdge}; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18); }
.ve-rr-again { background: transparent; color: ${REPLY_TOKENS.ink}; border: 1.5px solid ${REPLY_TOKENS.ink}; }
.ve-rr-send:disabled, .ve-rr-again:disabled { opacity: 0.7; }
.ve-rr-name { width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid ${REPLY_TOKENS.track}; background: #fffdf6; color: ${REPLY_TOKENS.ink}; font: 16px system-ui, sans-serif; }
.ve-rr-sent { margin: 0; text-align: center; font: 700 18px/1.3 system-ui, -apple-system, sans-serif; color: ${REPLY_TOKENS.ink}; }
.ve-rr-note { margin: 0; text-align: center; font-size: 14px; color: ${REPLY_TOKENS.muted}; }
.ve-rr-error { margin: 0; text-align: center; font-size: 14px; color: #8f1d12; }
.ve-rr-record:focus-visible, .ve-rr-play:focus-visible, .ve-rr-send:focus-visible, .ve-rr-again:focus-visible { outline: 2px solid ${REPLY_TOKENS.ink}; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .ve-rr-ring.is-on { animation: none; box-shadow: 0 0 0 6px rgba(9, 22, 77, 0.2); } }
`
