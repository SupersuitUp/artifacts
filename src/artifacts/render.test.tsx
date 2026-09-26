import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from './render.js'

const html = (md: string) => renderToStaticMarkup(<ArtifactMarkdown markdown={md} />)

describe('ArtifactMarkdown', () => {
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
