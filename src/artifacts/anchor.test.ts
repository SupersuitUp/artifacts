import { describe, it, expect } from 'vitest'
import { blockId, findText, parseAnchor, textAnchorFrom, CONTEXT_CHARS, MAX_QUOTE_CHARS } from './anchor.js'

const PAGE = 'The river runs north. Every spring the river floods the lower field, and the town moves its sheep uphill.'

describe('textAnchorFrom', () => {
  it('keeps the quote and up to 32 characters either side, and the heading', () => {
    const start = PAGE.indexOf('floods')
    const a = textAnchorFrom(PAGE, start, start + 'floods'.length, 'spring')
    expect(a).toEqual({
      kind: 'text', quote: 'floods',
      prefix: PAGE.slice(start - CONTEXT_CHARS, start), suffix: PAGE.slice(start + 6, start + 6 + CONTEXT_CHARS), heading: 'spring',
    })
    expect(a.prefix).toHaveLength(32)
  })
  it('clips the context at the ends of the text', () => {
    const a = textAnchorFrom(PAGE, 0, 3)
    expect(a.prefix).toBe('')
    expect(a.quote).toBe('The')
    expect(a.heading).toBeUndefined()
  })
})

describe('findText', () => {
  const at = (text: string, quote: string, nth = 0) => {
    let i = -1
    for (let k = 0; k <= nth; k++) i = text.indexOf(quote, i + 1)
    return i
  }

  it('re-finds the quote after text is inserted before it', () => {
    const start = at(PAGE, 'floods')
    const a = textAnchorFrom(PAGE, start, start + 6)
    const edited = 'A new opening sentence arrives. ' + PAGE
    const r = findText(edited, a)
    expect(r).toEqual({ start: at(edited, 'floods'), end: at(edited, 'floods') + 6 })
  })

  it('picks the right copy when the quote is duplicated elsewhere, by its context', () => {
    // "the river" appears twice; the anchor is on the second one.
    const start = at(PAGE, 'the river')
    const a = textAnchorFrom(PAGE, start, start + 'the river'.length)
    const edited = 'Upstream, the river is quiet. ' + PAGE
    const r = findText(edited, a)!
    expect(edited.slice(r.start - 13, r.start)).toBe('Every spring ')
  })

  it('prefers the copy whose suffix matches when the prefixes tie', () => {
    // The 40 characters before each copy are identical, so only the suffix can tell them apart.
    const lead = 'and after a long quiet meeting, everyone '
    const text = `${lead}said yes to the plan. ${lead}said yes to the dog.`
    const second = text.lastIndexOf('said yes')
    const a = textAnchorFrom(text, second, second + 'said yes'.length)
    expect(findText(text, a)).toEqual({ start: second, end: second + 8 })
  })

  it('returns null when the quote is gone', () => {
    const start = at(PAGE, 'sheep')
    const a = textAnchorFrom(PAGE, start, start + 5)
    expect(findText(PAGE.replace('sheep', 'goats'), a)).toBeNull()
  })

  it('an empty quote is never found', () => {
    expect(findText(PAGE, { kind: 'text', quote: '', prefix: '', suffix: '' })).toBeNull()
  })
})

describe('blockId', () => {
  it('is b-<kind>-<8 hex>, and depends only on its own content', () => {
    const id = blockId('p', 0, 'The river runs north.')
    expect(id).toMatch(/^b-p-[0-9a-f]{8}$/)
    expect(blockId('p', 0, 'The river runs north.')).toBe(id)
    expect(blockId('p', 0, 'The river runs south.')).not.toBe(id)
    expect(blockId('h', 0, 'The river runs north.')).not.toBe(id)
  })
  it('the index only breaks ties between identical blocks', () => {
    const first = blockId('p', 0, 'Same.')
    const second = blockId('p', 1, 'Same.')
    expect(second).toBe(`${first}-1`)
  })
})

describe('parseAnchor', () => {
  it('accepts a text anchor and a region anchor', () => {
    expect(parseAnchor({ kind: 'text', quote: 'q', prefix: 'a', suffix: 'b', heading: 'h' })).toEqual({ kind: 'text', quote: 'q', prefix: 'a', suffix: 'b', heading: 'h' })
    expect(parseAnchor({ kind: 'region', block: 'b-img-0a1b2c3d', x: 0.1, y: 0.2, w: 0.5, h: 0.3 })).toEqual({ kind: 'region', block: 'b-img-0a1b2c3d', x: 0.1, y: 0.2, w: 0.5, h: 0.3 })
  })
  it('refuses a quote over the cap, an empty quote, overlong context, and unknown keys', () => {
    expect(parseAnchor({ kind: 'text', quote: 'x'.repeat(MAX_QUOTE_CHARS + 1), prefix: '', suffix: '' })).toBeNull()
    expect(parseAnchor({ kind: 'text', quote: '', prefix: '', suffix: '' })).toBeNull()
    expect(parseAnchor({ kind: 'text', quote: 'q', prefix: 'x'.repeat(CONTEXT_CHARS + 1), suffix: '' })).toBeNull()
    expect(parseAnchor({ kind: 'text', quote: 'q', prefix: '', suffix: '', extra: 1 })).toBeNull()
  })
  it('refuses fractions out of range or a box that leaves its block', () => {
    const ok = { kind: 'region', block: 'b-p-0a1b2c3d', x: 0, y: 0, w: 1, h: 1 }
    expect(parseAnchor(ok)).not.toBeNull()
    expect(parseAnchor({ ...ok, x: -0.1 })).toBeNull()
    expect(parseAnchor({ ...ok, w: 1.2 })).toBeNull()
    expect(parseAnchor({ ...ok, x: 0.5, w: 0.6 })).toBeNull()
    expect(parseAnchor({ ...ok, h: 0 })).toBeNull()
    expect(parseAnchor({ ...ok, y: Number.NaN })).toBeNull()
    expect(parseAnchor({ ...ok, block: 'not a block' })).toBeNull()
  })
  it('refuses anything that is not an anchor', () => {
    for (const v of [null, 'x', [], {}, { kind: 'line' }]) expect(parseAnchor(v)).toBeNull()
  })
})
