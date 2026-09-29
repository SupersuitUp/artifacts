// Between the page in the browser and a comment's anchor: the page's text as one string (so a
// selection becomes a text-quote anchor and an anchor becomes a Range again), and where on the
// screen each anchor sits. DOM only, no React, so the layer and its tests share it.
import { findText, type Anchor, type RegionAnchor, type TextAnchor } from '../artifacts/anchor.js'

/** Text that is on the page but not the page's prose: the notes widget, hidden definition copy,
 *  and anything the comment layer itself draws. */
const SKIP = 'script, style, [data-heading-notes], [data-artifact-notes], .artifact-defined-note, [data-comment-ui]'

export type TextIndex = { text: string; nodes: { node: Text; start: number }[] }

/** Every text node under the root, in order, joined. Word spans the read-aloud wraps around the
 *  words keep the same text, so the string is the same before and after they are drawn. */
export function indexText(root: HTMLElement): TextIndex {
  const nodes: TextIndex['nodes'] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length })
    text += (n as Text).data
  }
  return { text, nodes }
}

/** The offset in the index of a selection boundary (a text node and an offset in it, or an element
 *  and a child index). Null when the boundary is not under the indexed root. */
export function offsetAt(idx: TextIndex, container: Node, offset: number): number | null {
  const direct = idx.nodes.find((n) => n.node === container)
  if (direct) return direct.start + Math.min(offset, direct.node.data.length)
  const at = document.createRange()
  try { at.setStart(container, offset) } catch { return null }
  at.collapse(true)
  let pos: number | null = null
  for (const { node, start } of idx.nodes) {
    // A text node wholly before the boundary counts in full; the first one after it stops the count.
    if (at.comparePoint(node, node.data.length) <= 0) pos = start + node.data.length
    else { pos ??= start; break }
  }
  return pos
}

/** A Range over [start, end) of the index. */
export function rangeOf(idx: TextIndex, start: number, end: number): Range | null {
  const locate = (i: number, isEnd: boolean) => {
    for (const { node, start: s } of idx.nodes) {
      const e = s + node.data.length
      if (i < e || (isEnd && i === e)) return { node, off: i - s }
    }
    return null
  }
  const a = locate(start, false)
  const b = locate(end, true)
  if (!a || !b) return null
  const r = document.createRange()
  r.setStart(a.node, a.off)
  r.setEnd(b.node, b.off)
  return r
}

/** The slug of the last heading at or before an offset: the section a quote sat under. */
export function headingAt(root: HTMLElement, idx: TextIndex, offset: number): string | undefined {
  let slug: string | undefined
  for (const h of root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
    const at = offsetAt(idx, h, 0)
    if (at !== null && at <= offset) slug = h.id
  }
  return slug
}

export type Placement =
  | { kind: 'text'; range: Range }
  | { kind: 'region'; block: HTMLElement; anchor: RegionAnchor }

/** Where an anchor is on this page now, or null: the comment is then on an earlier version. */
export function placeAnchor(root: HTMLElement, idx: TextIndex, a: Anchor): Placement | null {
  if (a.kind === 'text') {
    const at = findText(idx.text, a as TextAnchor)
    const range = at ? rangeOf(idx, at.start, at.end) : null
    return range ? { kind: 'text', range } : null
  }
  const block = root.querySelector<HTMLElement>(`[data-block="${a.block}"]`)
  return block ? { kind: 'region', block, anchor: a } : null
}

type Box = { left: number; top: number; width: number; height: number }
const pageBox = (r: DOMRect | { left: number; top: number; width: number; height: number }): Box =>
  ({ left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height })

/** Page coordinates (scroll included) of a placement: a text quote's first line, or the drawn box. */
export function boxOf(p: Placement): Box {
  if (p.kind === 'text') {
    // jsdom has no Range geometry; a browser always does.
    const rects = typeof p.range.getClientRects === 'function' ? Array.from(p.range.getClientRects()) : []
    const first = rects.find((r) => r.width || r.height) ?? p.range.startContainer.parentElement?.getBoundingClientRect()
    return pageBox(first ?? { left: 0, top: 0, width: 0, height: 0 })
  }
  const b = p.block.getBoundingClientRect()
  return pageBox({ left: b.left + p.anchor.x * b.width, top: b.top + p.anchor.y * b.height, width: p.anchor.w * b.width, height: p.anchor.h * b.height })
}

/** A box dragged over a block, as fractions of that block, clamped inside it. */
export function regionFrom(block: DOMRect, a: { x: number; y: number }, b: { x: number; y: number }, id: string): RegionAnchor | null {
  if (!block.width || !block.height) return null
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const x1 = clamp((Math.min(a.x, b.x) - block.left) / block.width)
  const x2 = clamp((Math.max(a.x, b.x) - block.left) / block.width)
  const y1 = clamp((Math.min(a.y, b.y) - block.top) / block.height)
  const y2 = clamp((Math.max(a.y, b.y) - block.top) / block.height)
  if (x2 - x1 <= 0 || y2 - y1 <= 0) return null
  // Rounded at the edges and measured between them, so x + w never rounds past the block's edge.
  const r4 = (v: number) => Math.round(v * 10000) / 10000
  const w = r4(x2) - r4(x1)
  const h = r4(y2) - r4(y1)
  if (w <= 0 || h <= 0) return null
  return { kind: 'region', block: id, x: r4(x1), y: r4(y1), w, h }
}
