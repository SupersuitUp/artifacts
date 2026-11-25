// A voice eCard served by the routes (0.74.0): the scene in place of the document reader, the
// envelope paper and gold by default and the page's brand on `envelope: brand`, the letter's
// timed words, the brand seal, the comment layer kept for a reply, and the kind staying put.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactRecord, ArtifactStore, SaveInput } from '../artifacts/store.js'
import { ENVELOPE_PAPER } from '../artifacts/voice-ecard-assets.js'
import { voiceEcardLook, GILDED, recordingName, letterText } from '../artifacts/voice-ecard-page.js'
import { memoryRecipientsStore, summarizeViews } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { mergeCommentsState } from '../artifacts/comments.js'

const site = 'https://artifacts.example.com'
const WORDS = [{ w: 'Dear', s: 4, e: 4.3 }, { w: 'Robin,', s: 4.35, e: 4.9, br: 1 }, { w: 'Thank', s: 5.6, e: 5.9 }, { w: 'you.', s: 5.95, e: 6.4 }]
const card = (over: Partial<ArtifactRecord> = {}): Partial<ArtifactRecord> => ({
  id: 'card2345', template: 'voice-ecard', title: 'Happy Thanksgiving', summary: 'A card for you', to: 'Robin', markdown: 'Dear Robin,\n\nThank you.\n',
  cover: 'https://cdn.example.com/wrap.webp', comments: 'anyone', state: { slots: { comments: { kind: 'list', writers: 'anyone', max: 200 } } } as never,
  voiceEcard: { from: 'Sam', occasion: 'thanksgiving', envelope: 'gold', audio: 'https://cdn.example.com/a/card%20mix.m4a', words: WORDS, mark: true },
  ...over,
})
async function page(rec: Partial<ArtifactRecord>, over = {}) {
  const r = createArtifactRoutes(testConfig({ store: memoryArtifactStore([rec]), state: createMemoryStateStore(), ...over }))
  return renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: rec.id! }) } as never))
}

describe('the page a voice eCard is', () => {
  it('draws the envelope scene, not the document reader, in BlessOut\'s gold paper and gold foil', async () => {
    const html = await page(card())
    expect(html).toContain('data-voice-ecard')
    expect(html).toContain(ENVELOPE_PAPER.gold.slice(0, 80))
    expect(html).toContain(`--ve-foil:${GILDED.foil}`)
    expect(html).toMatch(/To: (<!-- -->)?Robin/)
    expect(html).toMatch(/From: (<!-- -->)?Sam/)
    expect(html).toContain('Dear Robin,\nThank you.')
    expect(html).toContain('Made with Supersuit')
    expect(html).toContain('Hover over me')
    expect(html).not.toContain('artifact-narration-root')
  })
  it('on envelope: brand, the foil is the page\'s accent and the face its display face', () => {
    const look = voiceEcardLook({ from: 'Sam', occasion: 'other', envelope: 'brand', mark: true }, freedomDefault.type)
    expect(look.foil).toBe('var(--a-accent)')
    expect(look.face).toBe(freedomDefault.type.display)
    expect(look.envelope).toContain('var(--a-accent)')
    const gilded = voiceEcardLook({ from: 'Sam', occasion: 'other', envelope: 'navy', mark: true, font: 'script' }, freedomDefault.type)
    expect(gilded.envelope).toContain(ENVELOPE_PAPER.navy.slice(0, 60))
    expect(gilded.italic).toBe(false)
  })
  it('a pack with a mark seals the envelope with it', async () => {
    const Mark = ({ className }: { className?: string }) => <svg data-pack-mark className={className} />
    const html = await page(card(), { brand: { ...freedomDefault, Mark } })
    expect(html).toMatch(/class="ve-seal"[^>]*><svg data-pack-mark/)
  })
  it('mark: none on the page, or mark: false on the voice eCard, drops the Supersuit line', async () => {
    expect(await page(card({ mark: 'none' }))).not.toContain('Made with Supersuit')
    expect(await page(card({ voiceEcard: { ...card().voiceEcard!, mark: false } }))).not.toContain('Made with Supersuit')
  })
  it('names the recording the way play tracking does, and reads the body as paragraphs', () => {
    expect(recordingName('https://cdn.example.com/a/card%20mix.m4a?v=2')).toBe('card-mix.m4a')
    expect(letterText('Dear Robin,\n\nThank *you*.\n')).toBe('Dear Robin,\n\nThank you.')
  })
})

/** A store that saves what POST parses, enough for the publish route. */
function savingStore() {
  const base = memoryArtifactStore([])
  let n = 0
  const save: ArtifactStore['save'] = async (input: SaveInput) => {
    const now = new Date().toISOString()
    const prev = input.id ? base.pages.get(input.id) : undefined
    if (input.id && !prev) return { notFound: true }
    const id = input.id ?? `vec${'abcdefgh'[n++]}2345`
    base.pages.set(id, { ...(prev ?? { createdAt: now, views: 0 }), id, title: input.meta.title, summary: input.meta.summary, template: input.meta.template, markdown: input.markdown, updatedAt: now,
      ...(input.meta.voiceEcard ? { voiceEcard: input.meta.voiceEcard } : {}), ...(input.meta.to ? { to: input.meta.to } : {}) } as ArtifactRecord)
    return { id, version: 1, created: !prev }
  }
  return Object.assign(base, { save })
}
const publish = (text: string, id?: string) =>
  new NextRequest(`${site}/api/artifacts${id ? `?id=${id}` : ''}`, { method: 'POST', body: text, headers: { authorization: 'Bearer test-key', 'content-type': 'text/markdown' } })

describe('publishing a voice eCard', () => {
  it('stores the spec; a republish that leaves template out stays a voice eCard; saying document is refused', async () => {
    const store = savingStore()
    const r = createArtifactRoutes(testConfig({ store }))
    const res = await r.POST(publish('---\ntitle: Happy Thanksgiving\nsummary: For you\ntemplate: voice-ecard\nto: Robin\nfrom: Sam\noccasion: thanksgiving\n---\nDear Robin.\n'))
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(store.pages.get(id)?.voiceEcard).toMatchObject({ from: 'Sam', envelope: 'gold' })
    expect((await r.POST(publish('---\ntitle: Happy Thanksgiving\nsummary: For you\nto: Robin\nfrom: Sam\nenvelope: red\n---\nDear Robin, again.\n', id))).status).toBe(200)
    expect(store.pages.get(id)?.template).toBe('voice-ecard')
    expect(store.pages.get(id)?.voiceEcard?.envelope).toBe('red')
    const doc = await r.POST(publish('---\ntitle: T\nsummary: S\ntemplate: document\n---\nNow a doc.\n', id))
    expect(doc.status).toBe(409)
    expect((await doc.json()).error).toContain('voice eCard')
  })
})

// the operator, 2026-11-25: "Remove comment feature methinks ya?" A voice eCard has no comment layer at all;
// "Reply with your voice" is the one way to answer, and its reply is the same comments-slot record.
describe('no comments on a voice eCard, one way to answer', () => {
  const RS = 'r'.repeat(40)
  const withComments = (rec: Partial<ArtifactRecord>) => {
    const m = mergeCommentsState(undefined, 'anyone', 'owner')
    if (!m.ok) throw new Error(m.error)
    return { ...rec, comments: 'anyone' as const, state: m.state }
  }
  it('the page draws no comment layer, no selection-to-comment, no pins, no comment list', async () => {
    const html = await page(withComments(card()))
    expect(html).not.toContain('data-comment-layer')
    expect(html).not.toContain('data-comment-button')
    expect(html).not.toContain('data-comment-pin')
    expect(html).not.toMatch(/data-boxable/)
  })
  it('a document page still has its comment layer', async () => {
    const doc = withComments({ id: 'dcmt2345', template: 'document', title: 'Plan', summary: 'S', markdown: 'Words.' })
    expect(await page(doc)).toContain('data-comment-layer="anyone"')
  })
  it('the reply, as Reply with your voice sends it, is stored as that reader\'s comment and counts as a response', async () => {
    const recipients = memoryRecipientsStore()
    const rec = withComments(card({ id: 'card2345', links: 'per-reader' }))
    const [ana] = await recipients.add('card2345', [{ label: 'Ana' }])
    const state = createMemoryStateStore()
    const r = createArtifactRoutes(testConfig({ store: memoryArtifactStore([rec]), state, recipients, recipientSecret: () => RS }))
    const value = { anchor: { kind: 'time', block: 'b-card-0123abcd', at: 7 }, body: '', version: 1, audio: 'comments/abcdefghijklmnop1234.webm' }
    const res = await r.STATE_POST(new NextRequest(`${site}/api/artifacts/card2345/state`, { method: 'POST', body: JSON.stringify({ slot: 'comments', op: 'append', value }),
      headers: { 'content-type': 'application/json', cookie: `artifact_r_card2345=${ana.rid}.${ridSig(RS, 'card2345', ana.rid)}` } }), { params: Promise.resolve({ id: 'card2345' }) })
    expect(res.status).toBe(200)
    const entries = (await state.entries('card2345')).filter((e) => e.slot === 'comments')
    expect(entries.map((e) => [e.readerKey, (e.value as { audio?: string }).audio])).toEqual([[`r:${ana.rid}`, 'comments/abcdefghijklmnop1234.webm']])
    const comments = entries.map((e) => ({ readerKey: e.readerKey, at: e.at, text: '' }))
    const [line] = summarizeViews((await recipients.get('card2345'))!, await recipients.views('card2345'), comments, { goal: 'respond' })
    expect(line).toMatchObject({ outcome: 'acted', succeeded: true })
  })
})
