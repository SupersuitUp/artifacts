// ASKS (feedback page, 2026-11-11). A question a shared draft puts to its readers. The Mac parses the
// ```ask block (Supersuit's supersuit-review-calls.mjs) and sends it here as DATA in `asks:`; the body
// carries only a ```askcard slot naming the ask's id. The hub never parses an ask block. Each reader's
// answer is a record in the `asks` slot, private to the owner; the Mac counts them.
import type { StateConfig } from './state.js'

export const ASKS_SLOT = 'asks'
export const ASK_TYPES = ['pick-one', 'accept-or-reject', 'say-what-you-want'] as const
export type AskType = (typeof ASK_TYPES)[number]
export type AskOption = { label: string; because: string; recommended: boolean }
export type AskData = { id: string; type: AskType; question: string; hash: string; options: AskOption[] }
export type AskAnswer = { ask: string; hash: string; choice: string | null; words: string | null; name?: string }
export const MAX_ASKS = 12
export const MAX_ASK_WORDS = 4000

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const HASH = /^[0-9a-f]{12}$/
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

export function parseAsks(raw: unknown): { ok: true; asks: AskData[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'asks must be a list' }
  if (raw.length > MAX_ASKS) return { ok: false, error: `a page asks at most ${MAX_ASKS} questions` }
  const asks: AskData[] = []
  for (const a of raw) {
    if (!isMap(a) || Object.keys(a).some((k) => !['id', 'type', 'question', 'hash', 'options'].includes(k))) return { ok: false, error: 'each ask has id, type, question, hash and options' }
    if (typeof a.id !== 'string' || !ID.test(a.id)) return { ok: false, error: 'an ask id is lowercase words and hyphens' }
    if (asks.some((x) => x.id === a.id)) return { ok: false, error: `the ask id ${a.id} is used twice` }
    if (!ASK_TYPES.includes(a.type as AskType)) return { ok: false, error: `ask ${a.id}: the type must be one of ${ASK_TYPES.join(', ')}` }
    if (!text(a.question, 300)) return { ok: false, error: `ask ${a.id} has no question` }
    if (typeof a.hash !== 'string' || !HASH.test(a.hash)) return { ok: false, error: `ask ${a.id}: hash must be 12 hex` }
    if (!Array.isArray(a.options) || a.options.length > 8) return { ok: false, error: `ask ${a.id}: options must be a list of up to 8` }
    const options: AskOption[] = []
    for (const o of a.options) {
      if (!isMap(o) || !text(o.label, 200) || typeof o.because !== 'string' || o.because.length > 400 || typeof o.recommended !== 'boolean') return { ok: false, error: `ask ${a.id}: each option has label, because and recommended` }
      options.push({ label: o.label as string, because: o.because, recommended: o.recommended })
    }
    if ((a.type === 'say-what-you-want') !== (options.length === 0)) return { ok: false, error: `ask ${a.id}: say-what-you-want takes no options, and the others need them` }
    asks.push({ id: a.id, type: a.type as AskType, question: a.question as string, hash: a.hash, options })
  }
  return { ok: true, asks }
}

/** The id each ```askcard slot names, in order. The slot holds the id alone. */
export function askcardIds(markdown: string): string[] {
  return [...markdown.matchAll(/^ {0,3}```askcard[ \t]*\n[ \t]*([^\n`]*?)[ \t]*\n {0,3}```[ \t]*$/gm)].map((m) => m[1])
}

export function mergeAsksState(state: StateConfig | undefined, asks: AskData[] | undefined): { ok: true; state: StateConfig | undefined } | { ok: false; error: string } {
  if (!asks?.length) return { ok: true, state }
  if (state && Object.hasOwn(state.slots, ASKS_SLOT)) return { ok: false, error: `asks: writes to slot "${ASKS_SLOT}", and state: declares a slot by that name; rename that slot` }
  const base: StateConfig = state ?? { writers: 'signed-in', visibility: 'private', slots: {} }
  return { ok: true, state: { ...base, slots: { ...base.slots, [ASKS_SLOT]: { shape: 'many', visibility: 'private', writers: 'anyone' } } } }
}

export function checkAskAnswer(v: unknown, asks: AskData[]): string | null {
  if (!isMap(v) || Object.keys(v).some((k) => !['ask', 'hash', 'choice', 'words', 'name'].includes(k))) return 'an answer has ask, hash, choice, words and an optional name'
  const ask = asks.find((a) => a.id === v.ask)
  if (!ask) return `there is no ask ${String(v.ask)} on this page`
  if (v.hash !== ask.hash) return 'this question changed since the page was opened: reload and look again'
  const choice = v.choice === null ? null : typeof v.choice === 'string' ? v.choice : undefined
  const words = v.words === null ? null : typeof v.words === 'string' ? v.words.trim() : undefined
  if (choice === undefined || words === undefined) return 'choice and words are text or null'
  if (choice !== null && !ask.options.some((o) => o.label === choice)) return `"${choice}" is not one of this question's options`
  if (choice === null && !words) return 'an answer is an option or words'
  if (words && words.length > MAX_ASK_WORDS) return `an answer is at most ${MAX_ASK_WORDS} characters`
  if (v.name !== undefined && !text(v.name, 80)) return 'a name is 1 to 80 characters'
  return null
}
