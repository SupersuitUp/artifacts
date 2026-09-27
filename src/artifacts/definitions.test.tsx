import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseDefinitions } from './definitions.js'
import { parseArtifactSource } from './front-matter.js'
import { ArtifactMarkdown } from './render.js'
import { narrationTextFromMarkdown, normalizeWord } from './narration.js'
import { wrapWords, seekableWord } from '../reader/artifact-reader.js'

const defs = parseDefinitions([
  'Agentic Edge | The compounded context only you could have produced. | https://example.com/edge',
  'harness | The agent loop that reads and writes for you.',
])
if (!defs.ok) throw new Error(defs.error)
const html = (md: string, d = defs.ok ? defs.definitions : []) =>
  renderToStaticMarkup(<ArtifactMarkdown markdown={md} definitions={d} />)

describe('parseDefinitions', () => {
  it('reads the list shape, Term | definition | optional link', () => {
    expect(defs).toEqual({
      ok: true,
      definitions: [
        { term: 'Agentic Edge', text: 'The compounded context only you could have produced.', href: 'https://example.com/edge' },
        { term: 'harness', text: 'The agent loop that reads and writes for you.' },
      ],
    })
  })
  it('reads the map shape a gray-matter publisher writes, with or without a link', () => {
    expect(parseDefinitions({ Toil: 'Work a machine could do.', Frapp: { text: 'A small page.', href: 'https://example.com/f' } })).toEqual({
      ok: true,
      definitions: [
        { term: 'Toil', text: 'Work a machine could do.' },
        { term: 'Frapp', text: 'A small page.', href: 'https://example.com/f' },
      ],
    })
  })
  it('refuses an entry with no definition, naming it', () => {
    expect(parseDefinitions(['Toil'])).toEqual({ ok: false, error: 'definitions: "Toil" needs "Term | definition"' })
  })
  it('refuses a link that is not http(s)', () => {
    const r = parseDefinitions(['Toil | Work. | javascript:alert(1)'])
    expect(r.ok).toBe(false)
  })
  it('is a front matter key the host accepts', () => {
    const r = parseArtifactSource(`---\ntitle: X\nsummary: Y\ndefinitions: ["Toil | Work a machine could do."]\n---\nToil.`)
    expect(r.ok && r.meta.definitions).toEqual([{ term: 'Toil', text: 'Work a machine could do.' }])
    const bad = parseArtifactSource(`---\ntitle: X\nsummary: Y\ndefinitions: ["Toil"]\n---\nbody`)
    expect(bad.ok).toBe(false)
  })
})

const terms = (out: string) => [...out.matchAll(/data-defined-term="([^"]+)"/g)].map((m) => m[1])

describe('defined terms in the rendered page', () => {
  it('underlines only the FIRST occurrence of a term', () => {
    const out = html('Your Agentic Edge grows. The Agentic Edge compounds.')
    expect(terms(out)).toEqual(['Agentic Edge'])
  })
  it('matches whole words only', () => {
    expect(terms(html('The harnesses and preharness are not it.'))).toEqual([])
    expect(terms(html('The harness is it.'))).toEqual(['harness'])
  })
  it('is case-aware: a lowercase term also matches at a sentence start, a capitalised one only as written', () => {
    expect(terms(html('Harness first.'))).toEqual(['harness'])
    expect(terms(html('your agentic edge grows.'))).toEqual([])
  })
  it('skips headings, links, inline code, code fences and image alts', () => {
    const md = [
      '# The Agentic Edge',
      '[the harness](https://example.com/h) and `harness` and ![Agentic Edge](https://example.com/a.png)',
      '```\nharness Agentic Edge\n```',
    ].join('\n\n')
    expect(terms(html(md))).toEqual([])
  })
  it('carries the definition as a hidden description that is never spoken, and the link when given', () => {
    const out = html('Your Agentic Edge grows.')
    expect(out).toMatch(/role="button"/)
    expect(out).toMatch(/tabindex="0"/)
    expect(out).toMatch(/aria-describedby="([^"]+)"/)
    const id = /aria-describedby="([^"]+)"/.exec(out)![1]
    expect(out).toMatch(new RegExp(`<span[^>]*id="${id}"[^>]*data-nospeak`))
    expect(out).toContain('The compounded context only you could have produced.')
  })
  it('draws nothing extra on a page without definitions', () => {
    expect(renderToStaticMarkup(<ArtifactMarkdown markdown="Your Agentic Edge grows." />)).not.toContain('data-defined-term')
  })
})

/** The karaoke words, in order, as the reader wraps them. */
function karaoke(markup: string): string[] {
  const root = document.createElement('div')
  root.innerHTML = markup
  document.body.appendChild(root)
  const spans = wrapWords(root)
  root.remove()
  return spans.map((s) => s.textContent ?? '')
}

describe('karaoke alignment survives defined terms', () => {
  const md = [
    'It grows with your Agentic Edge, which the harness. Reads.',
    'Your **Agentic Edge** is what the harness reads first.',
    '- The Agentic Edge compounds, and every harness session adds to it.',
    '| term | why |\n|---|---|\n| harness | it runs |',
  ].join('\n\n')
  it('the word spans and their order are identical with and without definitions', () => {
    const plain = karaoke(renderToStaticMarkup(<ArtifactMarkdown markdown={md} />))
    const defined = karaoke(html(md))
    expect(html(md)).toContain('data-defined-term')
    // Same count, same order, same tokens as the highlighter compares them (letters and digits).
    expect(defined.length).toBe(plain.length)
    expect(defined.map(normalizeWord)).toEqual(plain.map(normalizeWord))
  })
  it('and they are the words the narration speaks', () => {
    const spoken = narrationTextFromMarkdown(md).split(/\s+/).map(normalizeWord).filter(Boolean)
    expect(karaoke(html(md)).map(normalizeWord).filter(Boolean)).toEqual(spoken)
  })
  it('a tap on a defined word is not a seek, a tap on any other word is', () => {
    const root = document.createElement('div')
    root.innerHTML = html('Your Agentic Edge grows.')
    const spans = wrapWords(root)
    const edge = spans.find((s) => s.textContent === 'Edge')!
    const grows = spans.find((s) => s.textContent === 'grows.')!
    expect(edge.closest('[data-defined-term]')).not.toBeNull()
    expect(seekableWord(edge)).toBeNull()
    expect(seekableWord(grows)).toBe(grows)
  })
})
