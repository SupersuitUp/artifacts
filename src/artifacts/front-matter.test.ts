import { describe, it, expect } from 'vitest'
import { parseArtifactSource } from './front-matter.js'

const good = `---\ntitle: Hello\nsummary: One line\n---\n# Body\n`

describe('parseArtifactSource', () => {
  it('parses title, summary, body and defaults template', () => {
    const r = parseArtifactSource(good)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.meta).toEqual({ title: 'Hello', summary: 'One line', template: 'document' })
    expect(r.body.trim()).toBe('# Body')
  })
  it('requires title and summary, naming the field', () => {
    const r = parseArtifactSource(`---\ntitle: X\n---\nbody`)
    expect(r).toEqual({ ok: false, error: 'front matter is missing summary' })
  })
  it('rejects an unknown key by name', () => {
    const r = parseArtifactSource(`---\ntitle: X\nsummary: Y\ncolour: red\n---\nbody`)
    expect(r).toEqual({ ok: false, error: 'front matter has an unknown key: colour' })
  })
  it('rejects a template other than document', () => {
    const r = parseArtifactSource(`---\ntitle: X\nsummary: Y\ntemplate: slides\n---\nbody`)
    expect(r).toEqual({ ok: false, error: 'template must be document' })
  })
  it('keeps optional audience, cover and id', () => {
    const r = parseArtifactSource(`---\ntitle: X\nsummary: Y\naudience: Yasmin\ncover: https://x/y.webp\nid: abc23456\n---\nbody`)
    expect(r.ok && r.meta.audience).toBe('Yasmin')
    expect(r.ok && r.meta.cover).toBe('https://x/y.webp')
    expect(r.ok && r.meta.id).toBe('abc23456')
  })
  it('keeps a password, which the page renders as a door and never as text', () => {
    const r = parseArtifactSource(`---\ntitle: X\nsummary: Y\npassword: "day ones"\n---\nbody`)
    expect(r.ok && r.meta.password).toBe('day ones')
  })
  it('rejects a body with no front matter', () => {
    expect(parseArtifactSource('# just markdown')).toEqual({ ok: false, error: 'front matter is missing title' })
  })
})

describe('access', () => {
  it('takes invite or freedom, and refuses anything else by name', () => {
    const ok = parseArtifactSource(`---\ntitle: T\nsummary: S\naccess: freedom\n---\nx`)
    expect(ok.ok && ok.meta.access).toBe('freedom')
    const bad = parseArtifactSource(`---\ntitle: T\nsummary: S\naccess: everyone\n---\nx`)
    expect(bad).toEqual({ ok: false, error: 'access must be one of: public, invite, freedom' })
  })
})

describe('subtitle', () => {
  it('is its own field, separate from title and summary', () => {
    const r = parseArtifactSource(`---\ntitle: FREEDOM\nsubtitle: A First-of-its-Kind System\nsummary: The teaser.\n---\nx`)
    expect(r.ok && [r.meta.title, r.meta.subtitle, r.meta.summary]).toEqual(['FREEDOM', 'A First-of-its-Kind System', 'The teaser.'])
  })
})

describe('state', () => {
  it('parses a state block', () => {
    const r = parseArtifactSource('---\ntitle: T\nsummary: S\nstate:\n  writers: anyone\n  slots:\n    progress: { shape: one }\n---\nbody')
    expect(r.ok && r.meta.state).toEqual({ writers: 'anyone', visibility: 'private', slots: { progress: { shape: 'one' } } })
  })
  it('refuses a bad state block with its reason', () => {
    const r = parseArtifactSource('---\ntitle: T\nsummary: S\nstate:\n  slots:\n    x: { shape: few }\n---\nbody')
    expect(r).toEqual({ ok: false, error: 'slot "x" needs shape one or many' })
  })
})
