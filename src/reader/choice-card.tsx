'use client'
// ONE DRAWING of a choice (feedback page, 2026-11-11): the Helm's call card and the hub's ask card
// are this component in two looks. It draws and reports taps; it decides nothing. Who answers, what
// counts and what a tap writes stay with the caller, so a call keeps one meaning and an ask keeps its own.
// Ported from helm2/src/tile-apps/reviews/calls.tsx (CallCard, OptionButton).
import type { CSSProperties, ReactNode } from 'react'

export type ChoiceOption = { label: string; because: string; recommended: boolean }
export type ChoiceCardLook = { card: string; top: string; question: string; option: string; optionOn: string; optionRecommended: string; why: string; whyOn: string; rec: string; recOn: string; changed: string; said: string; other: string }
export const CHOICE_TYPE_WORDS: Record<string, string> = { 'pick-one': 'Pick one', 'accept-or-reject': 'Accept or reject', 'say-what-you-want': 'Say what you want' }
const RECOMMENDED = 'Recommended'

/** The hub's look: feedback-page.html's .call and .opt rules on the --a-* tokens. */
export const HUB_CHOICE_LOOK: ChoiceCardLook = {
  card: 'my-6 flex flex-col gap-2 rounded-2xl bg-[color:var(--a-surface)] p-4 shadow-[inset_0_0_0_1.5px_var(--a-line-strong),0_3px_0_var(--a-line)]',
  top: 'flex items-baseline justify-between gap-3 text-sm font-semibold text-[color:var(--a-muted)]',
  question: 'm-0 mb-1 text-[1.375rem] leading-tight text-[color:var(--a-strong)]',
  option: 'flex min-h-12 w-full flex-col items-start rounded-xl px-3 py-2 text-left text-base text-[color:var(--a-strong)] shadow-[inset_0_0_0_1.5px_var(--a-line-strong)]',
  optionOn: 'bg-[color:var(--a-accent)] text-[color:var(--a-on-accent)] !shadow-none',
  optionRecommended: '!shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
  why: 'text-sm leading-snug text-[color:var(--a-muted)]',
  whyOn: 'text-sm leading-snug text-[color:var(--a-on-accent)]',
  rec: 'text-[0.72rem] font-bold uppercase tracking-[0.04em] text-[color:var(--a-accent)]',
  recOn: 'text-[0.72rem] font-bold uppercase tracking-[0.04em] text-[color:var(--a-on-accent)]',
  changed: 'text-sm font-semibold text-[color:var(--a-accent)]',
  said: 'text-base text-[color:var(--a-strong)]',
  other: 'min-h-11 self-start text-sm font-semibold text-[color:var(--a-strong)] underline underline-offset-2',
}

export type ChoiceCardProps = {
  kicker: string; number: number; total: number; question: string; questionStyle?: CSSProperties
  options: ChoiceOption[]; picked: string | null; said: string | null; changed: string | null; otherWords: string | null
  onPick(label: string): void; onOther(): void; box?: ReactNode; look: ChoiceCardLook; attrs?: Record<string, string>
}

export function ChoiceCard({ kicker, number, total, question, questionStyle, options, picked, said, changed, otherWords, onPick, onOther, box, look, attrs }: ChoiceCardProps) {
  return (
    <section aria-label={question} className={look.card} {...attrs}>
      <div className={look.top}>
        <span>{kicker}</span>
        <span className="shrink-0 tabular-nums">{`${number} of ${total}`}</span>
      </div>
      <p role="heading" aria-level={3} className={look.question} style={questionStyle}>{question}</p>
      {changed ? <p className={look.changed}>{changed}</p> : null}
      {options.map((o) => {
        const on = picked === o.label
        return (
          <button key={o.label} type="button" aria-pressed={on} onClick={() => onPick(o.label)} data-recommended={o.recommended ? '' : undefined}
            className={`${look.option} ${on ? look.optionOn : o.recommended ? look.optionRecommended : ''}`}>
            <span className="font-semibold">{o.label}</span>
            <span className={on ? look.whyOn : look.why}>{o.because}</span>
            {o.recommended ? <span className={on ? look.recOn : look.rec}>{RECOMMENDED}</span> : null}
          </button>
        )
      })}
      {said ? <p className={look.said}>{said}</p> : null}
      {box ?? (otherWords ? <button type="button" onClick={onOther} className={look.other}>{otherWords}</button> : null)}
    </section>
  )
}
