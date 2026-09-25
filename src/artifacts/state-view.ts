// What each side is shown. A reader gets their own answers, plus tallies or shared entries where
// the page allows, and NEVER an email. The publisher (publish key) gets everything.
import { createHash } from 'node:crypto'
import { slotVisibility, type Shape, type StateConfig, type Visibility } from './state.js'
import type { StateEntry } from './state-store.js'

export type Tally = { signedIn: Record<string, number>; anonymous: Record<string, number> }
export type SharedEntry = { id: string; name: string; value: unknown; at: string; mine: boolean }
export type SlotView = { shape: Shape; visibility: Visibility; mine: unknown | { id: string; value: unknown; at: string }[] | null; tally?: Tally; shared?: SharedEntry[] }

const byAt = (a: StateEntry, b: StateEntry) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)
const firstWord = (name: string | null) => (name?.trim() ? name.trim().split(/\s+/)[0] : 'a reader')

// A `one` entry's raw id is `<page>__<slot>__<readerKey>`, and the reader key inside it (`u:<uid>`
// or `a:<anonId>`) is a credential: whoever reads it can write as that reader by minting the same
// anonymous cookie. A `shared` slot handed that id straight to every reader, so it is hashed to
// an opaque, stable value instead. `many` entries keep their random id; it names nothing.
const opaqueOneId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16)

/** Counts per option. A list value (multiple choice) counts each item; objects are not tallied.
 *  Anonymous answers are counted apart, because anyone can answer again by clearing a cookie. */
function tallyOf(entries: StateEntry[]): Tally {
  const t: Tally = { signedIn: {}, anonymous: {} }
  for (const e of entries) {
    const bucket = e.writer.anonymous ? t.anonymous : t.signedIn
    const items = Array.isArray(e.value) ? e.value : [e.value]
    for (const v of items) {
      if (v === null || typeof v === 'object') continue
      const k = String(v)
      bucket[k] = (bucket[k] ?? 0) + 1
    }
  }
  return t
}

export function stateView(state: StateConfig, entries: StateEntry[], readerKey: string | null): Record<string, SlotView> {
  const out: Record<string, SlotView> = {}
  for (const [slot, def] of Object.entries(state.slots)) {
    const here = entries.filter((e) => e.slot === slot).sort(byAt)
    const mine = readerKey ? here.filter((e) => e.readerKey === readerKey) : []
    const visibility = slotVisibility(state, slot)
    const view: SlotView = {
      shape: def.shape,
      visibility,
      mine: def.shape === 'one' ? (mine[0]?.value ?? null) : mine.map((e) => ({ id: e.id, value: e.value, at: e.at })),
    }
    if (visibility === 'tally') view.tally = tallyOf(here)
    if (visibility === 'shared')
      view.shared = here.map((e) => ({
        id: def.shape === 'one' ? opaqueOneId(e.id) : e.id,
        name: firstWord(e.writer.name), value: e.value, at: e.at, mine: e.readerKey === readerKey,
      }))
    out[slot] = view
  }
  return out
}

export type Response = { slot: string; id: string; value: unknown; at: string; email: string | null; name: string | null; anonymous: boolean }

export function responsesOf(entries: StateEntry[]): Response[] {
  return entries.slice().sort(byAt).map((e) => ({
    slot: e.slot, id: e.id, value: e.value, at: e.at, email: e.writer.email ?? null, name: e.writer.name, anonymous: e.writer.anonymous,
  }))
}

// A cell a spreadsheet reads as a formula (leading =, +, -, @, tab or CR) gets an escaping
// leading quote first: a reader's answer becomes text a formula, not a command a publisher's
// spreadsheet app runs the moment the CSV is opened.
const FORMULA_LEAD = /^[=+\-@\t\r]/
const cell = (v: string) => {
  const safe = FORMULA_LEAD.test(v) ? `'${v}` : v
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
export function responsesCsv(rows: Response[]): string {
  const head = 'slot,id,at,email,name,anonymous,value'
  return [head, ...rows.map((r) => [r.slot, r.id, r.at, r.email ?? '', r.name ?? '', String(r.anonymous), JSON.stringify(r.value)].map(cell).join(','))].join('\n')
}
