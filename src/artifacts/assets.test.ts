import { describe, it, expect, vi } from 'vitest'
import { ASSET_NAME, contentTypeFor, createArtifactAssets, hashedName } from './assets.js'

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
})
