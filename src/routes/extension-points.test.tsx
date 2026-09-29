// The four places a pack can draw more than colours, and the way one page picks a pack of its own.
// Every pack that uses none of them is held byte for byte to 0.15.0 by unchanged-default.test.tsx;
// these hold what each one does when it IS used, and that the read-along still finds every word.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault, type BrandPack, type SectionProps } from '../brand/pack.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { narrationText, normalizeWord } from '../artifacts/narration.js'
import { wrapWords } from '../reader/artifact-reader.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'

const ID = 'abc23456'
const MD = [
  'A preamble before any section.', '',
  '## 1. Opening', '', 'First words, with **bold** and a [link](https://example.com/x).', '',
  '![Two ways to use it](https://cdn.example.com/j/01-two-ways.abc12345.mp4)', '',
  '### A subhead stays inside', '', 'More words.', '',
  '## Part one: the middle', '', 'A part says one thing.', '',
  '## 2. Closing', '', '- a listed thing', '- another', '',
  '![Still the original](https://cdn.example.com/j/05-kept.abc12345.mp4)', '',
  'Last words here.',
].join('\n')
const rec: ArtifactRecord = {
  id: ID, title: 'The Plan', subtitle: 'A line under it', summary: 'Three bets.', template: 'document', markdown: MD,
  createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', views: 0, version: 3,
}

function routesFor(r: ArtifactRecord, extra: Partial<Parameters<typeof createArtifactRoutes>[0]> = {}) {
  const store: ArtifactStore = {
    get: vi.fn(async (id) => (id === ID ? r : null)),
    save: vi.fn(async () => ({ id: ID, version: 1, created: true })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
  }
  return createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://example.com', publishKey: () => 'k', readCookie: async () => undefined, ...extra })
}
const page = async (r: ArtifactRecord, extra: Partial<Parameters<typeof createArtifactRoutes>[0]> = {}) =>
  renderToStaticMarkup(await routesFor(r, extra).Page({ params: Promise.resolve({ id: ID }) }))

const seen: SectionProps[] = []
/** A pack using all four extension points, the way a real one must: every word it adds is inside
 *  data-nospeak, and the title, subtitle, summary and headings it is handed are drawn as text. */
const full: BrandPack = {
  ...freedomDefault,
  id: 'full',
  kicker: 'A page from Example',
  Cover: ({ title, subtitle, summary, kicker, meta, version }) => (
    <header data-test-cover>
      {kicker}
      <p data-nospeak data-test-cover-extra>{`Edition ${version}, drawn by the pack`}</p>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <p>{summary}</p>
      <div data-test-cover-meta>{meta}</div>
    </header>
  ),
  Article: ({ cover, toc, children }) => (
    <article data-test-article>
      {cover}
      <nav data-test-toc>{toc}</nav>
      {children}
    </article>
  ),
  Section: (p) => {
    seen.push(p)
    return (
      <section data-test-section={p.index} data-of={p.count}>
        <div data-nospeak data-test-break>{`Break ${p.index + 1} of ${p.count}`}</div>
        <div {...p.headingAttrs} data-test-heading>
          <h2>{p.headingContent}</h2>
        </div>
        <div data-test-body>{p.children}</div>
      </section>
    )
  },
  figure: (src) => (/\/01-/.test(src) ? ({ alt }) => <figure data-test-figure><figcaption>{`Redrawn: ${alt}`}</figcaption></figure> : undefined),
}

describe('BrandPack.Cover', () => {
  it('draws the title block instead of the default header, and is handed the kicker and version line to place', async () => {
    const html = await page(rec, { brand: full })
    expect(html).toContain('data-test-cover')
    expect(html).toContain('Edition 3, drawn by the pack')
    // The shell's own kicker and version line, placed by the pack, still unspoken.
    expect(html).toMatch(/data-test-cover-meta="true"><p data-nospeak="true"[^>]*>Version 3 · Updated/)
    expect(html).toContain('A page from Example')
    // The default header is gone: its classes appear nowhere.
    expect(html).not.toContain('pt-24 sm:pt-28')
  })
})

describe('BrandPack.Article', () => {
  it('holds the cover, the table of contents and the body', async () => {
    const html = await page({ ...rec, toc: true }, { brand: full })
    const at = (s: string) => html.indexOf(s)
    expect(at('data-test-article')).toBeGreaterThan(-1)
    expect(at('data-test-article')).toBeLessThan(at('data-test-cover'))
    expect(at('data-test-cover')).toBeLessThan(at('data-test-toc'))
    expect(html).toMatch(/data-test-toc="true"><details data-nospeak="true" data-artifact-toc="inline"/)
    expect(at('data-test-toc')).toBeLessThan(at('First words'))
    expect(html).not.toContain('mx-auto max-w-2xl px-6 pb-24')
  })
})

describe('BrandPack.Section', () => {
  it('receives every top-level section in order with its index, count, outline, slug and body', async () => {
    seen.length = 0
    const html = await page(rec, { brand: full })
    expect(seen.map((s) => [s.index, s.count, s.text, s.slug])).toEqual([
      [0, 3, '1. Opening', '1-opening'],
      [1, 3, 'Part one: the middle', 'part-one-the-middle'],
      [2, 3, '2. Closing', '2-closing'],
    ])
    expect(seen[0].outline.map((o) => o.text)).toEqual(['1. Opening', 'Part one: the middle', '2. Closing'])
    // The heading keeps its id (contents links) and its comment anchor, on the element the pack chose.
    expect(html).toMatch(/<div id="1-opening" data-block="[^"]+" data-test-heading="true"><h2>1. Opening<\/h2>/)
    // A deeper heading stays inside its section's body; the section ends at the next one.
    const first = html.slice(html.indexOf('data-test-section="0"'), html.indexOf('data-test-section="1"'))
    expect(first).toContain('A subhead stays inside')
    expect(first).toContain('More words.')
    expect(first).not.toContain('A part says one thing.')
    // Content before the first section is left where it was, outside every section.
    expect(html.indexOf('A preamble before any section.')).toBeLessThan(html.indexOf('data-test-section="0"'))
  })
  it('the body blocks keep their comment anchors', async () => {
    const html = await page(rec, { brand: full })
    expect(html).toMatch(/<p data-block="[^"]+" class="my-4 leading-relaxed">More words\.<\/p>/)
  })
})

describe('BrandPack.figure', () => {
  it('an image the pack claims replaces its whole paragraph, unspoken and still anchored', async () => {
    const html = await page(rec, { brand: full })
    expect(html).toMatch(/<div data-block="[^"]+" data-nospeak="true" data-artifact-figure="true"><figure data-test-figure="true"><figcaption>Redrawn: Two ways to use it<\/figcaption><\/figure><\/div>/)
    expect(html).not.toContain('01-two-ways.abc12345.mp4')
    // Nothing block-level ends up inside a <p>.
    expect(html).not.toMatch(/<p[^>]*><div data-block/)
  })
  it('an image it does not claim renders as it always did', async () => {
    const html = await page(rec, { brand: full })
    expect(html).toContain('src="https://cdn.example.com/j/05-kept.abc12345.mp4"')
    expect(html).toContain('<video')
  })
})

describe('one page, its own pack', () => {
  const other: BrandPack = { ...freedomDefault, id: 'other', kicker: 'A page in the other look' }
  it('front matter `pack:` picks a pack the host registered, by name', async () => {
    expect(await page({ ...rec, pack: 'other' }, { packs: { other } })).toContain('A page in the other look')
  })
  it('a name the host does not know renders in its default pack', async () => {
    expect(await page({ ...rec, pack: 'nope' }, { packs: { other } })).toContain('A page from Freedom')
  })
  it('the host can choose for a page whose file cannot say, ahead of the front matter', async () => {
    const packFor = (a: ArtifactRecord) => (a.id === ID ? full : undefined)
    const html = await page({ ...rec, pack: 'other' }, { packs: { other }, packFor })
    expect(html).toContain('A page from Example')
    expect(await page(rec, { packFor: () => undefined })).toContain('A page from Freedom')
  })
  it('every other page on the host keeps the default', async () => {
    const packFor = (a: ArtifactRecord) => (a.id === 'xxx23456' ? full : undefined)
    const html = await page(rec, { packFor })
    expect(html).not.toContain('data-test-cover')
    expect(html).toContain('A page from Freedom')
  })
  it('the share card is drawn by the page\'s pack', async () => {
    const noCard: BrandPack = { ...freedomDefault, id: 'no-card', share: undefined }
    const res = await routesFor(rec, { packFor: () => noCard }).SHARE_IMAGE(new NextRequest('https://example.com/x/share.png'), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(404)
  })
  it('`pack:` parses as a name and refuses anything else', () => {
    const src = (v: string) => `---\ntitle: T\nsummary: S\npack: ${v}\n---\nbody`
    const ok = parseArtifactSource(src('night-sky'))
    expect(ok.ok && ok.meta.pack).toBe('night-sky')
    for (const bad of ['"Has Caps"', '"../x"', '"a b"', '3', `"${'x'.repeat(41)}"`]) expect(parseArtifactSource(src(bad)).ok, bad).toBe(false)
  })
})

describe('the read-along, across everything a pack injects', () => {
  it('the words on the page are exactly the words narrated, in order', async () => {
    const html = await page(rec, { brand: full })
    document.body.innerHTML = html
    const root = document.getElementById('artifact-narration-root')!
    const onPage = wrapWords(root).map((s) => normalizeWord(s.textContent ?? '')).filter(Boolean)
    const spoken = narrationText(rec).split(/\s+/).map(normalizeWord).filter(Boolean)
    expect(onPage).toEqual(spoken)
  })
})
