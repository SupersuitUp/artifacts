import { describe, it, expect, vi, beforeEach } from 'vitest'

const docs = new Map<string, Record<string, unknown>>()
// A subcollection lists the docs stored under `<id>/<name>/`, like Firestore's; `select` narrows
// the fields, which is how a history listing avoids loading every past body.
const listing = (prefix: string, fields?: string[]) => ({
  get: vi.fn(async () => ({
    docs: [...docs.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(([k, d]) => ({ id: k.slice(prefix.length), data: () => (fields ? Object.fromEntries(fields.filter((f) => f in d).map((f) => [f, d[f]])) : d) })),
  })),
})
const fakeDoc = (id: string): Record<string, unknown> => ({
  collection: (name: string) => ({
    doc: (vid: string) => fakeDoc(`${id}/${name}/${vid}`),
    select: (...fields: string[]) => listing(`${id}/${name}/`, fields),
    ...listing(`${id}/${name}/`),
  }),
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
  it('a theme and a toc ride through, including toc: false, and a re-publish without them clears both', async () => {
    const r = await saveArtifact({ meta: { ...meta, theme: 'light', toc: false }, markdown: 'b' })
    if ('notFound' in r) throw new Error('unexpected')
    const got = await getArtifact(r.id)
    expect(got?.theme).toBe('light')
    expect(got?.toc).toBe(false)
    await saveArtifact({ id: r.id, meta, markdown: 'b2' })
    const after = await getArtifact(r.id)
    expect(after?.theme).toBeUndefined()
    expect(after?.toc).toBeUndefined()
  })
  it('definitions ride through, and a re-publish without them clears them', async () => {
    const definitions = [{ term: 'Toil', text: 'Work a machine could do.', href: 'https://example.com/toil' }]
    const r = await saveArtifact({ meta: { ...meta, definitions }, markdown: 'b' })
    if ('notFound' in r) throw new Error('unexpected')
    expect((await getArtifact(r.id))?.definitions).toEqual(definitions)
    await saveArtifact({ id: r.id, meta, markdown: 'b2' })
    expect((await getArtifact(r.id))?.definitions).toBeUndefined()
  })

})

describe('version history', () => {
  beforeEach(() => docs.clear())
  const pub = async (markdown: string, extra: { id?: string; note?: string; amend?: boolean } = {}) => {
    const r = await saveArtifact({ meta, markdown, ...extra })
    if ('notFound' in r) throw new Error('unexpected')
    return r
  }
  it('a change note rides with its version and moves into history when superseded', async () => {
    const { id } = await pub('v1', { note: 'First draft' })
    expect((await getArtifact(id))?.note).toBe('First draft')
    await pub('v2', { id, note: 'Tightened the opening' })
    expect((await getArtifact(id))?.note).toBe('Tightened the opening')
    expect(docs.get(`${id}/versions/000001`)?.note).toBe('First draft')
  })
  it('a publish with no note records the version with no note, never an invented one', async () => {
    const { id } = await pub('v1', { note: 'First draft' })
    await pub('v2', { id })
    const rec = await getArtifact(id)
    expect(rec?.version).toBe(2)
    expect(rec?.note).toBeUndefined()
  })
  it('a note repeated from the version it replaces is a stale line left in the file, and is dropped', async () => {
    const { id } = await pub('v1', { note: 'Added the pricing section' })
    await pub('v2', { id, note: 'Added the pricing section' })
    expect((await getArtifact(id))?.note).toBeUndefined()
  })
  it('the same body again with no note is not a new version', async () => {
    const { id } = await pub('same')
    const r = await pub('same', { id })
    expect(r.version).toBe(1)
    expect(docs.get(`${id}/versions/000001`)).toBeUndefined()
  })
  it('an amend finishes the same publish: the body changes, the version and its note do not', async () => {
    const { id } = await pub('![a](./local.png)', { note: 'New chart' })
    const r = await pub('![a](https://cdn.example.com/a.png)', { id, amend: true })
    expect(r.version).toBe(1)
    const rec = await getArtifact(id)
    expect(rec?.markdown).toBe('![a](https://cdn.example.com/a.png)')
    expect(rec?.note).toBe('New chart')
    expect(docs.get(`${id}/versions/000001`)).toBeUndefined()
  })
  it('history lists every version newest first, current included, without any body', async () => {
    const { id } = await pub('v1', { note: 'one' })
    await pub('v2', { id })
    await pub('v3', { id, note: 'three' })
    const h = await store.history!(id)
    expect(h?.map((v) => [v.version, v.note ?? null, v.current ?? false])).toEqual([[3, 'three', true], [2, null, false], [1, 'one', false]])
    for (const v of h!) expect(v).not.toHaveProperty('markdown')
    expect(h!.every((v) => typeof v.at === 'string' && v.at.length > 0)).toBe(true)
    expect(await store.history!('nosuchid')).toBeNull()
  })
  it('one version by number: a past one from history, the current one from the page, a missing one is null', async () => {
    const { id } = await pub('v1', { note: 'one' })
    await pub('v2', { id })
    expect(await store.version!(id, 1)).toMatchObject({ version: 1, markdown: 'v1', note: 'one', title: 'T' })
    expect(await store.version!(id, 2)).toMatchObject({ version: 2, markdown: 'v2', current: true })
    expect(await store.version!(id, 3)).toBeNull()
    expect(await store.version!(id, 0)).toBeNull()
    expect(await store.version!('nosuchid', 1)).toBeNull()
  })
  it('a page still carrying the legacy array lists and serves its history from it', async () => {
    docs.set('legacy02', { id: 'legacy02', title: 'T', summary: 'S', template: 'document', markdown: 'v3',
      createdAt: 'a', updatedAt: 'c', views: 0, versions: [{ markdown: 'v1', at: 'a' }, { markdown: 'v2', at: 'b' }] })
    expect((await store.history!('legacy02'))?.map((v) => v.version)).toEqual([3, 2, 1])
    expect(await store.version!('legacy02', 2)).toMatchObject({ version: 2, markdown: 'v2', at: 'b' })
  })
  it('a note can be written onto any version after the fact, and cleared', async () => {
    const { id } = await pub('v1')
    await pub('v2', { id })
    expect(await store.setNote!(id, 1, 'Backfilled')).toBe(true)
    expect(docs.get(`${id}/versions/000001`)?.note).toBe('Backfilled')
    expect(await store.setNote!(id, 2, 'Current')).toBe(true)
    expect((await getArtifact(id))?.note).toBe('Current')
    expect(await store.setNote!(id, 2, null)).toBe(true)
    expect((await getArtifact(id))?.note).toBeUndefined()
    expect(await store.setNote!(id, 9, 'x')).toBe(false)
    expect(await store.setNote!('nosuchid', 1, 'x')).toBe(false)
  })

  it('comments and their visibility ride through, and a re-publish without them goes back to off and owner', async () => {
    const r = await saveArtifact({ meta: { ...meta, comments: 'anyone', commentsVisible: 'readers' }, markdown: 'b' })
    if ('notFound' in r) throw new Error('unexpected')
    const got = await getArtifact(r.id)
    expect(got?.comments).toBe('anyone')
    expect(got?.commentsVisible).toBe('readers')
    await saveArtifact({ id: r.id, meta, markdown: 'b2' })
    const after = await getArtifact(r.id)
    expect(after?.comments).toBeUndefined()
    expect(after?.commentsVisible).toBeUndefined()
  })
})

