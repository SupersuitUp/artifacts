import { MAX_SENTENCE_WORDS, planSentences, sentenceOf, wordAt } from './speech-plan.js'

describe('planSentences', () => {
  it('splits on sentence-ending punctuation and records where each sentence starts', () => {
    const plan = planSentences(['One', 'two.', 'Three', 'four!', 'Five'])
    expect(plan.map((s) => s.text)).toEqual(['One two.', 'Three four!', 'Five'])
    expect(plan.map((s) => s.first)).toEqual([0, 2, 4])
    expect(plan[1].offsets).toEqual([0, 6])
  })
  it('ends a sentence at a question mark or a colon, and at punctuation inside a closing quote', () => {
    const plan = planSentences(['Why?', 'Because:', 'she', 'said', '"go."', 'Then', 'left'])
    expect(plan.map((s) => s.first)).toEqual([0, 1, 2, 5])
  })
  it('does not end a sentence at a colon or period inside a word', () => {
    const plan = planSentences(['at', '10:30', 'see', 'example.com', 'now'])
    expect(plan).toHaveLength(1)
  })
  it(`caps a sentence at ${MAX_SENTENCE_WORDS} words, so a boundary drift cannot outlast one`, () => {
    const words = Array.from({ length: 130 }, (_, i) => `w${i}`)
    const plan = planSentences(words)
    expect(plan.map((s) => s.first)).toEqual([0, 60, 120])
    expect(plan.every((s) => s.offsets.length <= 60)).toBe(true)
  })
  it('breaks where a new block starts, so a heading with no period is not run into its paragraph', () => {
    const plan = planSentences(['A', 'heading', 'Then', 'text.'], new Set([2]))
    expect(plan.map((s) => s.text)).toEqual(['A heading', 'Then text.'])
  })
  it('an empty page has no sentences', () => {
    expect(planSentences([])).toEqual([])
  })
})

describe('wordAt', () => {
  const [, s] = planSentences(['Zero.', 'One', 'two', 'three.'])
  it('maps char 0 to the first word of the sentence, as an absolute index', () => {
    expect(wordAt(s, 0)).toBe(1)
  })
  it('maps a char in the middle of a word to that word', () => {
    expect(wordAt(s, 5)).toBe(2)
  })
  it('maps a char past the last offset to the last word', () => {
    expect(wordAt(s, 999)).toBe(3)
  })
})

describe('sentenceOf', () => {
  const plan = planSentences(['One', 'two.', 'Three', 'four!', 'Five'])
  it('finds the sentence holding the first, a middle and the last word', () => {
    expect(sentenceOf(plan, 0)).toBe(0)
    expect(sentenceOf(plan, 3)).toBe(1)
    expect(sentenceOf(plan, 4)).toBe(2)
  })
})
