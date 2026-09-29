'use client'
// The card a comment is written in. It says, before anything is typed, who will read it: when the
// reader cannot share, the first line in the card is the warning that this is a personal note the
// owner will never see, shown every time, because the moment it matters is the moment someone is
// about to write something they meant for the owner. When they can share, a switch picks Share
// (the default) or Just for me.
//
// A voice memo (voice-recorder.tsx) writes into the same box: the browser's live transcript while
// you speak, then the host's transcript when the recording stops, unless you have edited the box
// since, in which case your words win. With neither, the memo is kept and the box stays empty.
import { useRef, useState, type FormEvent } from 'react'
import { NO_ZOOM_FONT } from './no-zoom.js'
import { MAX_COMMENT_CHARS, type CommentValue, type CommentsMode } from '../artifacts/comments.js'
import { VoiceRecorder, type VoiceHost, type VoiceMemo, type VoiceScope } from './voice-recorder.js'

/** A memo as the card hands it to be saved: the recording, where it was already uploaded (if it
 *  was, and for which kind), and where the words in the box came from. */
export type SavedMemo = { memo: VoiceMemo; uploaded: { scope: VoiceScope; path: string } | null; transcript?: CommentValue['transcript'] }

/** The warning, word for word. `They` is fixed copy: the card never guesses a pronoun. */
export function warningLine(ownerName: string, mode: CommentsMode): string {
  const why = mode === 'off'
    ? `${ownerName} has not opened this page to comments`
    : `${ownerName} takes comments on this page from signed-in readers`
  return `Only you will see this. ${why}, so this is a personal note. They won't see it.`
}
export const DEVICE_LINE = 'Saved on this device. Sign in to keep it everywhere.'

export function CommentCard({
  ownerName, mode, canShare, signedIn, quote, initial = '', accent = 'currentColor', signIn, voice = null, onSave, onCancel,
}: {
  ownerName: string
  mode: CommentsMode
  canShare: boolean
  signedIn: boolean
  /** The quoted text the comment is pinned to, shown above the box. */
  quote?: string
  initial?: string
  accent?: string
  signIn?: string | null
  /** The page's voice routes. Null: a memo is kept but never uploaded or transcribed here. */
  voice?: VoiceHost | null
  /** Resolves to an error to show, or null when saved. */
  onSave: (body: string, share: boolean, memo?: SavedMemo) => Promise<string | null>
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const [share, setShare] = useState(canShare)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memo, setMemo] = useState<VoiceMemo | null>(null)
  const [transcript, setTranscript] = useState<CommentValue['transcript']>(undefined)
  const [status, setStatus] = useState<string | null>(null)
  // Refs, because the host's transcript arrives after an await and must see the box as it is then.
  const base = useRef('')
  const edited = useRef(false)
  const uploaded = useRef<SavedMemo['uploaded']>(null)
  const personal = !canShare || !share
  // Where a memo goes: a shared comment, the reader's account, or (neither) this device only.
  const scope = (): VoiceScope | null => (canShare && share ? 'comment' : signedIn ? 'personal' : null)

  const recorded = async (m: VoiceMemo) => {
    setMemo(m)
    uploaded.current = null
    edited.current = false
    const where = scope()
    if (!voice || !where) return
    setStatus('Transcribing')
    const path = await voice.upload(m, where)
    if (path) {
      uploaded.current = { scope: where, path }
      const heard = await voice.transcribe(path)
      if (heard && !edited.current) {
        setText(base.current ? `${base.current} ${heard}` : heard)
        setTranscript('host')
      }
    }
    setStatus(null)
  }
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const body = text.trim()
    if ((!body && !memo) || busy) return
    setBusy(true)
    const err = memo
      ? await onSave(body, canShare && share, { memo, uploaded: uploaded.current, ...(body && transcript ? { transcript } : {}) })
      : await onSave(body, canShare && share)
    setBusy(false)
    setError(err)
  }
  return (
    <form data-comment-card data-comment-ui data-nospeak onSubmit={submit}
      className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[color:var(--a-line-strong)] bg-[color:var(--a-surface)] p-3 text-left font-sans text-sm text-[color:var(--a-strong)] shadow-xl">
      {!canShare ? (
        <p data-comment-warning role="note" className="mb-2 rounded-lg border px-3 py-2 text-[13px] leading-snug" style={{ borderColor: accent }}>
          {warningLine(ownerName, mode)}
        </p>
      ) : null}
      {quote ? <p className="mb-2 line-clamp-3 border-l-2 pl-2 text-[13px] italic opacity-75" style={{ borderColor: accent }}>{quote}</p> : null}
      <textarea
        value={text}
        autoFocus
        style={NO_ZOOM_FONT}
        onChange={(e) => { setText(e.target.value); edited.current = true; setTranscript('typed') }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit() }}
        maxLength={MAX_COMMENT_CHARS}
        rows={3}
        aria-label={personal ? 'A personal note' : `A comment for ${ownerName}`}
        placeholder={personal ? 'A note for yourself' : `A comment for ${ownerName}`}
        className="w-full rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-ground,transparent)] p-2 text-[15px]"
      />
      <VoiceRecorder accent={accent}
        onStart={() => { base.current = text.trim(); setMemo(null); setTranscript(undefined); setError(null) }}
        onLive={(heard) => { setText(base.current ? `${base.current} ${heard}` : heard); setTranscript('browser') }}
        onStop={(m) => void recorded(m)}
        onError={setError} />
      {memo ? (
        <p data-voice-kept className="m-0 mt-1 text-xs opacity-70">
          {status ?? 'Recording kept with this comment.'}
          <button type="button" data-voice-discard className="ml-2 underline" onClick={() => { setMemo(null); uploaded.current = null }}>Discard recording</button>
        </p>
      ) : null}
      {canShare ? (
        <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <legend className="sr-only">Who sees this</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name="comment-share" data-comment-share="share" checked={share} onChange={() => setShare(true)} />{`Share with ${ownerName}`}</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="comment-share" data-comment-share="mine" checked={!share} onChange={() => setShare(false)} />Just for me</label>
        </fieldset>
      ) : null}
      {personal && !signedIn ? (
        <p data-comment-device className="mt-2 text-xs opacity-70">
          {signIn ? <>Saved on this device. <a href={signIn} className="underline">Sign in to keep it everywhere.</a></> : DEVICE_LINE}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-amber-500">{error}</p> : null}
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" data-comment-save disabled={busy || (!text.trim() && !memo)} className="rounded-full px-4 py-1 text-sm font-medium disabled:opacity-40" style={{ background: accent, color: 'var(--a-on-accent, #111)' }}>
          {personal ? 'Save note' : 'Comment'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm opacity-70 hover:opacity-100">Cancel</button>
      </div>
    </form>
  )
}
