// A page has a language and may name its translations (supersuit-dev#2156). `lang:` marks the
// page's words for screen readers and the browser's translate offer, and sets og:locale.
// `translations:` names the same document in other languages by page id: the page draws a small
// switch at the top ("English · Español") and the unfurl carries hreflang alternates.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { languageName } from '../artifacts/language.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'

const ID = 'abc23456'
const ES = 'esp23456'
const base: ArtifactRecord = {
  id: ID, title: 'The Guide', summary: 'How to pack out.', template: 'document', markdown: '# Body\n\nWords.',
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', views: 0, version: 1,
}
function routesFor(rec: ArtifactRecord) {
  const store: ArtifactStore = {
    get: vi.fn(async (id) => (id === ID ? rec : null)),
    save: vi.fn(async () => ({ id: ID, version: 1, created: true })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
  }
  return createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'https://pages.example.com', publishKey: () => 'k', readCookie: async () => undefined })
}
const params = { params: Promise.resolve({ id: ID }) }

describe('lang: and translations: in the front matter', () => {
  it('takes a language tag and a map of language to page id', () => {
    const r = parseArtifactSource(`---\ntitle: T\nsummary: S\nlang: en\ntranslations: {"es": "${ES}", "pt-BR": "ptb23456"}\n---\nbody`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.meta.lang).toBe('en')
      expect(r.meta.translations).toEqual({ es: ES, 'pt-BR': 'ptb23456' })
    }
  })
  it('refuses a language that is not a tag, and a translation that is not a page id', () => {
    const a = parseArtifactSource('---\ntitle: T\nsummary: S\nlang: Spanish please\n---\nbody')
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.error).toMatch(/lang must be a language tag/)
    const b = parseArtifactSource('---\ntitle: T\nsummary: S\ntranslations: {"es": "./guide.es.md"}\n---\nbody')
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.error).toMatch(/translations/)
  })
})

describe('the language on the page', () => {
  it('a page with lang: marks its words with it; a page without draws exactly as before', async () => {
    const html = renderToStaticMarkup(await routesFor({ ...base, lang: 'es' }).Page(params))
    expect(html).toMatch(/<div id="artifact-narration-root" lang="es">/)
    const plain = renderToStaticMarkup(await routesFor(base).Page(params))
    expect(plain).toMatch(/<div id="artifact-narration-root">/)
    expect(plain).not.toContain('data-translations')
  })
  it('draws a switch naming each language in itself, this one unlinked', async () => {
    const html = renderToStaticMarkup(await routesFor({ ...base, lang: 'en', translations: { es: ES } }).Page(params))
    const nav = html.match(/<nav [^>]*data-translations[^>]*>.*?<\/nav>/)?.[0] ?? ''
    expect(nav).toMatch(/data-nospeak="true"/)
    expect(nav).toMatch(/<span aria-current="page" lang="en">English<\/span>/)
    expect(nav).toMatch(new RegExp(`<a href="/${ES}" hreflang="es" lang="es"[^>]*>Español</a>`, "i"))
    expect(nav.replace(/<[^>]+>/g, '')).toBe('English · Español')
  })
  it('the unfurl carries og:locale and hreflang alternates', async () => {
    const m = await routesFor({ ...base, lang: 'en', translations: { es: ES } }).generateMetadata(params)
    expect(m.openGraph).toMatchObject({ locale: 'en' })
    expect(m.alternates?.languages).toEqual({ en: `https://pages.example.com/${ID}`, es: `https://pages.example.com/${ES}` })
  })
})

describe('languageName', () => {
  it('names a language in that language, capitalised', () => {
    expect(languageName('en')).toBe('English')
    expect(languageName('es')).toBe('Español')
    expect(languageName('xx-not-a-lang')).toBe('xx-not-a-lang')
  })
})
