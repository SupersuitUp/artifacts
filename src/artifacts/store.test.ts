import { describe, it, expect, vi, beforeEach } from 'vitest'

const docs = new Map<string, Record<string, unknown>>()
const fakeDoc = (id: string): Record<string, unknown> => ({
  collection: (name: string) => ({ doc: (vid: string) => fakeDoc(`${id}/${name}/${vid}`) }),
  get: vi.fn(async () => ({ exists: docs.has(id), data: () => docs.get(id), id })),
  set: vi.fn(async (d: Record<string, unknown>) => {
    docs.set(id, d)
  }),
  update: vi.fn(async (d: Record<string, unknown>) => {
    docs.set(id, { ...docs.get(id), ...d })
  }),
  delete: vi.fn(async () => {
    docs.delete(id)
  }),
})
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }), delete: () => undefined } }))

import { newArtifactId, createArtifactStore } from './store.js'

const db = { collection: () => ({ doc: (id: string) => fakeDoc(id) }) } as unknown as import('firebase-admin/firestore').Firestore
const store = createArtifactStore(db)
const saveArtifact = store.save
const getArtifact = store.get
const deleteArtifact = store.delete

const meta = { title: 'T', summary: 'S', template: 'document' as const }

describe('artifact store', () => {
  beforeEach(() => docs.clear())
  it('a password rides through, and a re-publish without one takes the door down', async () => {
    const r = await saveArtifact({ meta: { ...meta, password: 'day ones' }, markdown: 'b' })
    if ('notFound' in r) throw new Error('unexpected')
    expect((await getArtifact(r.id))?.password).toBe('day ones')
    await saveArtifact({ id: r.id, meta, markdown: 'b2' })
    expect((await getArtifact(r.id))?.password).toBeUndefined()
  })
  it('access is sticky: a re-publish without the line keeps the page shut; only `public` opens it', async () => {
    const r = await saveArtifact({ meta: { ...meta, access: 'freedom' }, markdown: 'b' })
    if ('notFound' in r) throw new Error('unexpected')
    expect((await getArtifact(r.id))?.access).toBe('freedom')
    await saveArtifact({ id: r.id, meta, markdown: 'b2' })
    expect((await getArtifact(r.id))?.access).toBe('freedom')
    await saveArtifact({ id: r.id, meta: { ...meta, access: 'public' }, markdown: 'b3' })
    expect((await getArtifact(r.id))?.access).toBeUndefined()
    expect(await store.setAccess!(r.id, 'invite')).toBe(true)
    expect((await getArtifact(r.id))?.access).toBe('invite')
    expect(await store.setAccess!('nosuchid', 'invite')).toBe(false)
  })
  it('ids are 8 chars from the safe alphabet', () => {
    for (let i = 0; i < 50; i++) expect(newArtifactId()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/)
  })
  it('creates on first save with version 1 and no history', async () => {
    const r = await saveArtifact({ meta, markdown: '# a' })
    expect('id' in r && r.version).toBe(1)
    const rec = await getArtifact((r as { id: string }).id)
    expect(rec?.markdown).toBe('# a')
    expect(rec?.version).toBe(1)
    expect(rec?.versions).toBeUndefined()
    expect(rec?.views).toBe(0)
  })
  it('updates in place, appending exactly one version', async () => {
    const first = (await saveArtifact({ meta, markdown: '# a' })) as { id: string }
    const second = await saveArtifact({ id: first.id, meta, markdown: '# b' })
    expect('version' in second && second.version).toBe(2)
    const rec = await getArtifact(first.id)
    expect(rec?.markdown).toBe('# b')
    expect(rec?.version).toBe(2)
    expect(docs.get(`${first.id}/versions/000001`)?.markdown).toBe('# a')
  })
  it('history lives outside the page document, so it never grows with republishes', async () => {
    const first = (await saveArtifact({ meta, markdown: 'x'.repeat(1000) })) as { id: string }
    for (let i = 0; i < 30; i++) await saveArtifact({ id: first.id, meta, markdown: 'x'.repeat(1000) + i })
    const rec = docs.get(first.id)!
    expect(rec.version).toBe(31)
    expect(JSON.stringify(rec).length).toBeLessThan(2000)
    expect(docs.get(`${first.id}/versions/000030`)?.version).toBe(30)
  })
  it('a page still carrying the legacy array has it moved out on the next save', async () => {
    docs.set('legacy01', { id: 'legacy01', title: 'T', summary: 'S', template: 'document', markdown: 'v3',
      createdAt: 'a', updatedAt: 'c', views: 0, versions: [{ markdown: 'v1', at: 'a' }, { markdown: 'v2', at: 'b' }] })
    const r = await saveArtifact({ id: 'legacy01', meta, markdown: 'v4' })
    expect('version' in r && r.version).toBe(4)
    expect(docs.get('legacy01')?.versions).toBeUndefined()
    expect(['000001', '000002', '000003'].map((v) => docs.get(`legacy01/versions/${v}`)?.markdown)).toEqual(['v1', 'v2', 'v3'])
  })
  it('reports notFound when updating an unknown id', async () => {
    expect(await saveArtifact({ id: 'zzzzzzzz', meta, markdown: 'x' })).toEqual({ notFound: true })
  })
  it('deletes', async () => {
    const r = (await saveArtifact({ meta, markdown: 'x' })) as { id: string }
    expect(await deleteArtifact(r.id)).toBe(true)
    expect(await getArtifact(r.id)).toBeNull()
    expect(await deleteArtifact(r.id)).toBe(false)
  })
  it('a state config rides through, and a re-publish without one clears it', async () => {
    const state = { writers: 'anyone' as const, visibility: 'private' as const, slots: { vote: { shape: 'one' as const } } }
    const r = await saveArtifact({ meta: { ...meta, state }, markdown: 'b' })
    if ('notFound' in r) throw new Error('unexpected')
    expect((await getArtifact(r.id))?.state).toEqual(state)
    await saveArtifact({ id: r.id, meta, markdown: 'b2' })
    expect((await getArtifact(r.id))?.state).toBeUndefined()
  })
})
