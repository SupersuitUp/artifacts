import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { tocOf, showToc, TocRail, TocInline } from './toc.js'
import { ArtifactMarkdown } from './render.js'

const four = '## One\n\na\n\n## Two\n\n### Deeper\n\n## Three\n\n## Three\n'

describe('table of contents', () => {
  it('lists the sections, with the slugs the page draws', () => {
    expect(tocOf(four)).toEqual([
      { slug: 'one', text: 'One' },
      { slug: 'two', text: 'Two' },
      { slug: 'three', text: 'Three' },
      { slug: 'three-1', text: 'Three' },
    ])
  })
  it('draws itself from four sections, never when turned off, and from one when turned on', () => {
    expect(showToc(four)).toBe(true)
    expect(showToc('## A\n## B\n## C\n')).toBe(false)
    expect(showToc(four, false)).toBe(false)
    expect(showToc('## A\n', true)).toBe(true)
    expect(showToc('no sections', true)).toBe(false)
  })
  it('every section heading on the page carries the id its entry links to, with or without notes', () => {
    const out = renderToStaticMarkup(<ArtifactMarkdown markdown={four} />)
    for (const e of tocOf(four)) expect(out).toContain(`id="${e.slug}"`)
  })
  it('the rail and the inline list link to the sections and are never read aloud', () => {
    const items = tocOf(four)
    for (const html of [renderToStaticMarkup(<TocRail items={items} />), renderToStaticMarkup(<TocInline items={items} />)]) {
      expect(html).toContain('href="#three-1"')
      expect(html).toContain('data-nospeak')
    }
    expect(renderToStaticMarkup(<TocInline items={items} />)).toContain('<details')
  })
})
