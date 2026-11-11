import { describe, it, expect } from 'vitest'
import { parseFileBody, fileLinks, fileNoun, sizeWords } from './file-page.js'
import { parseArtifactSource } from './front-matter.js'

const src = (file: unknown, extra = '', body = '') => `---\ntitle: Pricing model\nsummary: A file.\ntemplate: file\nfile: ${JSON.stringify(file)}\n${extra}---\n${body}`

describe('parseFileBody', () => {
  it('takes the name, size and workspace path, and derives the type from the stored name, never from the publisher', () => {
    expect(parseFileBody({ name: 'Pricing model.pdf', bytes: 2400000, source: 'documents/pricing.pdf' }))
      .toEqual({ ok: true, file: { name: 'Pricing model.pdf', bytes: 2400000, source: 'documents/pricing.pdf', type: 'application/pdf' } })
    const r = parseFileBody({ name: 'model.pdf', bytes: 9, source: 'a/model.pdf', ref: 'private:page.0123abcd.html' })
    expect(r.ok && r.file.type).toBe('text/html')
  })
  it('refuses a type sent by the publisher, a name with a slash, a size that is not a whole number, and a ref that is not private', () => {
    expect(parseFileBody({ name: 'a.pdf', bytes: 1, source: 's', type: 'application/pdf' }).ok).toBe(false)
    expect(parseFileBody({ name: '../a.pdf', bytes: 1, source: 's' }).ok).toBe(false)
    expect(parseFileBody({ name: 'a.pdf', bytes: 1.5, source: 's' }).ok).toBe(false)
    expect(parseFileBody({ name: 'a.pdf', bytes: 1, source: 's', ref: 'https://x.example.com/a.pdf' }).ok).toBe(false)
    expect(parseFileBody(null).ok).toBe(false)
  })
})

describe('template: file', () => {
  it('is its own kind: per-reader links and private media by nature', () => {
    const r = parseArtifactSource(src({ name: 'a.xlsx', bytes: 180000, source: 'documents/a.xlsx' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.template).toBe('file')
    expect(r.meta.links).toBe('per-reader')
    expect(r.meta.privateMedia).toBe(true)
    expect(r.meta.file?.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })
  it('has no body and no door, comments, narration or cover, refused in words', () => {
    const f = { name: 'a.pdf', bytes: 1, source: 's' }
    expect(parseArtifactSource(src(f, '', 'Some words')).ok).toBe(false)
    for (const extra of ['access: invite\n', 'password: x\n', 'comments: anyone\n', 'voice: af_heart\n', 'cover: c.jpg\n']) {
      const r = parseArtifactSource(src(f, extra))
      expect(r.ok, extra).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/a file page holds one file/)
    }
  })
  it('needs file:, and file: belongs to a file page only', () => {
    expect(parseArtifactSource('---\ntitle: T\nsummary: S\ntemplate: file\n---\n').ok).toBe(false)
    const r = parseArtifactSource(`---\ntitle: T\nsummary: S\nfile: ${JSON.stringify({ name: 'a.pdf', bytes: 1, source: 's' })}\n---\nBody\n`)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('file: belongs to template: file')
  })
})

describe('fileLinks', () => {
  const urls = (id: string, stored: string, o?: { download?: string }) => Promise.resolve(`${stored}${o?.download ? `?dl=${o.download}` : ''}`)
  it('a pdf opens in place and downloads', async () => {
    expect(await fileLinks('f', { name: 'Deck.pdf', bytes: 1, source: 's', type: 'application/pdf', ref: 'private:Deck.0123abcd.pdf' }, urls))
      .toEqual({ open: 'Deck.0123abcd.pdf', download: 'Deck.0123abcd.pdf?dl=Deck.pdf' })
  })
  it('a spreadsheet, an html file and an svg only download', async () => {
    for (const [name, stored] of [['m.xlsx', 'm.0123abcd.xlsx'], ['p.html', 'p.0123abcd.html'], ['s.svg', 's.0123abcd.svg']]) {
      const l = await fileLinks('f', { name, bytes: 1, source: 's', type: 'whatever', ref: `private:${stored}` }, urls)
      expect(l?.open, name).toBeNull()
      expect(l?.download).toBe(`${stored}?dl=${name}`)
    }
  })
  it('the type comes from the stored name, never the record: a record saying pdf over stored html does not open', async () => {
    expect((await fileLinks('f', { name: 'x.pdf', bytes: 1, source: 's', type: 'application/pdf', ref: 'private:x.0123abcd.html' }, urls))?.open).toBeNull()
  })
  it('null before the file arrives', async () => {
    expect(await fileLinks('f', { name: 'x.pdf', bytes: 1, source: 's', type: 'application/pdf' }, urls)).toBeNull()
  })
})

describe('words', () => {
  it('names the kind of file and its size', () => {
    expect(fileNoun('application/pdf')).toEqual({ cap: 'PDF', noun: 'PDF' })
    expect(fileNoun('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toEqual({ cap: 'Spreadsheet', noun: 'spreadsheet' })
    expect(fileNoun('application/zip')).toEqual({ cap: 'Archive', noun: 'zip file' })
    expect(fileNoun('application/octet-stream')).toEqual({ cap: 'File', noun: 'file' })
    expect(sizeWords(2_400_000)).toBe('2.4 MB')
    expect(sizeWords(180_000)).toBe('180 KB')
    expect(sizeWords(512)).toBe('512 bytes')
  })
})
