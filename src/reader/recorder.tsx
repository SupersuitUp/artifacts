'use client'
// The recorder (0.74.0), /record/<batch>: the owner records a voice eCard for each person in a
// batch, one at a time. The person's photo, name and the note that prompts what to say; one tap on
// the microphone records (the comment card's own VoiceRecorder: MediaRecorder, webm on Chrome, mp4
// on iPhone Safari); one tap saves and moves on. Saving uploads the raw take to the batch's private
// storage, mixes it over the bed in the browser (record-mix.ts) and uploads the mix, all before the
// page moves on, so closing the page loses nothing. It opens at the first person with no take
// (firstWaiting), and any take can be redone.
import { useCallback, useMemo, useRef, useState } from 'react'
import { VoiceRecorder, AudioPlay, type VoiceMemo } from './voice-recorder.js'
import { entriesOf, firstWaiting, type RecordBatch, type RecordEntry } from '../artifacts/record-store.js'
import { mixTake, tightenTake, type MixedTake, type TightTake } from './record-mix.js'
import { mixSettings, type MixSettings } from '../artifacts/mix.js'

export type RecorderProps = {
  batch: RecordBatch
  /** Where to open; defaults to the resume rule. */
  start?: number
  /** The page's accent. */
  accent?: string
  /** The mix, injectable for tests. */
  mix?: (voice: Blob, music: string | undefined, settings: MixSettings) => Promise<MixedTake>
  /** The bed as the page resolved it (0.75.0): a library track's address and where in the song to
   *  start. Without it, a batch's https `music` plays from its start. */
  bed?: { url: string; startAt: number }
  /** Cuts the take's long silences before review (0.75.0), injectable for tests. */
  tighten?: (voice: Blob, settings: MixSettings) => Promise<TightTake>
}

const bytesOf = (b: Blob) => (typeof b.arrayBuffer === 'function' ? b.arrayBuffer() : new Response(b).arrayBuffer())
const hex8 = async (b: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await bytesOf(b)))].slice(0, 4).map((x) => x.toString(16).padStart(2, '0')).join('')

/** One file up to the batch's private storage: a signed upload where the host has one, else the
 *  bytes through the route. The entry as stored, or an Error a person can read. */
export async function uploadTake(base: string, kind: 'raw' | 'mixed', blob: Blob, type: string, extra: { seconds?: number; voiceDelay?: number } = {}): Promise<RecordEntry> {
  const post = (body: unknown) => fetch(`${base}/take`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const digest = await hex8(blob)
  let r = await post({ kind, type, digest })
  if (r.status === 201) {
    const { uploadUrl, headers } = (await r.json()) as { uploadUrl: string; headers: Record<string, string> }
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body: blob })
    if (!put.ok) throw new Error('The recording did not upload. Try saving again.')
    r = await post({ kind, type, digest, done: true, ...extra })
  } else if (r.status === 501) {
    const q = new URLSearchParams({ kind, type, ...(extra.seconds !== undefined ? { seconds: String(extra.seconds) } : {}), ...(extra.voiceDelay !== undefined ? { voiceDelay: String(extra.voiceDelay) } : {}) })
    r = await fetch(`${base}/take?${q}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': type }, body: blob })
  }
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'The recording was not saved. Try again.')
  return ((await r.json()) as { entry: RecordEntry }).entry
}

const durationOf = (b: Blob) => new Promise<number | undefined>((done) => {
  try {
    const a = new Audio(URL.createObjectURL(b))
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : undefined)
    a.onerror = () => done(undefined)
  } catch { done(undefined) }
})

type Stage = 'ready' | 'recording' | 'review' | 'saving' | 'saved'

export function Recorder({ batch, start, accent = '#e7cb75', mix = mixTake, bed, tighten = tightenTake }: RecorderProps) {
  const [entries, setEntries] = useState<RecordEntry[]>(() => entriesOf(batch))
  const [at, setAt] = useState(() => start ?? firstWaiting(batch))
  const [stage, setStage] = useState<Stage>('ready')
  const [memo, setMemo] = useState<VoiceMemo | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The take as it will be sent: tightened when this browser can decode it, else as recorded.
  const [take, setTake] = useState<{ blob: Blob; mime: string; tightened: boolean } | null>(null)
  const memoUrl = useMemo(() => (take ? URL.createObjectURL(take.blob) : null), [take])
  const settingsFor = (tightened: boolean) => mixSettings({ musicStart: bed?.startAt ?? 0, tighten: !tightened })
  const review = async (m: VoiceMemo) => {
    setMemo(m)
    setTake(null)
    let t: TightTake | null = null
    try { t = await tighten(m.blob, settingsFor(false)) } catch { t = null }
    if (t && 'silent' in t) {
      setMemo(null)
      setError("We didn't catch any sound. Record again.")
      setStage('ready')
      return
    }
    setTake(t ? { blob: t.wav, mime: t.wav.type, tightened: true } : { blob: m.blob, mime: m.mime, tightened: false })
    setStage('review')
  }
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const person = entries[at]
  const done = entries.filter((e) => e.raw).length
  const base = person ? `/api/record/${batch.id}/${person.slug}` : ''

  const go = useCallback((i: number) => { setAt(i); setStage('ready'); setMemo(null); setTake(null); setError(null) }, [])
  const nextAfter = (list: RecordEntry[], i: number) => {
    const later = list.findIndex((e, k) => k > i && !e.raw)
    if (later !== -1) return later
    const first = list.findIndex((e) => !e.raw)
    return first === -1 ? list.length : first
  }

  const save = async () => {
    if (!take || !person) return
    setStage('saving')
    setError(null)
    try {
      const seconds = await durationOf(take.blob)
      // The raw take first: once it is stored, closing the page loses nothing.
      // The take as reviewed (tightened): the operator's computer times its words from this file.
      let entry = await uploadTake(base, 'raw', take.blob, take.mime, seconds !== undefined ? { seconds } : {})
      try {
        const bedUrl = bed?.url ?? (batch.music && /^https:/.test(batch.music) ? batch.music : undefined)
        const m = await mix(take.blob, bedUrl, settingsFor(take.tightened))
        entry = { ...entry, ...(await uploadTake(base, 'mixed', m.wav, 'audio/wav', { voiceDelay: m.voiceDelay, ...(seconds === undefined ? { seconds: Math.round(m.seconds * 100) / 100 } : {}) })) }
      } catch {
        // The raw take is kept; the operator's computer can mix it from the raw file.
      }
      const list = entries.map((e, i) => (i === at ? { ...e, ...entry } : e))
      setEntries(list)
      setStage('saved')
      savedTimer.current = setTimeout(() => go(nextAfter(list, at)), 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The recording was not saved. Try again.')
      setStage('review')
    }
  }

  return (
    <main className="rc-root" data-recorder data-stage={stage} style={{ ['--rc-accent' as string]: accent }}>
      <style dangerouslySetInnerHTML={{ __html: RECORDER_CSS }} />
      <header className="rc-head">
        <p className="rc-kicker">{batch.title}</p>
        <p className="rc-count" data-recorder-count>{`${done} of ${entries.length} recorded`}</p>
        <ol className="rc-strip" aria-label="People">
          {entries.map((e, i) => (
            <li key={e.slug}>
              <button type="button" onClick={() => go(i)} aria-current={i === at ? 'step' : undefined} aria-label={`${e.name}${e.raw ? ', recorded' : ''}`}
                className={`rc-dot${e.raw ? ' is-done' : ''}${i === at ? ' is-here' : ''}`} />
            </li>
          ))}
        </ol>
      </header>

      {!person ? (
        <section className="rc-card rc-finished" data-recorder-finished>
          <h1 className="rc-name">Everyone is recorded</h1>
          <p className="rc-note">{`${entries.length} voice eCards are ready to be built. Tap a dot above to listen again or redo one.`}</p>
        </section>
      ) : (
        <section className="rc-card" data-recorder-person={person.slug}>
          {person.photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="rc-photo" src={person.photo} alt="" />
            : <div className="rc-photo rc-initial" aria-hidden>{person.name.slice(0, 1)}</div>}
          <h1 className="rc-name">{person.name}</h1>
          {person.note ? <p className="rc-note" data-recorder-note>{person.note}</p> : null}

          {stage === 'review' || stage === 'saving' ? (
            <div className="rc-actions">
              {memoUrl ? <AudioPlay src={memoUrl} accent={accent} /> : null}
              <button type="button" className="rc-save" onClick={() => void save()} disabled={stage === 'saving'} data-recorder-save>
                {stage === 'saving' ? 'Saving…' : 'Save and next'}
              </button>
              <button type="button" className="rc-redo" onClick={() => { setMemo(null); setTake(null); setStage('ready') }} disabled={stage === 'saving'} data-recorder-redo>Redo</button>
            </div>
          ) : stage === 'saved' ? (
            <p className="rc-saved" role="status" data-recorder-saved>{`Saved for ${person.name}`}</p>
          ) : person.raw && stage === 'ready' && !memo ? (
            <div className="rc-actions" data-recorder-recorded>
              <AudioPlay src={`${base}/take?kind=${person.mixed ? 'mixed' : 'raw'}`} accent={accent} />
              <button type="button" className="rc-redo" onClick={() => setEntries((l) => l.map((e, i) => (i === at ? { ...e, raw: undefined } : e)))} data-recorder-redo>Redo</button>
              <button type="button" className="rc-skip" onClick={() => go(nextAfter(entries, at))}>Next person</button>
            </div>
          ) : (
            <div className="rc-mic" data-recorder-mic>
              <VoiceRecorder accent={accent} maxMs={5 * 60 * 1000}
                onStart={() => { setStage('recording'); setError(null) }}
                onStop={(m) => { void review(m) }}
                onError={(msg) => { setError(msg); setStage('ready') }} />
              <p className="rc-hint">{stage === 'recording' ? 'Recording. Tap to stop.' : 'Tap to record'}</p>
            </div>
          )}
          {error ? <p className="rc-error" role="alert">{error}</p> : null}
        </section>
      )}
    </main>
  )
}

export const RECORDER_CSS = String.raw`
.rc-root { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; padding: calc(20px + env(safe-area-inset-top, 0px)) 18px 32px; box-sizing: border-box; color: var(--a-ink, #f3ead6); font-family: system-ui, -apple-system, sans-serif; }
.rc-head { width: 100%; max-width: 460px; text-align: center; }
.rc-kicker { margin: 0; font-size: 11px; letter-spacing: 0.32em; text-indent: 0.32em; text-transform: uppercase; color: var(--rc-accent); }
.rc-count { margin: 6px 0 12px; font-size: 13px; opacity: 0.75; }
.rc-strip { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; list-style: none; margin: 0 0 18px; padding: 0; }
.rc-dot { width: 12px; height: 12px; padding: 0; border-radius: 50%; border: 1.5px solid var(--rc-accent); background: transparent; cursor: pointer; }
.rc-dot.is-done { background: var(--rc-accent); }
.rc-dot.is-here { box-shadow: 0 0 0 3px color-mix(in srgb, var(--rc-accent) 35%, transparent); transform: scale(1.25); }
.rc-card { width: 100%; max-width: 460px; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 26px 22px 28px; border-radius: 18px; box-sizing: border-box;
  background: color-mix(in srgb, var(--a-ink, #fff) 6%, var(--a-ground, #111)); border: 1px solid color-mix(in srgb, var(--rc-accent) 35%, transparent); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35); }
.rc-photo { width: 112px; height: 112px; border-radius: 50%; object-fit: cover; border: 2px solid var(--rc-accent); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); }
.rc-initial { display: flex; align-items: center; justify-content: center; font: 600 44px/1 Georgia, serif; color: var(--rc-accent); background: color-mix(in srgb, var(--rc-accent) 12%, transparent); }
.rc-name { margin: 16px 0 6px; font: 600 30px/1.2 var(--a-display, Georgia), Georgia, serif; }
.rc-note { margin: 0 0 22px; font-size: 17px; line-height: 1.45; opacity: 0.9; white-space: pre-line; max-height: 34dvh; overflow-y: auto; }
.rc-mic { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.rc-mic [data-voice-recorder] { margin: 0 !important; }
.rc-mic [data-voice-mic] { width: 92px !important; height: 92px !important; margin: 0 !important; border-radius: 50% !important; border: 2px solid var(--rc-accent) !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); }
.rc-mic [data-voice-mic] svg { width: 40px; height: 40px; }
.rc-mic [data-voice-mic][aria-pressed="true"] { animation: rc-pulse 1.4s ease-in-out infinite; }
.rc-mic [data-voice-icon="stop"] { width: 26px !important; height: 26px !important; border-radius: 6px !important; }
.rc-mic [data-voice-clock] { font-size: 15px !important; }
.rc-mic [data-voice-live-note] { display: none; }
@keyframes rc-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--rc-accent) 50%, transparent); } 50% { box-shadow: 0 0 0 16px transparent; } }
.rc-hint { margin: 0; font-size: 14px; opacity: 0.75; }
.rc-actions { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; }
.rc-save, .rc-redo, .rc-skip { border-radius: 999px; padding: 13px 22px; font: 700 16px/1 system-ui, -apple-system, sans-serif; cursor: pointer; }
.rc-save { background: var(--rc-accent); color: #111; border: none; min-width: 170px; }
.rc-save:disabled { opacity: 0.6; }
.rc-redo, .rc-skip { background: transparent; color: inherit; border: 1px solid color-mix(in srgb, var(--rc-accent) 60%, transparent); }
.rc-saved { margin: 8px 0 0; font-size: 17px; color: var(--rc-accent); font-weight: 600; }
.rc-error { margin: 14px 0 0; font-size: 14px; color: #ff9b8a; }
@media (prefers-reduced-motion: reduce) { .rc-mic [data-voice-mic][aria-pressed="true"] { animation: none; } }
`
