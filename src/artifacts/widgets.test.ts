import { describe, it, expect } from 'vitest'
import { slugify, headingsOf, scanWidgets, mergeWidgetState, checkNoteValue, placeNotes, NOTES_SLOT } from './widgets.js'

describe('slugify and headingsOf', () => {
  it('slugs like GitHub: lowercase, punctuation dropped, spaces to dashes', () => {
    expect(slugify('Sales & Marketing!')).toBe('sales--marketing')
    expect(slugify('  Café Ops 2 ')).toBe('café-ops-2')
    expect(slugify('???')).toBe('section')
  })
  it('lists every heading with its line, and numbers duplicates', () => {
    const md = '# Title\n\nintro\n\n## Sales\n\ntext\n\n## Sales\n\n### Deep *dive*'
    expect(headingsOf(md)).toEqual([
      { depth: 1, line: 1, text: 'Title', slug: 'title' },
      { depth: 2, line: 5, text: 'Sales', slug: 'sales' },
      { depth: 2, line: 9, text: 'Sales', slug: 'sales-1' },
      { depth: 3, line: 11, text: 'Deep dive', slug: 'deep-dive' },
    ])
  })
  it('does not count a heading-looking line inside a code fence', () => {
    expect(headingsOf('```bash\n# not a heading\n```\n\n## Real').map((h) => h.slug)).toEqual(['real'])
  })
})

describe('scanWidgets', () => {
  it('finds a notes fence with its line and optional visibility', () => {
    const r = scanWidgets('## A\n\n```notes\nvisibility: shared\n```\n', 10)
    expect(r).toEqual({ ok: true, notes: { line: 13, visibility: 'shared' } })
  })
  it('an empty notes fence is fine; a page without one has none', () => {
    expect(scanWidgets('```notes\n```', 0)).toEqual({ ok: true, notes: { line: 1 } })
    expect(scanWidgets('# plain\n\n```bash\nls\n```', 0)).toEqual({ ok: true, notes: null })
  })
  it('refuses a second notes fence, naming its line', () => {
    const r = scanWidgets('```notes\n```\n\n## B\n\n```notes\n```', 4)
    expect(r).toEqual({ ok: false, error: 'line 10: a page takes at most one notes block' })
  })
  it('refuses a name, an unknown key, a bad line, and tally', () => {
    expect(scanWidgets('```notes mine\n```', 0)).toEqual({ ok: false, error: 'line 1: the notes block takes no name; it always writes to slot "notes"' })
    expect(scanWidgets('```notes\ncolor: red\n```', 0)).toEqual({ ok: false, error: 'line 2: the notes block has an unknown key: color' })
    expect(scanWidgets('```notes\njust words\n```', 0)).toEqual({ ok: false, error: 'line 2: the notes block takes lines like "visibility: shared"' })
    expect(scanWidgets('```notes\nvisibility: tally\n```', 0)).toEqual({ ok: false, error: 'line 2: notes visibility must be private or shared' })
  })
  it('refuses the widgets this version does not draw yet, rather than showing them as code', () => {
    for (const w of ['poll', 'form', 'checklist'])
      expect(scanWidgets(`intro\n\n\`\`\`${w} x\nq: y\n\`\`\``, 0)).toEqual({ ok: false, error: `line 3: the ${w} widget is not available in this version of the artifacts package` })
  })
})

describe('mergeWidgetState', () => {
  it('a notes fence on a page with no state: declares the slot with the defaults', () => {
    expect(mergeWidgetState(undefined, { line: 3 })).toEqual({ ok: true, state: { writers: 'signed-in', visibility: 'private', slots: { notes: { shape: 'many' } } } })
  })
  it('keeps the page\'s own state and slots, and takes the fence\'s visibility', () => {
    const state = { writers: 'anyone' as const, visibility: 'tally' as const, slots: { vote: { shape: 'one' as const } } }
    expect(mergeWidgetState(state, { line: 3, visibility: 'shared' })).toEqual({
      ok: true, state: { writers: 'anyone', visibility: 'tally', slots: { vote: { shape: 'one' }, notes: { shape: 'many', visibility: 'shared' } } },
    })
  })
  it('accepts a page that already declares notes as many (the first real page)', () => {
    const state = { writers: 'signed-in' as const, visibility: 'shared' as const, slots: { notes: { shape: 'many' as const } } }
    expect(mergeWidgetState(state, { line: 3 })).toEqual({ ok: true, state })
  })
  it('refuses a notes slot declared as one, and a visibility that disagrees', () => {
    const one = { writers: 'signed-in' as const, visibility: 'private' as const, slots: { notes: { shape: 'one' as const } } }
    expect(mergeWidgetState(one, { line: 7 })).toEqual({ ok: false, error: 'line 7: the notes block writes to slot "notes" as shape many, and state: declares it shape one; rename that slot' })
    const priv = { writers: 'signed-in' as const, visibility: 'private' as const, slots: { notes: { shape: 'many' as const, visibility: 'private' as const } } }
    expect(mergeWidgetState(priv, { line: 7, visibility: 'shared' })).toEqual({ ok: false, error: 'line 7: the notes block says visibility shared and state: says private for slot "notes"; say it once' })
  })
  it('no fence leaves state alone', () => {
    expect(mergeWidgetState(undefined, null)).toEqual({ ok: true, state: undefined })
  })
})

describe('checkNoteValue', () => {
  it('takes { slug, heading, note } and nothing else', () => {
    expect(NOTES_SLOT).toBe('notes')
    expect(checkNoteValue({ slug: 'sales', heading: 'Sales', note: 'Add the pipeline review' })).toBeNull()
    expect(checkNoteValue('hello')).toBe('a note is { slug, heading, note }')
    expect(checkNoteValue({ slug: 'sales', heading: 'Sales', note: '   ' })).toBe('a note needs some text')
    expect(checkNoteValue({ slug: 'sales', heading: 'Sales', note: 'x'.repeat(4001) })).toBe('a note is at most 4000 characters')
    expect(checkNoteValue({ slug: 'Bad Slug', heading: 'Sales', note: 'x' })).toBe('a note needs the slug of the heading it is under')
    expect(checkNoteValue({ slug: 's', heading: 'h'.repeat(301), note: 'x' })).toBe('a note needs the heading it is under')
    expect(checkNoteValue({ slug: 's', heading: 'S', note: 'x', extra: 1 })).toBe('a note is { slug, heading, note }')
  })
})

describe('placeNotes', () => {
  const headings = [
    { depth: 2, line: 1, text: 'Sales', slug: 'sales' },
    { depth: 2, line: 3, text: 'Ops', slug: 'ops' },
    { depth: 2, line: 5, text: 'Ops', slug: 'ops-1' },
  ]
  const n = (id: string, slug: string, heading: string) => ({ id, slug, heading, note: id, name: 'Sam', at: '2026-09-25T00:00:00Z', mine: false })
  it('puts a note under its heading by slug', () => {
    const r = placeNotes(headings, [n('a', 'sales', 'Sales'), n('b', 'ops-1', 'Ops')])
    expect(r.bySlug.sales.map((x) => x.id)).toEqual(['a'])
    expect(r.bySlug['ops-1'].map((x) => x.id)).toEqual(['b'])
    expect(r.earlier).toEqual([])
  })
  it('falls back to the exact heading text when the slug is gone', () => {
    const r = placeNotes([{ depth: 2, line: 1, text: 'Ops', slug: 'ops' }], [n('c', 'ops-1', 'Ops')])
    expect(r.bySlug.ops.map((x) => x.id)).toEqual(['c'])
  })
  it('a renamed or removed heading\'s notes go to earlier versions, never to the wrong section', () => {
    const r = placeNotes(headings, [n('d', 'marketing', 'Marketing'), n('e', 'sales', 'Sales')])
    expect(r.earlier.map((x) => x.id)).toEqual(['d'])
    expect(r.bySlug.sales.map((x) => x.id)).toEqual(['e'])
  })
})
