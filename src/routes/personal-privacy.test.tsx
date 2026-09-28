// THE PROMISE THE WARNING LINE MAKES: a personal note is never readable by the page's publisher.
//
// This test calls EVERY handler createArtifactRoutes returns (it iterates the returned object, so a
// route added next year is covered the day it is added, with no edit here), with the publish key,
// as the owner signed in, and as nobody, across every documented path and query, and asserts that
// a note's distinctive marker appears in no answer. A positive control proves the marker is
// reachable at all, so a harness that silently reached nothing cannot pass.
//
// If this fails, a route leaks personal notes, and the line "They won't see it." is a lie. Fix the
// route; never weaken this test.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { freedomDefault } from '../brand/pack.js'
import type { ArtifactStore, ArtifactRecord } from '../artifacts/store.js'
import type { ReadersStore } from '../artifacts/readers-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { createMemoryPersonalStore } from '../artifacts/personal-store.js'
import { mergeCommentsState } from '../artifacts/comments.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'

const MARKER = 'PERSONAL-NOTE-MARKER-7f3a9c'
const SECRET = 'sekrit'
const ID = 'mkr23456'
const t = '2026-09-28T00:00:00Z'
const merged = mergeCommentsState({ writers: 'anyone', visibility: 'private', slots: { vote: { shape: 'one', visibility: 'tally' } } }, 'anyone', 'readers')
if (!merged.ok) throw new Error(merged.error)
const RECORD: ArtifactRecord = {
  id: ID, title: 'Private notes page', summary: 'S', template: 'document', markdown: '# Heading\n\nThe river runs north.\n\n```notes\n```\n',
  createdAt: t, updatedAt: t, version: 2, views: 0, comments: 'anyone', commentsVisible: 'readers', state: merged.state,
}

const writer: Reader = { uid: 'writer1', email: 'writer@example.com', name: 'Wren Writer', member: true }
const owner: Reader = { uid: 'owner1', email: 'owner@example.com', name: 'Olive Owner', member: true }
const grant = (r: Reader) => mintGrant(SECRET, r)

async function build(readCookieAs: Reader | null) {
  const state = createMemoryStateStore()
  const personal = createMemoryPersonalStore()
  const note = { anchor: { kind: 'text' as const, quote: 'river', prefix: 'The ', suffix: ' runs' }, body: `mine alone ${MARKER}`, version: 2 }
  await personal.add(ID, writer.uid, note)
  // A shared comment and an ordinary answer sit beside it, so every publisher view has content.
  await state.append({ artifactId: ID, slot: 'comments', writer: { key: 'u:owner1', uid: 'owner1', email: owner.email, name: owner.name, anonymous: false }, value: { anchor: note.anchor, body: 'a shared comment', version: 2 } })
  await state.set({ artifactId: ID, slot: 'vote', writer: { key: 'a:anon', name: null, anonymous: true }, value: 'yes' })
  const store: ArtifactStore = {
    get: vi.fn(async (id: string) => (id === ID ? structuredClone(RECORD) : null)),
    save: vi.fn(async () => ({ id: ID, version: 3, created: false })),
    delete: vi.fn(async () => true),
    bumpViews: vi.fn(async () => {}),
    setAccess: vi.fn(async () => true),
    history: vi.fn(async () => [{ version: 2, at: t, current: true as const }, { version: 1, at: t }]),
    version: vi.fn(async (_id: string, n: number) => (n === 1 ? { version: 1, at: t, markdown: '# old' } : null)),
    setNote: vi.fn(async () => true),
  }
  const readers: ReadersStore = {
    allowList: vi.fn(async () => []), allow: vi.fn(async () => []), touchSession: vi.fn(async () => {}), flag: vi.fn(async () => {}),
    sessions: vi.fn(async () => []), flags: vi.fn(async () => []),
    acknowledged: vi.fn(async () => true), acknowledge: vi.fn(async () => {}), acks: vi.fn(async () => []),
  }
  const assets = {
    put: vi.fn(async () => 'https://cdn.example.com/x.png'),
    signUpload: vi.fn(async () => ({ uploadUrl: 'https://cdn.example.com/u', url: 'https://cdn.example.com/x.png' })),
    finishUpload: vi.fn(async () => 'https://cdn.example.com/x.png'),
  }
  return createArtifactRoutes({
    store, state, personal, readers, assets: assets as never, brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'k',
    readerSecret: () => SECRET, signInOrigin: 'https://accounts.example.com', ownerEmail: owner.email,
    readCookie: async (name) => (name === GRANT_COOKIE && readCookieAs ? grant(readCookieAs) : undefined),
  })
}

const PATHS = [
  `/api/artifacts/${ID}`, `/api/artifacts/${ID}/responses`, `/api/artifacts/${ID}/responses?format=csv`,
  `/api/artifacts/${ID}/responses?reader=u:writer1`, `/api/artifacts/${ID}/versions`, `/api/artifacts/${ID}/reads`,
  `/api/artifacts/${ID}/access`, `/api/artifacts/${ID}/state`, `/api/artifacts/${ID}/personal`,
  `/api/artifacts/${ID}/personal?entry=x`, `/api/artifacts/${ID}/assets/x.png`, `/api/artifacts/${ID}/uploads/x.png`,
  `/api/reader/enter?to=/${ID}`, `/api/reader/leave?to=/${ID}`, `/api/reader/track`, `/api/reader/ack`,
  `/${ID}`, `/${ID}/v/1`, `/${ID}/share.png`, '/api/artifacts',
]
const METHODS = ['GET', 'POST', 'PUT', 'DELETE']
const BODIES = [JSON.stringify({ slot: 'comments', op: 'append', value: {} }), JSON.stringify({ version: 1, note: 'x' }), '---\ntitle: T\nsummary: S\n---\nb']
// The publisher, the publisher who is also signed in as the owner, and nobody.
const IDENTITIES: Record<string, Record<string, string>> = {
  publisher: { authorization: 'Bearer k' },
  'publisher signed in as owner': { authorization: 'Bearer k', cookie: `${GRANT_COOKIE}=${grant(owner)}` },
  nobody: {},
}

async function textOf(out: unknown): Promise<string> {
  const v = await out
  if (v instanceof Response) return v.text()
  if (isValidElement(v)) {
    try { return renderToStaticMarkup(v as ReactNode) } catch (e) { return String(e) }
  }
  try { return JSON.stringify(v) ?? '' } catch { return String(v) }
}

/** Call one handler every way a route handler or a page can be called; everything it answered. */
async function everyAnswer(fn: (...a: unknown[]) => unknown, headers: Record<string, string>): Promise<string[]> {
  const ctx = { params: Promise.resolve({ id: ID, n: '1', name: 'x.png' }), searchParams: Promise.resolve({}) }
  const out: string[] = []
  const call = async (...args: unknown[]) => {
    try { out.push(await textOf(fn(...args))) } catch (e) { out.push(String(e)) }
  }
  await call({ ...ctx, params: Promise.resolve({ id: ID, n: '1', name: 'x.png' }) })
  for (const path of PATHS) for (const method of METHODS) for (const body of method === 'GET' ? [undefined] : method === 'POST' ? BODIES : [BODIES[0]]) {
    const req = new NextRequest(`https://artifacts.example.com${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body } : {}) })
    await call(req, { params: Promise.resolve({ id: ID, n: '1', name: 'x.png' }) })
  }
  return out
}

describe('a personal note is never readable by the publisher, through any route', () => {
  it('positive control: the marker IS reachable, by the note\'s own writer through /personal', async () => {
    const routes = await build(null)
    const req = new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}/personal`, { headers: { cookie: `${GRANT_COOKIE}=${grant(writer)}` } })
    expect(await textOf(routes.PERSONAL_GET(req, { params: Promise.resolve({ id: ID }) }))).toContain(MARKER)
  })

  for (const [who, headers] of Object.entries(IDENTITIES)) {
    it(`every handler the factory returns, called as ${who}, never answers with the note`, async () => {
      const routes = await build(who === 'publisher signed in as owner' ? owner : null)
      const handlers = Object.entries(routes).filter(([, v]) => typeof v === 'function') as [string, (...a: unknown[]) => unknown][]
      // The iteration is the point: it must find every route, including the reader's own.
      expect(handlers.length).toBeGreaterThanOrEqual(23)
      expect(handlers.map(([k]) => k)).toEqual(expect.arrayContaining(['RESPONSES', 'STATE_GET', 'PERSONAL_GET', 'Page', 'READS']))
      let answered = 0
      for (const [name, fn] of handlers) {
        for (const text of await everyAnswer(fn, headers)) {
          answered++
          if (text.includes(MARKER)) throw new Error(`${name} answered with a personal note as ${who}`)
        }
      }
      // The publisher views really were read, so the absence above means something.
      expect(answered).toBeGreaterThan(1000)
    }, 60_000)
  }

  it('and /responses, the publisher\'s own view, still carries the shared comment', async () => {
    const routes = await build(null)
    const req = new NextRequest(`https://artifacts.example.com/api/artifacts/${ID}/responses`, { headers: { authorization: 'Bearer k' } })
    const text = await textOf(routes.RESPONSES(req, { params: Promise.resolve({ id: ID }) }))
    expect(text).toContain('a shared comment')
    expect(text).not.toContain(MARKER)
  })
})
