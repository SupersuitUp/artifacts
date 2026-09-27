// Inline definitions: a page may name its jargon in front matter, and the first time each term
// appears in the prose it is drawn with a dotted underline that opens its definition (hover on a
// desk, tap on a phone). The definition itself is drawn OUTSIDE the text flow by
// reader/definition-layer.tsx, so opening it can never reflow the paragraph.
//
// Conservative on purpose: a page covered in underlines is the failure. Only terms the page
// declares, only the first occurrence, whole words only, and never inside a heading, a link,
// code, an image or a callout (callouts flatten to plain text, so a term there would spend its
// one underline on nothing).
//
// Karaoke is untouched by construction: the narration is built from the markdown, which this
// never changes, and the term's text stays ordinary text inside a span, so the reader wraps the
// same words in the same order. The description copy is `data-nospeak`, which the reader skips.
import type { Root, Parent, RootContent, Text } from 'mdast'

export type Definition = { term: string; text: string; href?: string }

const LINK = /^https?:\/\//i

function entry(term: unknown, text: unknown, href: unknown): Definition | string {
  const t = typeof term === 'string' ? term.trim() : ''
  const d = typeof text === 'string' ? text.trim() : ''
  if (!t || !d) return `definitions: "${t || String(term)}" needs "Term | definition"`
  const out: Definition = { term: t, text: d }
  if (href !== undefined && href !== null && String(href).trim()) {
    const h = String(href).trim()
    if (!LINK.test(h)) return `definitions: the link for "${t}" must start with http:// or https://`
    out.href = h
  }
  return out
}

/** `definitions:` as front matter carries it: a list of `Term | definition | optional link`
 *  (the shape a Freedom workspace can write), or a map of term to definition, or to
 *  `{ text, href }` (the shape any gray-matter publisher can write). */
export function parseDefinitions(v: unknown): { ok: true; definitions: Definition[] } | { ok: false; error: string } {
  const out: Definition[] = []
  const push = (e: Definition | string) => {
    if (typeof e === 'string') return e
    if (out.some((o) => o.term === e.term)) return `definitions: "${e.term}" is defined twice`
    out.push(e)
    return null
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item !== 'string') return { ok: false, error: 'definitions: each entry is a "Term | definition | optional link" string' }
      const [term, text, href] = item.split('|')
      const err = push(entry(term, text, href))
      if (err) return { ok: false, error: err }
    }
    return { ok: true, definitions: out }
  }
  if (v && typeof v === 'object') {
    for (const [term, val] of Object.entries(v as Record<string, unknown>)) {
      const e = val && typeof val === 'object' ? entry(term, (val as { text?: unknown }).text, (val as { href?: unknown }).href) : entry(term, val, undefined)
      const err = push(e)
      if (err) return { ok: false, error: err }
    }
    return { ok: true, definitions: out }
  }
  return { ok: false, error: 'definitions: a list of "Term | definition | optional link" strings, or a map of term to definition' }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A term's matcher: whole word, case-aware. A term with any capital is a name and matches as
 *  written; an all-lowercase term also matches with a capital first letter, at a sentence start. */
function matcher(term: string): RegExp {
  const body = escapeRe(term).replace(/\s+/g, '\\s+')
  const lower = term === term.toLowerCase()
  const first = term[0]
  const head = lower && first.toUpperCase() !== first ? `[${escapeRe(first)}${escapeRe(first.toUpperCase())}]` + body.slice(escapeRe(first).length) : body
  return new RegExp(`(?<![\\p{L}\\p{N}])${head}(?![\\p{L}\\p{N}])`, 'u')
}

export function termId(term: string, i: number): string {
  return `artifact-def-${i}-${term.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`
}

const SKIP = new Set(['heading', 'link', 'linkReference', 'inlineCode', 'code', 'image', 'imageReference', 'footnoteDefinition', 'html', 'definition'])
const CALLOUT = /^\s*\[!(note|warning)\]/i

function firstText(n: RootContent): string {
  if (n.type === 'text') return n.value
  if ('children' in n && n.children.length) return firstText(n.children[0] as RootContent)
  return ''
}

/** The remark plugin: marks the first occurrence of each defined term. */
export function remarkDefinitions(definitions: Definition[]) {
  return () => (tree: Root) => {
    const pending = definitions
      .map((d, i) => ({ d, i, re: matcher(d.term) }))
      .sort((a, b) => b.d.term.length - a.d.term.length)
    const walk = (parent: Parent) => {
      for (let k = 0; k < parent.children.length && pending.length; k++) {
        const n = parent.children[k] as RootContent
        if (SKIP.has(n.type)) continue
        if (n.type === 'blockquote' && CALLOUT.test(firstText(n))) continue
        if (n.type === 'text') {
          const hit = earliest(n.value)
          if (!hit) continue
          const { at, len, p } = hit
          pending.splice(pending.indexOf(p), 1)
          const id = termId(p.d.term, p.i)
          const before: Text = { type: 'text', value: n.value.slice(0, at) }
          const after: Text = { type: 'text', value: n.value.slice(at + len) }
          const mark = {
            type: 'definedTerm',
            data: {
              hName: 'span',
              hProperties: { dataDefinedTerm: p.d.term, role: 'button', tabIndex: 0, ariaDescribedBy: id, ariaExpanded: 'false', className: ['artifact-defined-term'] },
            },
            children: [{ type: 'text', value: n.value.slice(at, at + len) }],
          }
          const note = {
            type: 'definedTermNote',
            data: {
              hName: 'span',
              hProperties: { id, dataNospeak: '', dataDefinition: p.d.text, ...(p.d.href ? { dataHref: p.d.href } : {}), className: ['artifact-defined-note'] },
            },
            children: [{ type: 'text', value: p.d.text }],
          }
          const parts = [before, mark, note, after].filter((x) => x.type !== 'text' || (x as Text).value) as RootContent[]
          parent.children.splice(k, 1, ...(parts as never[]))
          // Continue AFTER the note, on the remaining text: another term may follow in it.
          k += parts.indexOf(note as unknown as RootContent)
          continue
        }
        if ('children' in n) walk(n as Parent)
      }
    }
    const earliest = (s: string) => {
      let best: { at: number; len: number; p: (typeof pending)[number] } | null = null
      for (const p of pending) {
        const m = p.re.exec(s)
        if (m && (!best || m.index < best.at)) best = { at: m.index, len: m[0].length, p }
      }
      return best
    }
    walk(tree)
  }
}
