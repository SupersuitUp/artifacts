// The karaoke primitives the page's narration and a voice note share: which word is being spoken
// at a time, how many words have begun, and the one highlight both draw. Pure and server-safe.

export type WordTiming = { w: string; s: number; e: number }

/** The last word that has begun by `now`, or -1. Words are sorted by start. */
function lastBegun(words: WordTiming[], now: number): number {
  let lo = 0
  let hi = words.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].s <= now) {
      idx = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return idx
}

/** The word to light at `now`, or -1. Nothing lights until narration has started: the first
 *  word begins at 0, so an untouched page would otherwise sit with its first word highlighted. */
export function litWordIndex(words: WordTiming[], now: number, started: boolean): number {
  if (!started) return -1
  const idx = lastBegun(words, now)
  return idx >= 0 && now <= words[idx].e + 0.25 ? idx : -1
}

/** How many words have begun by `now`: the rest are still to come. A pause between words keeps
 *  the count, so the words already said never fall back to muted in a silence. */
export function begunCount(words: WordTiming[], now: number): number {
  return lastBegun(words, now) + 1
}

/** The highlight on the word being spoken, in the page's accent. */
export const litDeclarations = (accent: string) => `background: color-mix(in srgb, ${accent} 35%, transparent); color: var(--a-strong, #fff);`

/** The class on every word span, on the word being spoken, and on the words still to come. */
export const WORD_CLASS = 'vn-word'
export const LIT_CLASS = 'vn-word-lit'
export const AHEAD_CLASS = 'vn-ahead'

/** The CSS for the three word states under `scope` (a selector for the element holding the
 *  words): a word is tappable, the word being spoken carries the narration's highlight in
 *  `accent`, and the words still to come are muted. One copy for every surface that lights words. */
export const wordStateCss = (scope: string, accent: string) =>
  `${scope} .${WORD_CLASS}{border-radius:3px;cursor:pointer;transition:background-color 120ms,opacity 200ms;-webkit-tap-highlight-color:transparent}` +
  `${scope} .${WORD_CLASS}:hover{background:var(--a-surface-strong,rgba(127,127,127,0.12))}` +
  `${scope} .${WORD_CLASS}.${AHEAD_CLASS}{opacity:0.5}` +
  `${scope} .${WORD_CLASS}.${LIT_CLASS}{${litDeclarations(accent)}opacity:1}`
