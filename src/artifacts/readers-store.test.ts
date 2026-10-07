import { describe, it, expect } from 'vitest'
import { summarize, type SessionDoc, type FlagDoc } from './readers-store.js'

const s = (o: Partial<SessionDoc>): SessionDoc => ({
  artifactId: 'a', session: 'x', email: 'm@example.com', name: 'M', member: true,
  startedAt: '2026-09-24T10:00:00Z', lastAt: '2026-09-24T10:05:00Z', activeSeconds: 100, maxScroll: 40, ...o,
})
describe('summarize', () => {
  it('totals time across sessions, keeps the deepest scroll, and files flags under the reader', () => {
    const flags: FlagDoc[] = [
      { artifactId: 'a', email: 'm@example.com', name: 'M', kind: 'print', at: '2026-09-24T10:02:00Z' },
      { artifactId: 'a', email: 'f@example.com', name: 'F', kind: 'refused', at: '2026-09-24T11:00:00Z' },
      { artifactId: 'a', email: 'f@example.com', name: 'F', kind: 'refused', at: '2026-09-24T12:00:00Z' },
    ]
    const r = summarize([s({ session: '1' }), s({ session: '2', activeSeconds: 50, maxScroll: 90, lastAt: '2026-09-25T09:00:00Z' })], flags)
    expect(r.readers).toHaveLength(1)
    expect(r.readers[0]).toMatchObject({ sessions: 2, activeSeconds: 150, maxScroll: 90, lastSeen: '2026-09-25T09:00:00Z' })
    expect(r.readers[0].flags).toEqual([{ kind: 'print', at: '2026-09-24T10:02:00Z' }])
    expect(r.refused).toEqual([{ email: 'f@example.com', name: 'F', attempts: 2, lastAt: '2026-09-24T12:00:00Z' }])
  })
})

describe('allow', () => {
  it('never writes an empty readers map over an existing list', async () => {
    const { createReadersStore } = await import('./readers-store.js')
    const calls: { op: string; data: unknown; opts?: unknown }[] = []
    let exists = true
    const ref = {
      get: async () => ({ exists, data: () => ({ readers: {} }) }),
      set: async (data: unknown, opts?: unknown) => { calls.push({ op: 'set', data, opts }); exists = true },
      update: async (data: unknown) => { calls.push({ op: 'update', data }) },
    }
    const db = { collection: () => ({ doc: () => ref }) } as unknown as import('firebase-admin/firestore').Firestore
    const store = createReadersStore(db, 'tenants/t/artifact')
    await store.allow('abc23456', [{ email: 'b@example.com' }], [])
    expect(calls.map((c) => c.op)).toEqual(['update'])
    exists = false
    calls.length = 0
    await store.allow('abc23456', [{ email: 'c@example.com' }], [])
    expect(calls.map((c) => c.op)).toEqual(['set', 'update'])
    expect(calls[0].opts).toBeUndefined()
  })
})

describe('listed', () => {
  it('returns every page with a non-empty list, from the Access collection under the base', async () => {
    const { createReadersStore } = await import('./readers-store.js')
    const seen: string[] = []
    const docs = [
      { id: 'abc23456', data: () => ({ readers: { 'b@example,com': { email: 'b@example.com', addedAt: '2026-10-01T00:00:00Z' } } }) },
      { id: 'def23456', data: () => ({ readers: {} }) },
    ]
    const db = { collection: (path: string) => { seen.push(path); return { get: async () => ({ docs }) } } } as unknown as import('firebase-admin/firestore').Firestore
    const out = await createReadersStore(db, 'tenants/t/artifact').listed!()
    expect(seen).toContain('tenants/t/artifactAccess')
    expect(out).toEqual([{ artifactId: 'abc23456', readers: [{ email: 'b@example.com', addedAt: '2026-10-01T00:00:00Z' }] }])
  })
})
