import { litWordIndex } from './artifact-reader.js'

const words = [
  { w: 'The', s: 0, e: 0.3 },
  { w: 'Freedom', s: 0.3, e: 0.8 },
  { w: 'lightpaper', s: 0.8, e: 1.4 },
]

describe('litWordIndex', () => {
  it('lights nothing before narration has started, even though the first word begins at 0', () => {
    expect(litWordIndex(words, 0, false)).toBe(-1)
  })
  it('lights the word under the playhead once started', () => {
    expect(litWordIndex(words, 0, true)).toBe(0)
    expect(litWordIndex(words, 0.5, true)).toBe(1)
  })
  it('lights nothing in a long gap after a word ends', () => {
    expect(litWordIndex(words, 3, true)).toBe(-1)
  })
})
