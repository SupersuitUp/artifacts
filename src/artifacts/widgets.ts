// Widgets: fenced blocks in a document's markdown that give readers a place to answer, drawn by
// the shell in the page's brand and written through the state API (state.ts, state-routes.ts).
//
// This version draws ONE widget, `notes`: a small note control beside every heading, kept in the
// `many` slot `notes`. A note stores the heading it was left under, both its slug and its text,
// so a republish that renames or removes the heading keeps the note and shows it under "notes
// on earlier versions" instead of losing it or attaching it to the wrong section.
//
// Everything here is pure and server-safe: parsing, publish-time validation, the heading slugs
// the renderer and the stored notes agree on, and where each note is placed. The drawing lives
// in ../widgets/notes.tsx.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent, Code } from 'mdast'
import type { StateConfig, Visibility } from './state.js'
import { MAX_NOTE_CHARS, NOTES_SLOT, type Heading } from './notes-place.js'

export { MAX_NOTE_CHARS, NOTES_SLOT, placeNotes, type Heading, type NoteValue, type PlacedNote } from './notes-place.js'

/** Widgets the design names and this version does not draw yet. A fence using one is refused at
 *  publish, so a page never ships a code block that turns into a live widget on a later update. */
const NOT_YET = ['poll', 'form', 'checklist']
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
export function scanWidgets(body: string, offset: number): { ok: true; notes: NotesWidget | null } | { ok: false; error: string } {
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
  return { ok: true, notes }
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
