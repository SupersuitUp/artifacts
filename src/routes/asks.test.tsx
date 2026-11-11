// An answer to an ask is a reader record in the `asks` slot, checked against the page's own asks.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { mergeAsksState, type AskData } from '../artifacts/asks.js'
import { FEEDBACK_CLOSED, NAME_NEEDED } from '../artifacts/comments.js'

const RS = 'r'.repeat(40)
const t = '2026-11-11T00:00:00Z'
const ASK: AskData = { id: 'headline', type: 'pick-one', question: 'Which headline?', hash: '0123456789ab',
  options: [{ label: 'Your own AI', because: 'Says what is different.', recommended: true }, { label: 'Stop the toil', because: 'Names the pain.', recommended: false }] }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (id: string, body: unknown, cookie?: string) =>
  new NextRequest(`https://artifacts.example.com/api/artifacts/${id}/state`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
  })
const answer = (value: Record<string, unknown>) => ({ slot: 'asks', op: 'append', value })
const good = { ask: 'headline', hash: ASK.hash, choice: 'Your own AI', words: null }

function build(extra: Partial<ArtifactRecord> = {}) {
  const merged = mergeAsksState(undefined, [ASK])
  if (!merged.ok) throw new Error(merged.error)
  const rec = { id: 'ask23456', title: 'Draft', summary: 'S', template: 'document', markdown: '```askcard\nheadline\n```', createdAt: t, updatedAt: t, version: 1, views: 0, links: 'per-reader', asks: [ASK], state: merged.state, ...extra } as ArtifactRecord
  const state = createMemoryStateStore()
  const recipients = memoryRecipientsStore()
  const store = { get: vi.fn(async (id: string) => (id === rec.id ? rec : null)) } as unknown as ArtifactStore
  const routes = createArtifactRoutes({
    store, state, recipients, recipientSecret: () => RS, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k', readerSecret: () => 's'.repeat(40),
  })
  const cookie = (r: { rid: string }) => `artifact_r_${rec.id}=${r.rid}.${ridSig(RS, rec.id, r.rid)}`
  return { routes, state, recipients, cookie }
}

describe('POST /state to the asks slot', () => {
  it('1. a named reader\'s answer is 201-style success, and a second answer appends', async () => {
    const { routes, state, recipients, cookie } = build()
    const [ada] = await recipients.add('ask23456', [{ label: 'Reader A' }])
    const first = await routes.STATE_POST(post('ask23456', answer(good), cookie(ada)), params('ask23456'))
    expect(first.status).toBeLessThan(300)
    const second = await routes.STATE_POST(post('ask23456', answer({ ...good, choice: 'Stop the toil' }), cookie(ada)), params('ask23456'))
    expect(second.status).toBeLessThan(300)
    expect((await state.entries('ask23456')).filter((e) => e.slot === 'asks')).toHaveLength(2)
  })
  it('2. an unknown ask, an old hash or an unknown option is 400 in the checker\'s words', async () => {
    const { routes, recipients, cookie } = build()
    const [ada] = await recipients.add('ask23456', [{ label: 'Reader A' }])
    const c = cookie(ada)
    const bad = async (v: Record<string, unknown>) => {
      const res = await routes.STATE_POST(post('ask23456', answer(v), c), params('ask23456'))
      return { status: res.status, error: ((await res.json()) as { error: string }).error }
    }
    expect(await bad({ ...good, ask: 'nope' })).toMatchObject({ status: 400, error: expect.stringMatching(/no ask/) })
    expect(await bad({ ...good, hash: 'aaaaaaaaaaaa' })).toMatchObject({ status: 400, error: expect.stringMatching(/changed/) })
    expect(await bad({ ...good, choice: 'Made up' })).toMatchObject({ status: 400, error: expect.stringMatching(/not one of/) })
  })
  it('3. after the reader\'s window closes an answer is 403 FEEDBACK_CLOSED with closed: true', async () => {
    const { routes, recipients, cookie } = build()
    const [ada] = await recipients.add('ask23456', [{ label: 'Reader A', closesAt: '2020-01-01T00:00:00.000Z' }])
    const res = await routes.STATE_POST(post('ask23456', answer(good), cookie(ada)), params('ask23456'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: FEEDBACK_CLOSED, closed: true })
  })
  it('4. through a group link on a comment_name: required page, an answer with no name is 400 NAME_NEEDED', async () => {
    const { routes, recipients, cookie } = build({ commentName: 'required' })
    const [link] = await recipients.add('ask23456', [{ label: 'Anyone with the link', group: true }])
    const c = cookie(link)
    const none = await routes.STATE_POST(post('ask23456', answer(good), c), params('ask23456'))
    expect(none.status).toBe(400)
    expect(await none.json()).toEqual({ error: NAME_NEEDED })
    const named = await routes.STATE_POST(post('ask23456', answer({ ...good, name: 'Kit' }), c), params('ask23456'))
    expect(named.status).toBeLessThan(300)
  })
})
