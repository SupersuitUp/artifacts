'use client'
// "Reply with your voice" on a voice eCard: the one way to answer it (Gary, 2026-11-25: "Remove
// comment feature methinks ya?"). No comment layer, no selection to comment, no pins, no threads:
// it opens straight into the recorder (the comment card's own VoiceRecorder), and Send uploads the
// memo exactly as a comment's recording (hostVoice, scope `comment`) and appends it to the page's
// comments slot, anchored to the letter at the second the voice was at. That slot is the record the
// owner's reader summary reads, so the reply shows there and `goal: respond` counts it.
import { useMemo, useState } from 'react'
import { AudioPlay, VoiceRecorder, hostVoice, type VoiceHost, type VoiceMemo } from './voice-recorder.js'
import { COMMENTS_SLOT, MAX_COMMENT_NAME_CHARS } from '../artifacts/comments.js'

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
  accent?: string
  /** The page's voice routes; tests pass a stub. */
  voice?: VoiceHost
}

const canRecord = () => typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export function VoiceReply({ artifactId, blockId, ownerName, version, at, requireName = false, accent = 'currentColor', voice }: VoiceReplyProps) {
  const host = useMemo(() => voice ?? hostVoice(artifactId), [voice, artifactId])
  const [memo, setMemo] = useState<VoiceMemo | null>(null)
  const [stage, setStage] = useState<'ready' | 'recording' | 'review' | 'sending' | 'sent'>('ready')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const url = useMemo(() => (memo ? URL.createObjectURL(memo.blob) : null), [memo])

  const send = async () => {
    if (!memo) return
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

  if (stage === 'sent') return <p className="ve-reply-sent" role="status" data-voice-reply-sent>{`Sent. ${ownerName} will hear it.`}</p>
  return (
    <div className="ve-reply-panel" data-voice-reply-panel data-stage={stage}>
      {stage === 'review' || stage === 'sending' ? (
        <>
          {url ? <AudioPlay src={url} accent={accent} /> : null}
          {requireName ? (
            <input name="by" className="ve-reply-name" placeholder="Your first name" maxLength={MAX_COMMENT_NAME_CHARS} value={name} onChange={(e) => setName(e.target.value)} />
          ) : null}
          <div className="ve-reply-actions">
            <button type="button" className="ve-btn ve-reply" onClick={() => void send()} disabled={stage === 'sending'} data-voice-reply-send>
              {stage === 'sending' ? 'Sending…' : `Send to ${ownerName}`}
            </button>
            <button type="button" className="ve-btn ve-again" onClick={() => { setMemo(null); setStage('ready'); setError(null) }} disabled={stage === 'sending'} data-voice-reply-again>Record again</button>
          </div>
        </>
      ) : (
        <div className="ve-reply-mic" data-voice-reply-mic>
          <VoiceRecorder accent={accent}
            onStart={() => { setStage('recording'); setError(null) }}
            onStop={(m) => { setMemo(m); setStage('review') }}
            onError={(msg) => { setError(msg); setStage('ready') }} />
          <span className="ve-reply-hint">{stage === 'recording' ? 'Recording. Tap to stop.' : canRecord() ? 'Tap to record' : 'This browser cannot record here.'}</span>
        </div>
      )}
      {error ? <p className="ve-reply-error" role="alert">{error}</p> : null}
    </div>
  )
}
