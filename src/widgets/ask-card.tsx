'use client'
// The reader's side of an ask (feedback page, 2026-11-11), drawn like the review page's call card in
// the hub's look (feedback-page.html). Every tap is one append to the asks slot; nothing here counts.
import { useState, useSyncExternalStore } from 'react'
import type { AskData, AskAnswer } from '../artifacts/asks.js'
import { ChoiceCard, CHOICE_TYPE_WORDS, HUB_CHOICE_LOOK } from '../reader/choice-card.js'
import { askStoreFor, EMPTY_ASKS } from './ask-store.js'
import { NO_ZOOM_FONT } from '../reader/no-zoom.js'

export type AskCtx = { artifactId: string; asks: AskData[]; owner: string; reader: string | null; requireName: boolean; display: string }
const useAsks = (artifactId: string) => { const s = askStoreFor(artifactId); return { store: s, snap: useSyncExternalStore(s.subscribe, s.get, () => EMPTY_ASKS) } }
const changedLine = (owner: string) => `${owner} changed this. Please look again`

export function AskFence({ id, ctx }: { id: string; ctx: AskCtx }) {
  const { store, snap } = useAsks(ctx.artifactId)
  const [other, setOther] = useState(false)
  const [words, setWords] = useState('')
  const [typedHere, setTypedHere] = useState(false)
  const ask = ctx.asks.find((a) => a.id === id)
  if (!ask) return null
  const mine = snap.mine[id]
  const current = mine && mine.hash === ask.hash ? mine : null
  const name = snap.name.trim()
  const needsName = ctx.requireName && !name
  const send = (choice: string | null, said: string | null) => {
    if (needsName) return
    const a: AskAnswer = { ask: id, hash: ask.hash, choice, words: said, ...(ctx.requireName ? { name } : {}) }
    void store.answer(a).then((ok) => { if (ok && said !== null) { setOther(false); setWords('') } })
  }
  const who = ctx.reader ?? 'You'
  const open = ask.type === 'say-what-you-want' || other
  const box = open ? (
    <div className="flex flex-col gap-2">
      <textarea aria-label="Your answer" rows={3} style={NO_ZOOM_FONT} value={words} onChange={(e) => setWords(e.currentTarget.value)}
        className="w-full rounded-xl border border-[color:var(--a-line-strong)] bg-transparent p-3 text-base text-[color:var(--a-strong)]" />
      <button type="button" disabled={!words.trim() || needsName} onClick={() => send(null, words.trim())}
        className="min-h-11 self-start rounded-full bg-[color:var(--a-accent)] px-5 font-semibold text-[color:var(--a-on-accent)] disabled:opacity-50">Send</button>
    </div>
  ) : undefined
  return (
    <div data-nospeak>
      {ctx.requireName && (needsName || typedHere) ? (
        <label className="mb-2 block text-sm text-[color:var(--a-muted)]">Your first name
          <input value={snap.name} onChange={(e) => { setTypedHere(true); store.setName(e.currentTarget.value) }} aria-label="Your first name" style={NO_ZOOM_FONT}
            className="mt-1 block w-full rounded-lg border border-[color:var(--a-line-strong)] bg-transparent px-3 py-2 text-base text-[color:var(--a-strong)]" />
        </label>
      ) : null}
      <ChoiceCard kicker={`${ctx.owner} asks · ${CHOICE_TYPE_WORDS[ask.type] ?? ask.type}`} number={ctx.asks.indexOf(ask) + 1} total={ctx.asks.length}
        question={ask.question} questionStyle={{ fontFamily: ctx.display }} options={ask.options} picked={current?.choice ?? null}
        said={current?.words ? `${who} said: ${current.words}` : null} changed={mine && !current ? changedLine(ctx.owner) : null}
        otherWords={ctx.reader ? `${ctx.reader} says something else` : 'Say something else'} onPick={(label) => send(label, null)} onOther={() => setOther(true)}
        box={box} look={HUB_CHOICE_LOOK} attrs={{ 'data-ask-card': id }} />
      {snap.error ? <p role="alert" className="text-sm text-[color:var(--a-accent)]">{snap.error}</p> : null}
    </div>
  )
}

const goTo = (id: string) => document.querySelector(`[data-ask-card="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

/** The end of the page, as the review page ends: each ask and where the reader stands on it. */
export function YourAnswers({ ctx }: { ctx: AskCtx }) {
  const { snap } = useAsks(ctx.artifactId)
  return (
    <section data-your-answers data-nospeak aria-labelledby="your-answers-title" className="mx-auto mt-8 max-w-2xl border-t border-[color:var(--a-line)] px-6 pt-5">
      <h2 id="your-answers-title" className="m-0 mb-2 text-xl text-[color:var(--a-strong)]" style={{ fontFamily: ctx.display }}>Your answers</h2>
      {ctx.asks.map((a) => {
        const mine = snap.mine[a.id]
        const current = mine && mine.hash === a.hash ? mine : null
        const rec = a.options.find((o) => o.recommended)?.label
        const line = current ? (current.choice ?? `Said: ${current.words}`) : mine ? changedLine(ctx.owner) : rec ? `Not made yet. Recommended: ${rec}` : 'Not made yet.'
        return (
          <div key={a.id} className="flex items-start justify-between gap-3 border-t border-[color:var(--a-line)] py-2">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[0.95rem] font-semibold text-[color:var(--a-strong)]">{a.question}</p>
              <p className={`m-0 text-[0.85rem] ${current ? 'text-[color:var(--a-muted)]' : 'font-semibold text-[color:var(--a-accent)]'}`}>{line}</p>
            </div>
            <button type="button" aria-label={`${current ? 'Change' : 'Make it'}: ${a.question}`} onClick={() => goTo(a.id)}
              className="min-h-11 shrink-0 self-start text-[0.85rem] font-semibold text-[color:var(--a-strong)] underline">{current ? 'Change' : 'Make it'}</button>
          </div>
        )
      })}
      <p className="mt-3 text-[0.8rem] text-[color:var(--a-muted)]">{`Saved as you go. Your answers reach ${ctx.owner} within a few minutes.`}</p>
    </section>
  )
}
