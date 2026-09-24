import { describe, it, expect } from 'vitest'
import { narrationText, normalizeWord } from './narration.js'

describe('narration text', () => {
  it('reads title, summary, headings and prose in order', () => {
    const t = narrationText({ title: 'T', summary: 'S', markdown: '# Head\n\nBody one.\n\n## Two\n\nBody two.' })
    expect(t.split('\n')).toEqual(['T', 'S', 'Head', 'Body one.', 'Two', 'Body two.'])
  })
  it('skips link hosts, link cards, code, callout labels and footnotes', () => {
    const md = [
      'See [Anthropic](https://www.anthropic.com/x) now.',
      '```links\nhttps://a.com | card\n```',
      '```bash\nls\n```',
      '> [!note]\n> Mind this.',
      'Ref[^1].',
      '[^1]: the note',
    ].join('\n\n')
    const t = narrationText({ title: 'T', summary: 'S', markdown: md })
    expect(t).toContain('See Anthropic now.')
    expect(t).not.toContain('anthropic.com')
    expect(t).not.toContain('card')
    expect(t).not.toContain('ls')
    expect(t).toContain('Mind this.')
    expect(t).not.toMatch(/\bnote\b/i)
    expect(t).not.toContain('the note')
    expect(t).toContain('Ref.')
  })
  it('keeps punctuation and apostrophes as written', () => {
    expect(narrationText({ title: 'T', summary: 'S', markdown: "God's & mine, *really*." })).toContain("God's & mine, really.")
  })
  it('reads table rows and list items as lines', () => {
    const t = narrationText({ title: 'T', summary: 'S', markdown: '| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two' })
    expect(t.split('\n').slice(2)).toEqual(['a, b', '1, 2', 'one', 'two'])
  })
  it('normalizes words for matching', () => {
    expect(normalizeWord('"Hello,"')).toBe('hello')
    expect(normalizeWord('fifty-nine.')).toBe('fiftynine')
  })
})
