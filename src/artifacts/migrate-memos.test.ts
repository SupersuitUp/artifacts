import { describe, it, expect } from 'vitest'
import { migrateMemosToPrivate, MEMO_KEY } from './migrate-memos.js'

function bucket(name: string, keys: string[] = [], opts: { copyFails?: boolean } = {}) {
  const set = new Set(keys)
  const b = {
    name, set,
    file: (key: string) => ({
      name: key,
      exists: async () => [set.has(key)],
      delete: async () => { set.delete(key) },
      copy: async (dest: { name: string; bucket?: unknown }) => { if (!opts.copyFails) (dest as unknown as { _b: typeof set })._b.add(key) },
    }),
    getFiles: async ({ prefix }: { prefix: string }) => [[...set].filter((k) => k.startsWith(prefix)).map((k) => b.file(k))],
  }
  return b
}
// The copy target knows its own bucket's key set, the way a real File knows its Bucket.
function withTargets(priv: ReturnType<typeof bucket>) {
  const file = priv.file
  priv.file = ((key: string) => Object.assign(file(key), { _b: priv.set })) as typeof priv.file
  return priv
}

const P = 'tenants/t/artifacts'
describe('moving readers\' memos out of the public bucket', () => {
  it('knows a memo from page media', () => {
    expect(MEMO_KEY.test('abc23456/comments/Zq3x.webm')).toBe(true)
    expect(MEMO_KEY.test('abc23456/personal/dir123/Zq3x.m4a')).toBe(true)
    expect(MEMO_KEY.test('abc23456/narration.0123abcd.mp3')).toBe(false)
    expect(MEMO_KEY.test('abc23456/private/x.0123abcd.png')).toBe(false)
  })

  it('copies each memo to the same key in the private bucket, then deletes the public one; page media stays', async () => {
    const pub = bucket('public-example', [`${P}/abc23456/comments/a.webm`, `${P}/abc23456/personal/d1/b.m4a`, `${P}/abc23456/cover.0123abcd.webp`])
    const priv = withTargets(bucket('private-example'))
    const r = await migrateMemosToPrivate(pub as never, priv as never, P)
    expect(r.moved.sort()).toEqual([`${P}/abc23456/comments/a.webm`, `${P}/abc23456/personal/d1/b.m4a`])
    expect([...priv.set].sort()).toEqual(r.moved.sort())
    expect([...pub.set]).toEqual([`${P}/abc23456/cover.0123abcd.webp`])
    // Again: nothing left to move.
    expect((await migrateMemosToPrivate(pub as never, priv as never, P)).moved).toEqual([])
  })

  it('never deletes a public memo whose copy did not arrive', async () => {
    const pub = bucket('public-example', [`${P}/abc23456/comments/a.webm`], { copyFails: true })
    const priv = withTargets(bucket('private-example'))
    const r = await migrateMemosToPrivate(pub as never, priv as never, P)
    expect(r.failed.map((f) => f.key)).toEqual([`${P}/abc23456/comments/a.webm`])
    expect(pub.set.has(`${P}/abc23456/comments/a.webm`)).toBe(true)
  })

  it('a dry run changes nothing', async () => {
    const pub = bucket('public-example', [`${P}/abc23456/comments/a.webm`])
    const priv = withTargets(bucket('private-example'))
    const r = await migrateMemosToPrivate(pub as never, priv as never, P, { dryRun: true })
    expect(r.moved).toEqual([`${P}/abc23456/comments/a.webm`])
    expect(pub.set.size).toBe(1)
    expect(priv.set.size).toBe(0)
  })

  it('refuses the same bucket twice', async () => {
    const pub = bucket('same')
    await expect(migrateMemosToPrivate(pub as never, bucket('same') as never, P)).rejects.toThrow(/different bucket/)
  })
})
