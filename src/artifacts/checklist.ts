// The checklist widget's pure parts: the fence's grammar, the ids every item keeps, and the
// server's check on what a Send hands the owner. Kept free of the markdown parser, like
// notes-place.ts, because the widget in the reader's browser imports the names from here.
//
// ```checklist
// send: anyone                      # optional: signed-in | anyone (who may press Send)
// - Update macOS {#update}
//   Apple menu > System Settings > General > Software Update.
// - [ ] Sign in with your personal Apple Account
// ```
//
// An item is a line starting with `- ` (or `* `), optionally followed by `[ ]`. Its id is the
// `{#id}` at the end of the line when there is one, else a slug of its text. Indented lines under
// an item are its description, drawn as markdown with raw HTML escaped like the rest of the page.
// Ticks belong to the reader: `[x]` is accepted and ticks nothing.

export const CHECKLIST_SLOT = 'checklist'
export const MAX_CHECKLIST_ITEMS = 200
const MAX_ITEM_CHARS = 500
const MAX_ID_CHARS = 64

/** An item id: lowercase letters (any script), digits, dashes and underscores. The same alphabet
 *  a heading slug uses, so a slugged id is always a valid one. */
export const CHECKLIST_ID = /^[\p{Ll}\p{Lo}\p{Lm}\p{N}_-]{1,64}$/u

export type SendWriters = 'signed-in' | 'anyone'
export type ChecklistItem = { id: string; text: string; description: string; line: number }
export type ChecklistBlock = { line: number; send?: SendWriters; items: ChecklistItem[] }
/** What a Send stores in the page's `checklist` slot: the ids the reader had ticked. */
export type ChecklistValue = { done: string[] }
/** A block as written, before ids are made unique across the page. */
export type RawChecklistItem = ChecklistItem & { explicit: boolean }
export type RawChecklistBlock = Omit<ChecklistBlock, 'items'> & { items: RawChecklistItem[] }

const ITEM = /^[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/
const EXPLICIT_ID = /\s*\{#([^}\s]*)\}\s*$/

/** GitHub's heading rule (widgets.slugify), repeated here so this file stays parser-free. */
function slug(text: string): string {
  const s = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
  return (s || 'item').slice(0, MAX_ID_CHARS).replace(/-+$/, '') || 'item'
}

/** The fence body as written, before ids are made unique across the page. `line` is the line the
 *  fence opens on in the author's file, so every error names a line they can find. */
export function parseChecklistFence(value: string, line: number, meta?: string | null):
  { ok: true; block: RawChecklistBlock } | { ok: false; error: string } {
  if (meta?.trim()) return { ok: false, error: `line ${line}: the checklist block takes no name; put settings like "send: anyone" inside it` }
  const rows = value ? value.split('\n') : []
  const items: RawChecklistItem[] = []
  let send: SendWriters | undefined
  let desc: string[] | null = null
  const close = () => {
    if (desc && items.length) items[items.length - 1].description = desc.join('\n').replace(/^\n+|\n+$/g, '')
    desc = null
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const at = line + 1 + i
    if (!row.trim()) { if (desc) desc.push(''); continue }
    if (/^(\s{2,}|\t)/.test(row)) {
      if (!items.length) return { ok: false, error: `line ${at}: an indented line belongs under an item; start the list with "- "` }
      desc!.push(row.replace(/^(\t| {2,4})/, ''))
      continue
    }
    const m = ITEM.exec(row)
    if (m) {
      close()
      let text = m[1]
      let id: string | undefined
      const e = EXPLICIT_ID.exec(text)
      if (e) {
        id = e[1]
        text = text.slice(0, e.index)
        if (!CHECKLIST_ID.test(id)) return { ok: false, error: `line ${at}: the id {#${id}} must be lowercase letters, digits, dashes or underscores, at most ${MAX_ID_CHARS}` }
      }
      text = text.trim()
      if (!text) return { ok: false, error: `line ${at}: a checklist item needs some text` }
      if (text.length > MAX_ITEM_CHARS) return { ok: false, error: `line ${at}: a checklist item is at most ${MAX_ITEM_CHARS} characters` }
      if (items.length >= MAX_CHECKLIST_ITEMS) return { ok: false, error: `line ${at}: a checklist takes at most ${MAX_CHECKLIST_ITEMS} items` }
      items.push({ id: id ?? '', text, description: '', line: at, explicit: !!id })
      desc = []
      continue
    }
    if (items.length) return { ok: false, error: `line ${at}: a checklist item starts with "- ", and its description under it is indented` }
    const s = /^([A-Za-z_-]+)\s*:\s*([^#]*?)\s*(#.*)?$/.exec(row.trim())
    if (!s) return { ok: false, error: `line ${at}: the checklist block takes settings like "send: anyone", then items starting with "- "` }
    if (s[1] !== 'send') return { ok: false, error: `line ${at}: the checklist block has an unknown setting: ${s[1]}` }
    if (s[2] !== 'signed-in' && s[2] !== 'anyone') return { ok: false, error: `line ${at}: checklist send must be signed-in or anyone` }
    send = s[2]
  }
  close()
  if (!items.length) return { ok: false, error: `line ${line}: a checklist needs at least one item starting with "- "` }
  return { ok: true, block: { line, ...(send ? { send } : {}), items } }
}

/** Gives every item on the page its final id. An explicit `{#id}` is kept as written and must be
 *  unique on the page; an item without one takes the slug of its text, numbered `-1`, `-2` when
 *  that slug is already used, the way repeated headings are. Ids are page-wide because ticks are
 *  saved by page and item id. */
export function assignChecklistIds(blocks: RawChecklistBlock[]):
  { ok: true; blocks: ChecklistBlock[] } | { ok: false; error: string } {
  const taken = new Map<string, number>()
  for (const b of blocks) for (const it of b.items) {
    if (!it.explicit) continue
    if (taken.has(it.id)) return { ok: false, error: `line ${it.line}: the id {#${it.id}} is already used on line ${taken.get(it.id)}` }
    taken.set(it.id, it.line)
  }
  const out: ChecklistBlock[] = blocks.map((b) => ({
    line: b.line,
    ...(b.send ? { send: b.send } : {}),
    items: b.items.map(({ explicit, ...it }) => {
      if (explicit) return it
      const base = slug(it.text)
      let id = base
      for (let k = 1; taken.has(id); k++) id = `${base}-${k}`
      taken.set(id, it.line)
      return { ...it, id }
    }),
  }))
  return { ok: true, blocks: out }
}

/** The server's check on a Send, on a page whose checklist offers one: every id is an item of
 *  that checklist, once. The browser sends exactly this; anything else is refused. */
export function checkChecklistValue(v: unknown, ids: readonly string[]): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => k !== 'done')) return 'a checklist answer is { done: [item ids] }'
  const done = (v as { done?: unknown }).done
  if (!Array.isArray(done)) return 'a checklist answer is { done: [item ids] }'
  const known = new Set(ids)
  const seen = new Set<string>()
  for (const id of done) {
    if (typeof id !== 'string' || !known.has(id)) return 'a checklist answer names only items on this page'
    if (seen.has(id)) return 'a checklist answer names each item once'
    seen.add(id)
  }
  return null
}

/** Where a reader's tick on one item is kept in their browser. */
export const checklistStorageKey = (artifactId: string, itemId: string) => `artifact-checklist:${artifactId}:${itemId}`
