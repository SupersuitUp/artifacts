// The text a narrator reads for an artifact, derived from the markdown TREE with the
// same skip rules the renderer marks in the markup (data-nospeak, link cards, code,
// footnotes), so the words on screen are exactly the words spoken. The client-side
// highlighter skips the same nodes, which is what keeps the two in step.
//
// Built from the tree rather than the rendered HTML because Next refuses
// react-dom/server inside app code. Any block the renderer adds must be mirrored here.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent } from 'mdast'

const CALLOUT = /^\[!(note|warning)\]\s*/i

function inline(nodes: PhrasingContent[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'inlineCode':
        out += n.value
        break
      case 'emphasis':
      case 'strong':
      case 'delete':
      case 'link':
      case 'linkReference':
        out += inline(n.children as PhrasingContent[])
        break
      case 'break':
        out += ' '
        break
      // footnoteReference, image, imageReference, html: not spoken
      default:
        break
    }
  }
  return out
}

function blocks(nodes: RootContent[], out: string[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'heading':
      case 'paragraph':
        out.push(inline(n.children as PhrasingContent[]))
        break
      case 'blockquote': {
        const inner: string[] = []
        blocks(n.children as RootContent[], inner)
        if (inner.length) inner[0] = inner[0].replace(CALLOUT, '')
        out.push(...inner)
        break
      }
      case 'list':
        for (const item of n.children) blocks(item.children as RootContent[], out)
        break
      case 'table':
        for (const row of n.children) {
          out.push(row.children.map((c) => inline(c.children as PhrasingContent[])).join(', '))
        }
        break
      // code (including ```links), image, footnoteDefinition, thematicBreak, html: not spoken
      default:
        break
    }
  }
}

function clean(lines: string[]): string {
  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function narrationTextFromMarkdown(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const out: string[] = []
  blocks(tree.children, out)
  return clean(out)
}

export function narrationText(input: { title: string; summary: string; markdown: string }): string {
  return [input.title.trim(), input.summary.trim(), narrationTextFromMarkdown(input.markdown)].filter(Boolean).join('\n')
}

/** Tokens the highlighter and the timings agree on: whitespace-split, lowercased, letters and digits only. */
export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}
