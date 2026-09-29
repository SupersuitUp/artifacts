'use client'
// The card a comment is written in. It says, before anything is typed, who will read it: when the
// reader cannot share, the first line in the card is the warning that this is a personal note the
// owner will never see, shown every time, because the moment it matters is the moment someone is
// about to write something they meant for the owner. When they can share, a switch picks Share
// (the default) or Just for me.
import { useState, type FormEvent } from 'react'
import { MAX_COMMENT_CHARS, type CommentsMode } from '../artifacts/comments.js'

/** The warning, word for word. `They` is fixed copy: the card never guesses a pronoun. */
export function warningLine(ownerName: string, mode: CommentsMode): string {
  const why = mode === 'off'
    ? `${ownerName} has not opened this page to comments`
    : `${ownerName} takes comments on this page from signed-in readers`
  return `Only you will see this. ${why}, so this is a personal note. They won't see it.`
}
export const DEVICE_LINE = 'Saved on this device. Sign in to keep it everywhere.'

export function CommentCard({
  ownerName, mode, canShare, signedIn, quote, initial = '', accent = 'currentColor', signIn, onSave, onCancel,
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
  /** Resolves to an error to show, or null when saved. */
  onSave: (body: string, share: boolean) => Promise<string | null>
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const [share, setShare] = useState(canShare)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const personal = !canShare || !share
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    const err = await onSave(body, canShare && share)
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
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit() }}
        maxLength={MAX_COMMENT_CHARS}
        rows={3}
        aria-label={personal ? 'A personal note' : `A comment for ${ownerName}`}
        placeholder={personal ? 'A note for yourself' : `A comment for ${ownerName}`}
        className="w-full rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-ground,transparent)] p-2 text-[15px]"
      />
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
        <button type="submit" data-comment-save disabled={busy || !text.trim()} className="rounded-full px-4 py-1 text-sm font-medium disabled:opacity-40" style={{ background: accent, color: 'var(--a-on-accent, #111)' }}>
          {personal ? 'Save note' : 'Comment'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm opacity-70 hover:opacity-100">Cancel</button>
      </div>
    </form>
  )
}
