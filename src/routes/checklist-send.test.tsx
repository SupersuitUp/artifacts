import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import type { ArtifactRecord, ArtifactStore } from '../artifacts/store.js'

// A checklist's Send is the state API's `checklist` slot, declared by the fence: the page draws
// the button only where the answer has somewhere to go, the server takes only the ids of that
// checklist, and the owner reads it back through /responses with the publish key.
const t = '2026-10-09T00:00:00Z'
function record(id: string, source: string): ArtifactRecord {
  const p = parseArtifactSource(source)
  if (!p.ok) throw new Error(p.error)
  return { id, title: p.meta.title, summary: p.meta.summary, template: 'document', markdown: p.body, state: p.meta.state, createdAt: t, updatedAt: t, versions: [], views: 0 }
}
const SEND = record('snd23456', '---\ntitle: Prep\nsummary: S\n---\n## Before the call\n\n```checklist\nsend: anyone\n- Update macOS {#update}\n- Install Chrome\n```\n')
const QUIET = record('qet23456', '---\ntitle: Prep\nsummary: S\n---\n```checklist\n- Update macOS {#update}\n```\n')
const RECORDS: Record<string, ArtifactRecord> = { snd23456: SEND, qet23456: QUIET }

function build(withState = true) {
  const store = {
    get: vi.fn(async (id: string) => RECORDS[id] ?? null),
    save: vi.fn(), delete: vi.fn(), bumpViews: vi.fn(async () => {}),
  } as unknown as ArtifactStore
  return createArtifactRoutes({
    store, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k', owner: 'Sam',
    readCookie: async () => undefined, ...(withState ? { state: createMemoryStateStore() } : {}),
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (id: string, body: unknown) => new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
})

describe('a checklist with send', () => {
  it('the page draws Send to the owner only where the host keeps answers and the page declared it', async () => {
    const page = async (r: ReturnType<typeof build>, id: string) => renderToStaticMarkup(await r.Page(params(id)))
    const sending = await page(build(), 'snd23456')
    expect(sending).toContain('data-checklist-item="update"')
    expect(sending).toContain('data-checklist-item="install-chrome"')
    expect(sending).toContain('Send my progress to Sam')
    expect(await page(build(false), 'snd23456')).not.toContain('data-checklist-send')
    const quiet = await page(build(), 'qet23456')
    expect(quiet).toContain('data-checklist-item="update"')
    expect(quiet).not.toContain('data-checklist-send')
  })

  it('takes the ticked ids of that checklist from anyone, refuses anything else, and the owner reads it', async () => {
    const r = build()
    const ok = await r.STATE_POST(post('snd23456', { slot: 'checklist', op: 'set', value: { done: ['install-chrome'] } }), params('snd23456'))
    expect(ok.status).toBe(200)
    const stranger = await r.STATE_POST(post('snd23456', { slot: 'checklist', op: 'set', value: { done: ['not-an-item'] } }), params('snd23456'))
    expect(stranger.status).toBe(400)
    expect((await stranger.json()).error).toBe('a checklist answer names only items on this page')
    const loose = await r.STATE_POST(post('snd23456', { slot: 'checklist', op: 'set', value: 'everything' }), params('snd23456'))
    expect(loose.status).toBe(400)
    // A checklist with no send declares no slot, so nothing can be written to it.
    const none = await r.STATE_POST(post('qet23456', { slot: 'checklist', op: 'set', value: { done: ['update'] } }), params('qet23456'))
    expect(none.status).toBe(404)
    const read = await r.RESPONSES(new NextRequest('https://artifacts.example.com/api/artifacts/snd23456/responses', { headers: { authorization: 'Bearer k' } }), params('snd23456'))
    const rows = (await read.json()).responses as { slot: string; value: unknown }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.map((x) => [x.slot, x.value])).toEqual([['checklist', { done: ['install-chrome'] }]])
  })
})
