// Where a comment is pinned on a page, in a form that survives a republish.
//
// A TEXT anchor is the W3C text-quote selector Hypothesis uses: the quoted text plus up to 32
// characters either side, and the heading it sat under. On load the reader finds the quote again;
// several copies are told apart by how much of the surrounding text still matches; a quote that
// is gone is gone, and the comment is listed under "comments on earlier versions" rather than
// pinned somewhere it was never left.
//
// A REGION anchor is a box drawn over one rendered block (a paragraph, an image, a table), stored
// as fractions of that block's box so it scales with the screen. Every top-level block carries a
// stable id (`data-block`) from its kind and a hash of its own content, so an edit elsewhere on
// the page never moves it.
//
// Pure and browser-safe on purpose: the comment layer runs this in the reader's browser, so no
// node:crypto here (the block hash is FNV-1a, which only has to be stable, never secret).
export type TextAnchor = { kind: 'text'; quote: string; prefix: string; suffix: string; heading?: string }
export type RegionAnchor = { kind: 'region'; block: string; x: number; y: number; w: number; h: number }
export type Anchor = TextAnchor | RegionAnchor

export const CONTEXT_CHARS = 32
export const MAX_QUOTE_CHARS = 500
const MAX_HEADING_SLUG = 120
export const BLOCK_ID = /^b-[a-z]{1,8}-[0-9a-f]{8}(?:-[1-9]\d{0,3})?$/

export function textAnchorFrom(fullText: string, start: number, end: number, heading?: string): TextAnchor {
  return {
    kind: 'text',
    quote: fullText.slice(start, end),
    prefix: fullText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: fullText.slice(end, end + CONTEXT_CHARS),
    ...(heading ? { heading } : {}),
  }
}

/** How many characters at the END of `a` match the end of `b`. */
function sameEnding(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
/** How many characters at the START of `a` match the start of `b`. */
function sameStart(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** Where the quote is now: the exact quote, and when there are several copies, the one whose
 *  surrounding text matches the stored context in the most characters (the first on a tie).
 *  Null when the quote no longer appears at all. */
export function findText(fullText: string, a: TextAnchor): { start: number; end: number } | null {
  if (!a.quote) return null
  let best: { start: number; score: number } | null = null
  for (let i = fullText.indexOf(a.quote); i !== -1; i = fullText.indexOf(a.quote, i + 1)) {
    const before = fullText.slice(Math.max(0, i - a.prefix.length), i)
    const after = fullText.slice(i + a.quote.length, i + a.quote.length + a.suffix.length)
    const score = sameEnding(before, a.prefix) + sameStart(after, a.suffix)
    if (!best || score > best.score) best = { start: i, score }
  }
  return best ? { start: best.start, end: best.start + a.quote.length } : null
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** `b-<kind>-<8 hex of its content>`. `index` is how many identical blocks (same kind and
 *  content) come before this one on the page, so it only ever breaks a tie. Images are keyed by
 *  their asset name, so a re-uploaded image with the same name keeps its comments. */
export function blockId(kind: string, index: number, content: string): string {
  const id = `b-${kind}-${fnv1a(`${kind}\n${content}`)}`
  return index > 0 ? `${id}-${index}` : id
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const frac = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

/** The server's check on an anchor posted with a comment. */
export function parseAnchor(raw: unknown): Anchor | null {
  if (!isMap(raw)) return null
  if (raw.kind === 'text') {
    if (Object.keys(raw).some((k) => !['kind', 'quote', 'prefix', 'suffix', 'heading'].includes(k))) return null
    const { quote, prefix, suffix, heading } = raw
    if (typeof quote !== 'string' || !quote.trim() || quote.length > MAX_QUOTE_CHARS) return null
    if (typeof prefix !== 'string' || prefix.length > CONTEXT_CHARS) return null
    if (typeof suffix !== 'string' || suffix.length > CONTEXT_CHARS) return null
    if (heading !== undefined && (typeof heading !== 'string' || !heading || heading.length > MAX_HEADING_SLUG)) return null
    return { kind: 'text', quote, prefix, suffix, ...(heading ? { heading: heading as string } : {}) }
  }
  if (raw.kind === 'region') {
    if (Object.keys(raw).some((k) => !['kind', 'block', 'x', 'y', 'w', 'h'].includes(k))) return null
    const { block, x, y, w, h } = raw
    if (typeof block !== 'string' || !BLOCK_ID.test(block)) return null
    if (!frac(x) || !frac(y) || !frac(w) || !frac(h) || w <= 0 || h <= 0) return null
    // A small allowance for float rounding at the far edge; a box that leaves its block is refused.
    if (x + w > 1.000001 || y + h > 1.000001) return null
    return { kind: 'region', block, x, y, w, h }
  }
  return null
}
