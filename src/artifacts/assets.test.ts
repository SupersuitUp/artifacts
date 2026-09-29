import { describe, it, expect, vi } from 'vitest'
import { ASSET_NAME, contentTypeFor, createArtifactAssets, hashedName, storedName } from './assets.js'

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
