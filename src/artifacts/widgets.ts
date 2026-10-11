// Widgets: fenced blocks in a document's markdown that give readers a place to answer, drawn by
// the shell in the page's brand and written through the state API (state.ts, state-routes.ts).
//
// This version draws two widgets. `checklist` (./checklist.ts) is a list of items a reader ticks,
// kept in their own browser, with an optional Send that hands their ticks to the page's owner
// through the `one` slot `checklist`. `notes` is a small note control beside every heading, kept
// in the `many` slot `notes`. A note stores the heading it was left under, both its slug and its text,
// so a republish that renames or removes the heading keeps the note and shows it under "notes
// on earlier versions" instead of losing it or attaching it to the wrong section.
//
// Everything here is pure and server-safe: parsing, publish-time validation, the heading slugs
// the renderer and the stored notes agree on, and where each note is placed. The drawing lives
// in ../widgets/notes.tsx.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent, Code, Nodes } from 'mdast'
import type { StateConfig, Visibility } from './state.js'
import { blockId } from './anchor.js'
import { MAX_NOTE_CHARS, NOTES_SLOT, type Heading } from './notes-place.js'
import { CHECKLIST_SLOT, assignChecklistIds, parseChecklistFence, type ChecklistBlock, type ChecklistItem, type RawChecklistBlock } from './checklist.js'

export { MAX_NOTE_CHARS, NOTES_SLOT, placeNotes, type Heading, type NoteValue, type PlacedNote } from './notes-place.js'

/** Widgets the design names and this version does not draw yet. A fence using one is refused at
 *  publish, so a page never ships a code block that turns into a live widget on a later update. */
const NOT_YET = ['poll', 'form']
const MAX_HEADING_CHARS = 300

export type NotesWidget = { line: number; visibility?: Exclude<Visibility, 'tally'> }

const parse = (markdown: string) => unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root

function inline(nodes: PhrasingContent[]): string {
  let out = ''
  for (const n of nodes) {
    if (n.type === 'text' || n.type === 'inlineCode') out += n.value
    else if (n.type === 'break') out += ' '
    else if ('children' in n) out += inline(n.children as PhrasingContent[])
  }
  return out
}

function walk(nodes: RootContent[], visit: (n: RootContent) => void) {
  for (const n of nodes) {
    visit(n)
    if ('children' in n && n.type !== 'heading' && n.type !== 'paragraph') walk(n.children as RootContent[], visit)
  }
}

/** GitHub's rule: lowercase, drop everything but letters, digits, spaces, dashes and
 *  underscores, spaces to dashes. A heading of only punctuation is `section`. */
export function slugify(text: string): string {
  const s = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
  return s || 'section'
}

/** Every heading in source order, with the line it starts on and a slug unique on the page
 *  (a repeated heading gets `-1`, `-2`). The renderer finds a heading here by its line, so the
 *  slug a note stores is exactly the slug the page draws. */
export function headingsOf(markdown: string): Heading[] {
  const out: Heading[] = []
  const seen = new Map<string, number>()
  walk(parse(markdown).children, (n) => {
    if (n.type !== 'heading') return
    const text = inline(n.children).replace(/\s+/g, ' ').trim()
    const base = slugify(text)
    const k = seen.get(base) ?? 0
    seen.set(base, k + 1)
    out.push({ depth: n.depth, line: n.position?.start.line ?? 0, text, slug: k ? `${base}-${k}` : base })
  })
  return out
}

/** Finds the widget fences in a body. `offset` is how many lines of the file sit above the body
 *  (the front matter), so every error names the line the author sees in their editor. */
export function scanWidgets(body: string, offset: number):
  { ok: true; notes: NotesWidget | null; checklists: ChecklistBlock[] } | { ok: false; error: string } {
  const fences: Code[] = []
  walk(parse(body).children, (n) => { if (n.type === 'code') fences.push(n) })
  let notes: NotesWidget | null = null
  for (const f of fences) {
    const line = (f.position?.start.line ?? 1) + offset
    if (f.lang && NOT_YET.includes(f.lang)) return { ok: false, error: `line ${line}: the ${f.lang} widget is not available in this version of the artifacts package` }
    if (f.lang !== NOTES_SLOT) continue
    if (notes) return { ok: false, error: `line ${line}: a page takes at most one notes block` }
    if (f.meta?.trim()) return { ok: false, error: `line ${line}: the notes block takes no name; it always writes to slot "notes"` }
    const w: NotesWidget = { line }
    const rows = f.value ? f.value.split('\n') : []
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i].replace(/#.*$/, '').trim()
      if (!raw) continue
      const at = line + 1 + i
      const m = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(raw)
      if (!m) return { ok: false, error: `line ${at}: the notes block takes lines like "visibility: shared"` }
      if (m[1] !== 'visibility') return { ok: false, error: `line ${at}: the notes block has an unknown key: ${m[1]}` }
      if (m[2] !== 'private' && m[2] !== 'shared') return { ok: false, error: `line ${at}: notes visibility must be private or shared` }
      w.visibility = m[2]
    }
    notes = w
  }
  const lists = scanChecklists(fences, offset)
  if (!lists.ok) return lists
  return { ok: true, notes, checklists: lists.checklists }
}

function scanChecklists(fences: Code[], offset: number): { ok: true; checklists: ChecklistBlock[] } | { ok: false; error: string } {
  const lists: RawChecklistBlock[] = []
  for (const f of fences) {
    if (f.lang !== 'checklist') continue
    const line = (f.position?.start.line ?? 1) + offset
    const c = parseChecklistFence(f.value, line, f.meta)
    if (!c.ok) return c
    if (c.block.send && lists.some((l) => l.send)) return { ok: false, error: `line ${line}: a page takes at most one checklist with send` }
    const synced = lists.find((l) => l.sync)
    if (c.block.sync && synced && synced.sync !== c.block.sync)
      return { ok: false, error: `line ${line}: this checklist says sync: ${c.block.sync} and the one on line ${synced.line} says sync: ${synced.sync}; a page's ticks are one set, so say it one way` }
    if ((c.block.sync && lists.some((l) => l.send)) || (c.block.send && synced))
      return { ok: false, error: `line ${line}: a page whose checklists sync takes no send; the synced ticks already reach the owner` }
    lists.push(c.block)
  }
  const ids = assignChecklistIds(lists)
  return ids.ok ? { ok: true, checklists: ids.blocks } : ids
}

const fencesOf = (markdown: string) => {
  const fences: Code[] = []
  walk(parse(markdown).children, (n) => { if (n.type === 'code' && n.lang === 'checklist') fences.push(n) })
  return fences
}

/** Every checklist on a page, by the line its fence opens on in the body, with the ids the page
 *  draws. A page whose checklists do not parse (published before checklists existed, so never
 *  validated) draws none rather than half of them. */
export function checklistsOf(markdown: string): Map<number, ChecklistBlock> {
  const r = scanChecklists(fencesOf(markdown), 0)
  return new Map(r.ok ? r.checklists.map((c) => [c.line, c]) : [])
}

/** The item ids of the page's checklist that offers Send, or null when none does. */
export function checklistSendIds(markdown: string): string[] | null {
  const r = scanChecklists(fencesOf(markdown), 0)
  const c = r.ok ? r.checklists.find((l) => l.send) : undefined
  return c ? c.items.map((i: ChecklistItem) => i.id) : null
}

/** Does any checklist on this page sync? Then every checklist on it shares one set of ticks. */
export function checklistSyncs(checklists: Iterable<ChecklistBlock>): boolean {
  for (const c of checklists) if (c.sync) return true
  return false
}

/** The ids an answer in the `checklist` slot may name, or null when the page takes none: on a page
 *  that syncs, every item of every checklist on it (ids are page-wide); else the items of the
 *  checklist that offers Send. The state route asks, so a synced set can never carry an id the
 *  page does not draw. */
export function checklistAnswerIds(markdown: string): string[] | null {
  const r = scanChecklists(fencesOf(markdown), 0)
  if (!r.ok) return null
  if (checklistSyncs(r.checklists)) return r.checklists.flatMap((c) => c.items.map((i) => i.id))
  const c = r.checklists.find((l) => l.send)
  return c ? c.items.map((i: ChecklistItem) => i.id) : null
}

/** A checklist with `send` declares its own slot, `checklist`, shape one, private, written by
 *  whoever `send:` names; the owner reads it through /responses. A page whose checklists `sync`
 *  declares the same slot SHARED instead, so every reader is shown every reader's set and the
 *  widget takes the newest as the page's. Like `comments:`, the slot is the widget's own, so
 *  state: may not declare one by that name. */
export function mergeChecklistState(state: StateConfig | undefined, checklists: ChecklistBlock[]): { ok: true; state: StateConfig | undefined } | { ok: false; error: string } {
  const c = checklists.find((l) => l.sync) ?? checklists.find((l) => l.send)
  if (!c) return { ok: true, state }
  const what = c.sync ? 'sync' : 'send'
  if (state && Object.hasOwn(state.slots, CHECKLIST_SLOT))
    return { ok: false, error: `line ${c.line}: the checklist's ${what} writes to slot "${CHECKLIST_SLOT}", and state: declares a slot by that name; rename that slot` }
  const base: StateConfig = state ?? { writers: 'signed-in', visibility: 'private', slots: {} }
  const slot = c.sync
    ? { shape: 'one' as const, visibility: 'shared' as const, writers: c.sync }
    : { shape: 'one' as const, visibility: 'private' as const, writers: c.send! }
  return { ok: true, state: { ...base, slots: { ...base.slots, [CHECKLIST_SLOT]: slot } } }
}

/** A widget declares its own slot. The notes block adds `notes: { shape: many }` to the page's
 *  `state:` (creating `state:` with its defaults when the page had none), so the state API
 *  takes notes with no change and a republish's shape checks cover the slot. */
export function mergeWidgetState(state: StateConfig | undefined, notes: NotesWidget | null): { ok: true; state: StateConfig | undefined } | { ok: false; error: string } {
  if (!notes) return { ok: true, state }
  const had = state?.slots[NOTES_SLOT]
  if (had && had.shape !== 'many')
    return { ok: false, error: `line ${notes.line}: the notes block writes to slot "notes" as shape many, and state: declares it shape ${had.shape}; rename that slot` }
  if (had?.visibility && notes.visibility && had.visibility !== notes.visibility)
    return { ok: false, error: `line ${notes.line}: the notes block says visibility ${notes.visibility} and state: says ${had.visibility} for slot "notes"; say it once` }
  const slot = had
    ? (notes.visibility && !had.visibility ? { ...had, visibility: notes.visibility } : had)
    : { shape: 'many' as const, ...(notes.visibility ? { visibility: notes.visibility } : {}) }
  const base: StateConfig = state ?? { writers: 'signed-in', visibility: 'private', slots: {} }
  if (slot === had) return { ok: true, state: base }
  return { ok: true, state: { ...base, slots: { ...base.slots, [NOTES_SLOT]: slot } } }
}

/** Does this page's body carry a notes block? The state route asks, to check a note's shape. */
export function hasNotesWidget(markdown: string): boolean {
  const r = scanWidgets(markdown, 0)
  return r.ok && r.notes !== null
}

const SLUG = /^[\p{Ll}\p{Lo}\p{Lm}\p{N}_-]{1,120}$/u
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The server's check on a note, on a page with a notes block. The browser checks too; this is
 *  the one that counts. */
export function checkNoteValue(v: unknown): string | null {
  if (!isMap(v) || Object.keys(v).some((k) => !['slug', 'heading', 'note'].includes(k))) return 'a note is { slug, heading, note }'
  if (typeof v.slug !== 'string' || !SLUG.test(v.slug)) return 'a note needs the slug of the heading it is under'
  if (typeof v.heading !== 'string' || v.heading.length > MAX_HEADING_CHARS) return 'a note needs the heading it is under'
  if (typeof v.note !== 'string' || !v.note.trim()) return 'a note needs some text'
  if (v.note.length > MAX_NOTE_CHARS) return `a note is at most ${MAX_NOTE_CHARS} characters`
  return null
}

function plain(n: Nodes): string {
  if ('value' in n && typeof n.value === 'string') return n.value
  if (n.type === 'image') return n.alt ?? ''
  if ('children' in n) return (n.children as Nodes[]).map(plain).join(n.type === 'list' || n.type === 'table' || n.type === 'tableRow' ? '\n' : '')
  return ''
}

/** An image's asset name without the host's content digest (`chart.0a1b2c3d.png` is `chart.png`),
 *  so replacing the file under the same name keeps the comments drawn on it. */
function assetName(url: string): string {
  const base = url.split(/[?#]/)[0].split('/').pop() ?? url
  return base.replace(/\.[0-9a-f]{8}(\.[^.]+)$/, '$1')
}

/** The stable id of every top-level block, by the offset it starts at in the markdown. The
 *  renderer puts it on the block as `data-block`, and a region comment is pinned to it. Blocks
 *  that draw no prose (a notes, links or checklist fence, a rule, raw html) get none. */
export function blocksOf(markdown: string): Map<number, string> {
  const out = new Map<number, string>()
  const seen = new Map<string, number>()
  for (const n of parse(markdown).children) {
    const at = n.position?.start.offset
    if (at === undefined) continue
    let kind: string
    let content: string
    if (n.type === 'paragraph') {
      const only = n.children.filter((c) => !(c.type === 'text' && !c.value.trim()))
      if (only.length === 1 && only[0].type === 'image') { kind = 'img'; content = assetName(only[0].url) }
      else { kind = 'p'; content = plain(n) }
    } else if (n.type === 'heading') { kind = 'h'; content = plain(n) }
    else if (n.type === 'list') { kind = n.ordered ? 'ol' : 'ul'; content = plain(n) }
    else if (n.type === 'table') { kind = 'table'; content = plain(n) }
    else if (n.type === 'blockquote') { kind = 'quote'; content = plain(n) }
    else if (n.type === 'code') {
      if (n.lang === 'links' || n.lang === NOTES_SLOT || n.lang === 'checklist') continue
      kind = 'code'; content = n.value
    } else continue
    const k = `${kind}\n${content}`
    const i = seen.get(k) ?? 0
    seen.set(k, i + 1)
    out.set(at, blockId(kind, i, content))
  }
  return out
}
