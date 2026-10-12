import { describe, it, expect } from 'vitest'
import { memoryRecipientsStore, summarizeViews, createRecipientsStore, type RecipientsStore } from './recipients-store.js'

/** The smallest Firestore the store touches: collection().doc().get/set/delete, where().get. */
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof Date)
/** Firestore's merge: nested maps merge key by key, everything else is replaced. */
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v
  return out
}

function fakeDb(onRead?: (path: string) => Promise<void> | void) {
  const data = new Map<string, Record<string, unknown>>()
  const doc = (path: string) => ({
    get: async () => { const copy = structuredClone(data.get(path)); const snap = { exists: data.has(path), data: () => copy }; await onRead?.(path); return snap },
    set: async (v: Record<string, unknown>, o?: { merge?: boolean }) => { data.set(path, o?.merge ? deepMerge(data.get(path) ?? {}, v) : v) },
    create: async (v: Record<string, unknown>) => { if (data.has(path)) throw Object.assign(new Error('exists'), { code: 6 }); data.set(path, v) },
    delete: async () => { data.delete(path) },
  })
  const where = (col: string, field: string, op: string, val: unknown) => ({
    get: async () => ({ docs: [...data.entries()].filter(([p, v]) => p.startsWith(`${col}/`) && (op === '==' ? v[field] === val : String(v[field] ?? '') !== '' && String(v[field]) <= String(val)))
      .map(([p, v]) => ({ id: p.slice(col.length + 1), data: () => v, ref: doc(p) })) }),
  })
  return { data, db: { collection: (col: string) => ({ doc: (id: string) => doc(`${col}/${id}`), where: (f: string, op: string, v: unknown) => where(col, f, op, v) }) } }
}

for (const [name, make] of [['memory', () => memoryRecipientsStore()], ['firestore', () => createRecipientsStore(fakeDb().db as never, 'tenants/t/artifact')]] as const) {
  describe(`recipients store (${name})`, () => {
    let s: RecipientsStore
    it('adds readers with their own rids and labels, and revokes one without touching the others', async () => {
      s = make()
      const [ada, bea] = await s.add('abcd2345', [{ label: 'Reader A', note: 'For Reader A: this one is yours.' }, { label: 'Reader B' }])
      expect(ada.rid).not.toBe(bea.rid)
      expect(await s.revoke('abcd2345', [ada.rid])).toEqual([ada.rid])
      const r = (await s.get('abcd2345'))!
      expect(r.recipients[ada.rid].revokedAt).toBeTruthy()
      expect(r.recipients[bea.rid].revokedAt).toBeUndefined()
      expect(r.recipients[ada.rid].note).toBe('For Reader A: this one is yours.')
    })
    it('revoking everyone shuts every rid', async () => {
      s = make()
      const added = await s.add('abcd2345', [{ label: 'A' }, { label: 'B' }])
      expect((await s.revoke('abcd2345', '*')).sort()).toEqual(added.map((x) => x.rid).sort())
    })
    it('refuses an empty label', async () => {
      s = make()
      await expect(s.add('abcd2345', [{ label: '   ' }])).rejects.toThrow('label')
    })
    it('revoking an already-revoked rid does not re-stamp it', async () => {
      s = make()
      const [a] = await s.add('abcd2345', [{ label: 'Reader A' }])
      await s.revoke('abcd2345', [a.rid])
      const first = (await s.get('abcd2345'))!.recipients[a.rid].revokedAt
      await new Promise((r) => setTimeout(r, 5))
      expect(await s.revoke('abcd2345', [a.rid])).toEqual([])
      expect((await s.get('abcd2345'))!.recipients[a.rid].revokedAt).toBe(first)
    })
    it('a render token is accepted exactly once', async () => {
      s = make()
      expect(await s.useToken('k1', Date.now() + 1000)).toBe(true)
      expect(await s.useToken('k1', Date.now() + 1000)).toBe(false)
    })
    it('views accumulate per session, plays per media, and expiry lists the pages due', async () => {
      s = make()
      await s.add('abcd2345', [{ label: 'A' }])
      const rid = Object.keys((await s.get('abcd2345'))!.recipients)[0]
      await s.recordView({ artifactId: 'abcd2345', rid, session: 's1', device: 'd1', at: '2026-10-11T10:00:00.000Z', addSeconds: 2 })
      await s.recordView({ artifactId: 'abcd2345', rid, session: 's1', device: 'd1', at: '2026-10-11T10:00:15.000Z', addSeconds: 13, play: 'river.mp4' })
      const [v] = await s.views('abcd2345')
      expect(v).toMatchObject({ activeSeconds: 15, plays: { 'river.mp4': 1 }, firstAt: '2026-10-11T10:00:00.000Z' })
      await s.setExpiry('abcd2345', '2026-10-12T00:00:00.000Z')
      expect(await s.expiring('2026-10-13T00:00:00.000Z')).toEqual(['abcd2345'])
      await s.setExpiry('abcd2345', null)
      expect(await s.expiring('2026-10-13T00:00:00.000Z')).toEqual([])
      await s.forget('abcd2345')
      expect(await s.get('abcd2345')).toBeNull()
      expect(await s.views('abcd2345')).toEqual([])
    })
  })
}

describe('recipients store (firestore) under a concurrent Keep', () => {
  it('add and revoke leave a Keep that lands between their read and write alone', async () => {
    let s: RecipientsStore | undefined
    let once: (() => Promise<void>) | undefined
    const { db } = fakeDb(async (path) => { if (path.startsWith('tenants/t/artifactRecipients/') && once) { const f = once; once = undefined; await f() } })
    s = createRecipientsStore(db as never, 'tenants/t/artifact')
    const [a] = await s.add('abcd2345', [{ label: 'A' }])
    await s.setExpiry('abcd2345', '2026-10-12T00:00:00.000Z')
    once = () => s!.setExpiry('abcd2345', null)
    await s.add('abcd2345', [{ label: 'B' }])
    expect((await s.get('abcd2345'))).toMatchObject({ keep: true, expireAt: null })
    once = () => s!.setExpiry('abcd2345', null)
    await s.setExpiry('abcd2345', '2026-10-12T00:00:00.000Z')
    once = () => s!.setExpiry('abcd2345', null)
    await s.revoke('abcd2345', [a.rid])
    const r = (await s.get('abcd2345'))!
    expect(r).toMatchObject({ keep: true, expireAt: null })
    expect(r.recipients[a.rid].revokedAt).toBeTruthy()
    expect(Object.keys(r.recipients)).toHaveLength(2)
  })
  it('a render token is stored with a real Date so a TTL policy can read it', async () => {
    const f = fakeDb()
    await createRecipientsStore(f.db as never, 'tenants/t/artifact').useToken('k1', Date.now() + 1000)
    expect(f.data.get('tenants/t/artifactRecipientTokens/k1')?.expireAt).toBeInstanceOf(Date)
  })
})

describe('summarizeViews', () => {
  const rec = { expireAt: null, keep: false, recipients: {
    aaaaaaaaaaaa: { rid: 'aaaaaaaaaaaa', label: 'Reader A', addedAt: 'x' },
    bbbbbbbbbbbb: { rid: 'bbbbbbbbbbbb', label: 'Example Group', group: true as const, addedAt: 'x' },
    oooooooooooo: { rid: 'oooooooooooo', label: 'Owner', owner: true as const, addedAt: 'x' },
  } }
  const v = (rid: string, session: string, device: string, firstAt: string, secs = 10, plays = {}) =>
    ({ artifactId: 'p', rid, session, device, firstAt, lastAt: firstAt, activeSeconds: secs, plays })
  it('opened, came back the next day, plays, devices and comments, per reader; the owner is never listed', () => {
    const out = summarizeViews(rec, [
      v('aaaaaaaaaaaa', 's1', 'd1', '2026-10-11T10:00:00.000Z', 30, { 'river.mp4': 2 }),
      v('aaaaaaaaaaaa', 's2', 'd2', '2026-10-12T09:00:00.000Z', 5),
      v('bbbbbbbbbbbb', 's3', 'd3', '2026-10-11T11:00:00.000Z'),
      v('bbbbbbbbbbbb', 's4', 'd4', '2026-10-11T11:10:00.000Z'),
      v('oooooooooooo', 's5', 'd5', '2026-10-11T11:10:00.000Z'),
    ], [{ readerKey: 'r:aaaaaaaaaaaa', at: '2026-10-11T10:01:00.000Z', text: 'Wow' }])
    expect(out.map((r) => r.label)).toEqual(['Reader A', 'Example Group'])
    expect(out[0]).toMatchObject({ opened: true, cameBack: true, plays: 2, devices: 2, activeSeconds: 35, firstOpenAt: '2026-10-11T10:00:00.000Z', comments: [{ text: 'Wow' }] })
    expect(out[1]).toMatchObject({ group: true, devices: 2, cameBack: false })
  })
  it('marks a revoked reader as revoked', () => {
    const out = summarizeViews({ ...rec, recipients: { ...rec.recipients, aaaaaaaaaaaa: { ...rec.recipients.aaaaaaaaaaaa, revokedAt: 'y' } } }, [], [])
    expect(out[0]).toMatchObject({ revoked: true, opened: false })
    expect(out[1].revoked).toBe(false)
  })
})
