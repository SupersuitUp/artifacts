// How the browser read-aloud splits a page into utterances, and maps a speech engine's
// word-boundary events back to the page's word spans. Pure, so it is tested without a browser.
//
// One utterance per sentence is the drift bound: Safari's boundary charIndex wanders on long
// passages, and every new utterance restarts it at zero against a sentence whose word offsets
// are known. The cap keeps a page with no punctuation (a list, a table) from becoming one long
// utterance, which is also where Chrome is known to stop speaking part-way.

export type Sentence = {
  /** The words joined by single spaces: exactly what is handed to the speech engine. */
  text: string
  /** Index of the sentence's first word in the page's word list. */
  first: number
  /** offsets[i] is the char offset, inside `text`, of word `first + i`. */
  offsets: number[]
}

export const MAX_SENTENCE_WORDS = 60

// A word ends a sentence when it ends in . ! ? or :, optionally followed by closing quotes or
// brackets. "10:30" and "example.com" do not, because the punctuation is not at the end.
const ENDS_SENTENCE = /[.!?:]["'”’)\]]*$/

/** Split a page's words into sentences. `starts` holds word indexes that begin a new block
 *  (a heading, a paragraph, a list item), which always begin a new sentence. */
export function planSentences(words: string[], starts?: ReadonlySet<number>): Sentence[] {
  const plan: Sentence[] = []
  let cur: Sentence | null = null
  for (let i = 0; i < words.length; i++) {
    if (cur && (cur.offsets.length >= MAX_SENTENCE_WORDS || starts?.has(i))) {
      plan.push(cur)
      cur = null
    }
    if (!cur) cur = { text: '', first: i, offsets: [] }
    if (cur.offsets.length) cur.text += ' '
    cur.offsets.push(cur.text.length)
    cur.text += words[i]
    if (ENDS_SENTENCE.test(words[i])) {
      plan.push(cur)
      cur = null
    }
  }
  if (cur) plan.push(cur)
  return plan
}

/** The absolute word index a boundary event's `charIndex` falls in: the last word whose offset
 *  is at or before it. */
export function wordAt(s: Sentence, charIndex: number): number {
  let i = 0
  for (let k = 0; k < s.offsets.length; k++) {
    if (s.offsets[k] <= charIndex) i = k
    else break
  }
  return s.first + i
}

/** The index of the sentence holding `wordIndex`. */
export function sentenceOf(plan: Sentence[], wordIndex: number): number {
  let idx = 0
  for (let k = 0; k < plan.length; k++) {
    if (plan[k].first <= wordIndex) idx = k
    else break
  }
  return idx
}

/** The sentence holding `wordIndex`, cut so it starts AT that word, with offsets rebased to the
 *  cut text. What is spoken when a reader clicks a word in the middle of a sentence. */
export function fromWord(plan: Sentence[], wordIndex: number): Sentence {
  const s = plan[sentenceOf(plan, wordIndex)]
  const k = Math.max(0, Math.min(wordIndex - s.first, s.offsets.length - 1))
  const base = s.offsets[k]
  return { text: s.text.slice(base), first: s.first + k, offsets: s.offsets.slice(k).map((o) => o - base) }
}
