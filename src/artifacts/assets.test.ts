import { describe, it, expect, vi } from 'vitest'
import { PRIVATE_REF, PRIVATE_READ_TTL_MS, ASSET_NAME, contentTypeFor, createArtifactAssets, hashedName, storedName } from './assets.js'

describe('artifact assets', () => {
  it('accepts sane names and refuses paths', () => {
    expect(ASSET_NAME.test('cover.webp')).toBe(true)
    expect(ASSET_NAME.test('narration-1789.mp3')).toBe(true)
    expect(ASSET_NAME.test('../x.png')).toBe(false)
    expect(ASSET_NAME.test('a/b.png')).toBe(false)
    expect(ASSET_NAME.test('.hidden')).toBe(false)
  })
  it('maps extensions to content types and refuses unknown ones', () => {
    expect(contentTypeFor('a.webp')).toBe('image/webp')
    expect(contentTypeFor('n.mp3')).toBe('audio/mpeg')
    expect(contentTypeFor('d.mp4')).toBe('video/mp4')
    expect(contentTypeFor('x.exe')).toBeUndefined()
  })
  // `immutable` with a stable filename is the defect this replaces: a reader who loaded a page
  // once kept that version for a year while republishing silently overwrote the object, and every
  // check from the publisher's machine reported the host correct, because it was.
  it('puts a hash of the bytes in the stored name, so changed bytes get a new url', () => {
    const one = hashedName('21-the-fork.png', Buffer.from('first render'))
    const two = hashedName('21-the-fork.png', Buffer.from('second render'))
    expect(one).toMatch(/^21-the-fork\.[0-9a-f]{8}\.png$/)
    expect(two).not.toBe(one)
    expect(hashedName('21-the-fork.png', Buffer.from('first render'))).toBe(one)
  })
  it('handles a name with no extension rather than corrupting it', () => {
    expect(hashedName('narration', Buffer.from('x'))).toMatch(/^narration\.[0-9a-f]{8}$/)
  })
  it('writes under prefix/id/name and returns the public url', async () => {
    const save = vi.fn(async () => {})
    const makePublic = vi.fn(async () => {})
    const bucket = { name: 'b', file: vi.fn(() => ({ save, makePublic })) } as unknown as import('@google-cloud/storage').Bucket
    const assets = createArtifactAssets(bucket, '/tenants/t/artifacts/')
    const url = await assets.put('abc23456', 'cover.webp', Buffer.from('x'), 'image/webp')
    const stored = hashedName('cover.webp', Buffer.from('x'))
    expect(url).toBe(`https://storage.googleapis.com/b/tenants/t/artifacts/abc23456/${stored}`)
    expect((bucket.file as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(`tenants/t/artifacts/abc23456/${stored}`)
    expect(save).toHaveBeenCalled()
  })
  // A route handler cannot take a body over 4.5 MB on Vercel, so an hour of narration (~55 MB)
  // died with FUNCTION_PAYLOAD_TOO_LARGE. Big files go straight to the bucket on a signed URL.
  it('signs a direct upload to the same hashed key put() would use, with the same cache header', async () => {
    const getSignedUrl = vi.fn(async () => ['https://signed.example/put'])
    const bucket = { name: 'b', file: vi.fn(() => ({ getSignedUrl })) } as unknown as import('@google-cloud/storage').Bucket
    const assets = createArtifactAssets(bucket, 'tenants/t/artifacts')
    const digest = hashedName('n.mp3', Buffer.from('audio')).split('.')[1]
    const out = await assets.signUpload!('abc23456', 'n.mp3', digest, 'audio/mpeg')
    expect(out.uploadUrl).toBe('https://signed.example/put')
    expect(out.url).toBe(`https://storage.googleapis.com/b/tenants/t/artifacts/abc23456/${hashedName('n.mp3', Buffer.from('audio'))}`)
    expect(out.headers['content-type']).toBe('audio/mpeg')
    expect(out.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const opts = (getSignedUrl.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(opts.action).toBe('write')
    expect(opts.version).toBe('v4')
    expect(opts.contentType).toBe('audio/mpeg')
  })
  it('finishes an upload only when the object arrived', async () => {
    const makePublic = vi.fn(async () => {})
    let there = true
    const exists = vi.fn(async () => [there])
    const bucket = { name: 'b', file: vi.fn(() => ({ exists, makePublic })) } as unknown as import('@google-cloud/storage').Bucket
    const assets = createArtifactAssets(bucket, 'p')
    expect(await assets.finishUpload!('abc23456', 'n.mp3', 'deadbeef')).toBe('https://storage.googleapis.com/b/p/abc23456/n.deadbeef.mp3')
    expect(makePublic).toHaveBeenCalled()
    there = false
    expect(await assets.finishUpload!('abc23456', 'n.mp3', 'deadbeef')).toBeNull()
  })
  it('storedName is what hashedName produces', () => {
    expect(storedName('a.png', '0123abcd')).toBe('a.0123abcd.png')
    expect(storedName('narration', '0123abcd')).toBe('narration.0123abcd')
  })

  it('reader recordings sign a capped upload, are never made public, and play through a signed read', async () => {
    const getSignedUrl = vi.fn(async (o: { action: string }) => [`https://signed.example.com/${o.action}`])
    const makePublic = vi.fn(async () => {})
    const exists = vi.fn(async () => [true])
    const getMetadata = vi.fn(async () => [{ size: '1234' }])
    const download = vi.fn(async () => [Buffer.from('audio')])
    const file = vi.fn(() => ({ getSignedUrl, makePublic, exists, getMetadata, download }))
    const bucket = { name: 'b', file } as unknown as import('@google-cloud/storage').Bucket
    const assets = createArtifactAssets(bucket, 'tenants/t/artifacts')
    const up = await assets.signAudioUpload!('abc23456', 'comments/Zq3xY7abcDEF12345.m4a', 'audio/mp4')
    expect(file.mock.calls[0]).toEqual(['tenants/t/artifacts/abc23456/comments/Zq3xY7abcDEF12345.m4a'])
    expect(up.headers['content-type']).toBe('audio/mp4')
    expect(up.headers['x-goog-content-length-range']).toBe('0,4194304')
    const signed = getSignedUrl.mock.calls[0][0] as unknown as { action: string; contentType: string; extensionHeaders: Record<string, string> }
    expect(signed.action).toBe('write')
    expect(signed.contentType).toBe('audio/mp4')
    expect(signed.extensionHeaders['x-goog-content-length-range']).toBe('0,4194304')
    expect(await assets.audioSize!('abc23456', 'comments/Zq3xY7abcDEF12345.m4a')).toBe(1234)
    expect((await assets.readAudio!('abc23456', 'comments/Zq3xY7abcDEF12345.m4a'))!.toString()).toBe('audio')
    expect(await assets.audioUrl!('abc23456', 'comments/Zq3xY7abcDEF12345.m4a')).toBe('https://signed.example.com/read')
    expect(makePublic).not.toHaveBeenCalled()
    exists.mockResolvedValueOnce([false]).mockResolvedValueOnce([false])
    expect(await assets.audioSize!('abc23456', 'comments/none.webm')).toBeNull()
    expect(await assets.readAudio!('abc23456', 'comments/none.webm')).toBeNull()
  })
})

function fakeBucket(name = 'bucket-example') {
  const calls: { op: string; key: string; action?: string; expiresIn?: number }[] = []
  const keys = new Set<string>()
  const bucket = {
    name,
    file: (key: string) => ({
      save: async () => { calls.push({ op: 'save', key }); keys.add(key) },
      makePublic: async () => { calls.push({ op: 'makePublic', key }) },
      exists: async () => [keys.has(key)],
      getSignedUrl: async (o: { action: string; expires: number }) => { calls.push({ op: 'getSignedUrl', key, action: o.action, expiresIn: o.expires - Date.now() }); return [`https://storage.example.com/${key}?signed=1`] },
    }),
    getFiles: async ({ prefix }: { prefix: string }) => [[...keys].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k, delete: async () => { keys.delete(k) } }))],
  }
  return { bucket, calls }
}

describe('private media', () => {
  // The public bucket can carry a bucket-wide public read grant, so "never made public" means
  // nothing there: private media lives in its own bucket, and with no such bucket there is none.
  const both = () => {
    const pub = fakeBucket('public-example')
    const priv = fakeBucket('private-example')
    const a = createArtifactAssets(pub.bucket as never, 'artifacts', { privateBucket: priv.bucket as never })
    return { pub, priv, a }
  }
  it('without a private bucket there are no private methods, so private media cannot land in the public bucket', () => {
    const { bucket } = fakeBucket()
    const a = createArtifactAssets(bucket as never, 'artifacts')
    expect(a.putPrivate).toBeUndefined()
    expect(a.signPrivateUpload).toBeUndefined()
    expect(a.finishPrivateUpload).toBeUndefined()
    expect(a.privateUrl).toBeUndefined()
    expect(typeof a.deletePage).toBe('function')
  })
  it('refuses the public bucket passed again as the private one', () => {
    const { bucket } = fakeBucket('same-example')
    const again = fakeBucket('same-example').bucket
    expect(() => createArtifactAssets(bucket as never, 'artifacts', { privateBucket: again as never })).toThrow(/private bucket/)
  })
  it('putPrivate writes to the private bucket under private/, never the public one, never public, and answers a private: ref', async () => {
    const { pub, priv, a } = both()
    const ref = await a.putPrivate!('abcd2345', 'river.mp4', Buffer.from('v'), 'video/mp4')
    expect(ref).toMatch(/^private:river\.[0-9a-f]{8}\.mp4$/)
    expect(PRIVATE_REF.test(ref)).toBe(true)
    expect(priv.calls.some((c) => c.op === 'save' && c.key.startsWith('artifacts/abcd2345/private/'))).toBe(true)
    expect(pub.calls).toHaveLength(0)
    expect(priv.calls.some((c) => c.op === 'makePublic')).toBe(false)
  })
  it('public assets stay on the public bucket when a private one is configured', async () => {
    const { pub, priv, a } = both()
    const url = await a.put('abcd2345', 'cover.webp', Buffer.from('c'), 'image/webp')
    expect(url).toContain('https://storage.googleapis.com/public-example/artifacts/abcd2345/')
    expect(pub.calls.some((c) => c.op === 'save')).toBe(true)
    expect(priv.calls).toHaveLength(0)
  })
  it('signs a private upload to the private bucket and finishes only when it arrived there, never public', async () => {
    const { pub, priv, a } = both()
    const out = await a.signPrivateUpload!('abcd2345', 'river.mp4', '0123abcd', 'video/mp4')
    expect(out.url).toBe('private:river.0123abcd.mp4')
    expect(priv.calls.find((c) => c.op === 'getSignedUrl')!.key).toBe('artifacts/abcd2345/private/river.0123abcd.mp4')
    expect(await a.finishPrivateUpload!('abcd2345', 'river.mp4', '0123abcd')).toBeNull()
    await pub.bucket.file('artifacts/abcd2345/private/river.0123abcd.mp4').save()
    expect(await a.finishPrivateUpload!('abcd2345', 'river.mp4', '0123abcd')).toBeNull()
    await priv.bucket.file('artifacts/abcd2345/private/river.0123abcd.mp4').save()
    expect(await a.finishPrivateUpload!('abcd2345', 'river.mp4', '0123abcd')).toBe('private:river.0123abcd.mp4')
    expect(priv.calls.some((c) => c.op === 'makePublic')).toBe(false)
  })
  it('privateUrl signs a V4 read on the private bucket for PRIVATE_READ_TTL_MS (one hour), fresh on every call, and refuses a path-shaped name', async () => {
    expect(PRIVATE_READ_TTL_MS).toBe(60 * 60 * 1000)
    const { pub, priv, a } = both()
    const ref = await a.putPrivate!('abcd2345', 'note.m4a', Buffer.from('a'), 'audio/mp4')
    const url = await a.privateUrl!('abcd2345', ref.slice('private:'.length))
    expect(url).toContain('signed')
    await a.privateUrl!('abcd2345', ref.slice('private:'.length))
    const reads = priv.calls.filter((c) => c.op === 'getSignedUrl')
    expect(reads).toHaveLength(2)
    expect(reads[0].action).toBe('read')
    expect(reads[0].key).toBe(`artifacts/abcd2345/private/${ref.slice('private:'.length)}`)
    expect(reads[0].expiresIn).toBeLessThanOrEqual(PRIVATE_READ_TTL_MS)
    expect(reads[0].expiresIn).toBeGreaterThan(PRIVATE_READ_TTL_MS - 5_000)
    expect(pub.calls.filter((c) => c.op === 'getSignedUrl')).toHaveLength(0)
    await expect(a.privateUrl!('abcd2345', '../x')).rejects.toThrow()
  })
  it('deletePage removes the page from both buckets, leaves a sibling page alone, and refuses a bad id', async () => {
    const { pub, priv, a } = both()
    await a.putPrivate!('abcd2345', 'one.mp4', Buffer.from('1'), 'video/mp4')
    await a.put('abcd2345', 'cover.webp', Buffer.from('c'), 'image/webp')
    await a.putPrivate!('efgh2345', 'two.mp4', Buffer.from('2'), 'video/mp4')
    expect(await a.deletePage!('abcd2345')).toBe(2)
    expect((await pub.bucket.getFiles({ prefix: 'artifacts/abcd2345/' }))[0]).toHaveLength(0)
    expect((await priv.bucket.getFiles({ prefix: 'artifacts/abcd2345/' }))[0]).toHaveLength(0)
    expect((await priv.bucket.getFiles({ prefix: 'artifacts/efgh2345/' }))[0]).toHaveLength(1)
    for (const bad of ['', '..', 'abcd2345/../x', 'ABCD2345', 'abc']) await expect(a.deletePage!(bad)).rejects.toThrow()
    expect((await priv.bucket.getFiles({ prefix: 'artifacts/' }))[0]).toHaveLength(1)
  })
  it('deletePage with no private bucket still removes the public files', async () => {
    const { bucket } = fakeBucket()
    const a = createArtifactAssets(bucket as never, 'artifacts')
    await a.put('abcd2345', 'cover.webp', Buffer.from('c'), 'image/webp')
    expect(await a.deletePage!('abcd2345')).toBe(1)
  })
})
