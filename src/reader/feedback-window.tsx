'use client'
// The banner a reviewer sees on a draft sent for feedback (0.40.0): whose draft it is, the one line
// the owner wrote about what they want, and how long the reader has, counted down while the page is
// open. Everything here is data-nospeak: it is furniture, never part of the piece.
import { useEffect, useState } from 'react'

export const FEEDBACK_CLOSED_LINE = 'Feedback is closed. You can still read the draft and your own notes.'

/** "3 days left", "23 hours left", "45 minutes left"; null once the window has passed or cannot be read. */
export function timeLeft(closesAt: string, now: number): string | null {
  const ms = Date.parse(closesAt) - now
  if (!(ms > 0)) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes >= 2880) return `${Math.floor(minutes / 1440)} days left`
  if (minutes >= 120) return `${Math.floor(minutes / 60)} hours left`
  if (minutes >= 2) return `${minutes} minutes left`
  return '1 minute left'
}

export function FeedbackWindow({ owner, label, note, group, closesAt, now }: {
  owner: string; label: string; note: string | null
  /** An open link, shared by several people: nobody is named. */
  group: boolean; closesAt: string
  /** The clock, for tests. Left out, the banner reads the real one and ticks. */
  now?: number
}) {
  const [at, setAt] = useState(() => now ?? Date.now())
  useEffect(() => {
    if (now !== undefined) return
    const t = setInterval(() => setAt(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [now])
  const left = timeLeft(closesAt, at)
  return (
    <aside data-feedback-window data-nospeak className="mx-auto mt-6 mb-0 max-w-2xl px-6">
      <div className="rounded-xl border border-[color:var(--a-line-strong)] px-4 py-3 text-[15px]">
        <p className="m-0 font-medium">{`A draft from ${owner}${group ? '' : `, for ${label}`}`}</p>
        {note ? <p data-feedback-note className="m-0 mt-1">{note}</p> : null}
        {/* The server and the browser read the clock a moment apart, so the text may differ by a minute. */}
        <p data-feedback-left aria-live="polite" suppressHydrationWarning className="m-0 mt-1 opacity-80">{left ? `Feedback is open: ${left}.` : FEEDBACK_CLOSED_LINE}</p>
      </div>
    </aside>
  )
}
