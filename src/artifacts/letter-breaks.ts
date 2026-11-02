// A LETTER'S GREETING AND SIGN-OFF KEEP THEIR LINES (Gary, 2026-11-02: "Permanently fix the newline
// issue with the salutation"). Markdown joins a soft line break with a space, so "Your friend in
// Christ," then "Gary" drew as one line, and no writer types the two trailing spaces a hard break
// needs. A paragraph that opens on a short line (40 characters or fewer) ending in a comma is a
// greeting or a sign-off: each soft break after a short line in it becomes a real break. Hard-wrapped
// prose fills its lines, so it never opens a paragraph on one and still joins. The review page's
// renderer (supersuit-dev .agents/lib/supersuit-tile-app-markdown.mjs) holds the same rule.
import type { Root, Paragraph, PhrasingContent, Text, Break } from 'mdast'

const SHORT = 40

type Parent = { children: unknown[] }
const isParent = (n: unknown): n is Parent => !!n && Array.isArray((n as Parent).children)

/** The paragraph's text as the writer typed it, soft breaks included. */
function plain(nodes: readonly unknown[]): string {
  return nodes.map((n) => {
    const x = n as { type: string; value?: string; children?: unknown[] }
    if (x.type === 'text' || x.type === 'inlineCode') return x.value ?? ''
    if (x.type === 'break') return '\n'
    return x.children ? plain(x.children) : ''
  }).join('')
}

function breakLetter(p: Paragraph) {
  const lines = plain(p.children).split('\n')
  if (lines.length < 2) return
  const short = (l: string) => l.trim().length <= SHORT
  if (!short(lines[0]) || !/,$/.test(lines[0].trim())) return
  let line = 0
  const walk = (parent: Parent) => {
    const out: unknown[] = []
    for (const child of parent.children) {
      const c = child as PhrasingContent
      if (c.type === 'text') {
        const parts = (c as Text).value.split('\n')
        parts.forEach((part, k) => {
          if (k > 0) {
            const keep = short(lines[line])
            line++
            if (keep) {
              out.push({ type: 'break' } satisfies Break)
              part = part.replace(/^\s+/, '')
            } else part = ' ' + part.replace(/^\s+/, '')
          }
          if (part) out.push({ type: 'text', value: part } satisfies Text)
        })
        continue
      }
      if (c.type === 'break') line++
      else if (isParent(c)) walk(c)
      out.push(c)
    }
    parent.children = out
  }
  walk(p as unknown as Parent)
}

export function remarkLetterBreaks() {
  return (tree: Root) => {
    const visit = (n: unknown) => {
      if (!isParent(n)) return
      for (const c of n.children) {
        if ((c as { type: string }).type === 'paragraph') breakLetter(c as Paragraph)
        else visit(c)
      }
    }
    visit(tree)
  }
}
