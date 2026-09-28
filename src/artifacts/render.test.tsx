import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from './render.js'

const html = (md: string) => renderToStaticMarkup(<ArtifactMarkdown markdown={md} />)

describe('ArtifactMarkdown', () => {
  it('an .mp4 in image syntax plays as a silent looping inline video, which a phone decodes in hardware', () => {
    const out = html('![The stack, animated](https://cdn.example.com/02-the-stack.abc12345.mp4)')
    expect(out).toContain('<video')
    expect(out).toContain('src="https://cdn.example.com/02-the-stack.abc12345.mp4"')
    for (const a of ['muted', 'loop', 'playsinline', 'data-artifact-video']) expect(out).toContain(a)
    // Not autoplay: that makes every video on the page download at once. VideoAutoplay starts
    // each one as it nears the screen.
    expect(out).not.toContain('autoplay')
    expect(out).toContain('preload="metadata"')
    expect(out).toContain('aria-label="The stack, animated"')
    expect(out).not.toContain('<img')
    expect(html('![still](https://cdn.example.com/a.png)')).toContain('<img')
  })
  it('an .mp3 in image syntax is a clip the reader plays: controls, a caption, nothing downloaded on open', () => {
    const out = html('![Gary on skill files, 42:10](https://cdn.example.com/clip-03.abc12345.mp3)')
    expect(out).toContain('<audio')
    expect(out).toContain('src="https://cdn.example.com/clip-03.abc12345.mp3"')
    expect(out).toContain('controls')
    expect(out).toContain('data-artifact-audio')
    // A page of twenty clips must not fetch twenty files before anyone presses play.
    expect(out).toContain('preload="none"')
    expect(out).not.toContain('autoplay')
    // The alt is the clip's caption, shown and read, so a list of clips is not a list of bare players.
    expect(out).toContain('Gary on skill files, 42:10')
    expect(out).not.toContain('<img')
    // A caption with markup in it is text, never markup.
    expect(html('![a <b>x</b> "y"](https://cdn.example.com/c.mp3)')).not.toContain('<b>x</b>')
  })
  it('renders gfm tables and links with the host shown', () => {
    const out = html('| a | b |\n|---|---|\n| 1 | 2 |\n\n[Anthropic](https://www.anthropic.com/news)')
    expect(out).toContain('<table')
    expect(out).toContain('href="https://www.anthropic.com/news"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('anthropic.com')
  })
  it('unwraps a relative file link to its text, because the file is on the author\'s disk', () => {
    // A workspace link like ../../meeting-transcripts/x.md points at nothing the
    // reader can reach; an anchor to it 404s and reads as a broken page.
    const out = html('See [the transcript](../../meeting-transcripts/2026-09-11-wilson.md) and [notes](./notes.md).')
    expect(out).not.toContain('meeting-transcripts')
    expect(out).not.toContain('notes.md')
    expect(out).not.toContain('<a')
    expect(out).toContain('the transcript')
    expect(out).toContain('notes')
  })
  it('keeps absolute, mailto, root and fragment links', () => {
    const out = html('[a](https://x.com/p) [b](mailto:hi@x.com) [c](/assets/q.webp) [d](#top)')
    expect(out).toContain('href="https://x.com/p"')
    expect(out).toContain('href="mailto:hi@x.com"')
    expect(out).toContain('href="/assets/q.webp"')
    expect(out).toContain('href="#top"')
  })
  it('escapes raw html', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
  it('renders a links fence as link cards', () => {
    const out = html('```links\nhttps://example.com/a | first\nhttps://example.org/b\n```')
    expect(out).toContain('data-artifact-links')
    expect(out).toContain('href="https://example.com/a"')
    expect(out).toContain('first')
    expect(out).toContain('example.org')
    expect(out).not.toContain('<pre')
  })
  it('renders a note callout', () => {
    const out = html('> [!note]\n> Read this first.')
    expect(out).toContain('data-callout="note"')
    expect(out).toContain('Read this first.')
    expect(out).not.toContain('[!note]')
  })
  it('renders an ordinary blockquote as a blockquote', () => {
    const out = html('> plain quote')
    expect(out).toContain('<blockquote')
    expect(out).not.toContain('data-callout')
  })
  it('gives fenced code a copy affordance', () => {
    const out = html('```bash\nls\n```')
    expect(out).toContain('<pre')
    expect(out).toContain('data-artifact-code')
  })

  describe('the notes widget', () => {
    const md = '# Title\n\n## Sales\n\nWords.\n\n## Sales\n\n```notes\nvisibility: shared\n```\n'
    const withNotes = (m: string) => renderToStaticMarkup(<ArtifactMarkdown markdown={m} notes={{ artifactId: 'abc23456', accent: '#c9a96e' }} />)
    it('puts a note control, marked not to be spoken, beside every heading, with the heading\'s slug as its id', () => {
      const out = withNotes(md)
      expect(out).toContain('id="title"')
      expect(out).toContain('id="sales"')
      expect(out).toContain('id="sales-1"')
      for (const slug of ['title', 'sales', 'sales-1']) expect(out).toMatch(new RegExp(`<button[^>]*data-note-toggle="${slug}"[^>]*>`))
      expect(out).toMatch(/<button[^>]*data-nospeak[^>]*data-note-toggle="sales"|<button[^>]*data-note-toggle="sales"[^>]*data-nospeak/)
    })
    it('draws the fence as the notes block, never as code', () => {
      const out = withNotes(md)
      expect(out).toContain('data-artifact-notes')
      expect(out).not.toContain('<pre')
      expect(out).not.toContain('visibility: shared')
    })
    it('without a state store (no notes prop) the fence draws nothing and headings get no control', () => {
      const out = html(md)
      expect(out).not.toContain('data-note-toggle')
      expect(out).not.toContain('<pre')
      expect(out).not.toContain('visibility')
    })
    it('a page with no notes fence gets no controls even when notes are possible', () => {
      expect(withNotes('## Sales\n\nWords.')).not.toContain('data-note-toggle')
    })
  })
})

describe('block ids (data-block), what a region comment is pinned to', () => {
  const ids = (md: string) => [...html(md).matchAll(/data-block="([^"]+)"/g)].map((m) => m[1])
  const PAGE = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n\n```js\nx()\n```\n\n![A chart](https://cdn.example.com/chart.0a1b2c3d.png)\n'

  it('every top-level block carries one: heading, paragraph, list, table, blockquote, code, image', () => {
    const out = ids(PAGE)
    expect(out).toHaveLength(9)
    for (const kind of ['h', 'p', 'ul', 'table', 'quote', 'code', 'img']) expect(out.some((id) => id.startsWith(`b-${kind}-`))).toBe(true)
    expect(new Set(out).size).toBe(out.length)
    // Nested blocks do not: the list's items and the quote's paragraph have none of their own.
    expect(out.filter((id) => id.startsWith('b-p-'))).toHaveLength(3)
  })

  it('an edit to paragraph 3 leaves paragraph 1 and the image where they were', () => {
    const before = ids(PAGE)
    const after = ids(PAGE.replace('Third paragraph.', 'Third paragraph, rewritten.'))
    expect(after[1]).toBe(before[1])
    expect(after[3]).not.toBe(before[3])
    expect(after.at(-1)).toBe(before.at(-1))
  })

  it('an image is keyed by its asset name, so a re-upload of the same file name keeps its comments', () => {
    const a = ids('![A chart](https://cdn.example.com/chart.0a1b2c3d.png)')
    const b = ids('![A new caption](https://cdn.example.com/chart.ffffeeee.png?v=2)')
    expect(a).toEqual(b)
  })

  it('identical blocks get distinct ids, and inserting a block above does not move either', () => {
    const two = ids('Same.\n\nSame.')
    expect(two[1]).toBe(`${two[0]}-1`)
    expect(ids('New.\n\nSame.\n\nSame.').slice(1)).toEqual(two)
  })
})
