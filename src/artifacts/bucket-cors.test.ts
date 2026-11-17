import { describe, it, expect } from 'vitest'
import { ensurePrivateBucketCors, mergePrivateCors, privateBucketCorsRule, ruleCovers, hubOriginsOf } from './bucket-cors.js'

const fakeBucket = (cors?: unknown[]) => {
  const writes: unknown[] = []
  return {
    name: 'tenant-artifacts-private',
    writes,
    getMetadata: async () => [{ cors }] as never,
    setCorsConfiguration: async (rules: unknown) => { writes.push(rules); return [{}] as never },
  }
}

describe('a tenant private bucket CORS rule (supersuit-dev#2519)', () => {
  it('is the same shape the hub setup writes', () => {
    expect(privateBucketCorsRule(['artifacts.example.com'])).toEqual({
      origin: ['https://artifacts.example.com'],
      method: ['GET', 'HEAD', 'PUT'],
      responseHeader: ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'cache-control', 'x-goog-content-length-range'],
      maxAgeSeconds: 3600,
    })
  })

  it('takes bare hosts and full origins, once each', () => {
    expect(hubOriginsOf(['a.example.com', 'https://a.example.com/', 'https://b.example.com'])).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('sets the rule on a bucket that has none', async () => {
    const b = fakeBucket(undefined)
    const r = await ensurePrivateBucketCors(b, ['artifacts.example.com', 'artifacts.example.org'])
    expect(r.changed).toBe(true)
    expect(b.writes).toEqual([[privateBucketCorsRule(['artifacts.example.com', 'artifacts.example.org'])]])
  })

  it('writes nothing when a rule already covers every address', async () => {
    const b = fakeBucket([privateBucketCorsRule(['artifacts.example.com'])])
    const r = await ensurePrivateBucketCors(b, ['artifacts.example.com'])
    expect(r.changed).toBe(false)
    expect(b.writes).toEqual([])
  })

  it('widens a rule that names the hub but lacks PUT, and keeps other rules', async () => {
    const other = { origin: ['https://elsewhere.example'], method: ['GET'], maxAgeSeconds: 60 }
    const b = fakeBucket([other, { origin: ['https://artifacts.example.com'], method: ['GET'], responseHeader: ['Content-Type'] }])
    const r = await ensurePrivateBucketCors(b, ['artifacts.example.com'])
    expect(r.changed).toBe(true)
    const written = b.writes[0] as never[]
    expect(written[0]).toEqual(other)
    expect(ruleCovers(written[1], ['artifacts.example.com'])).toBe(true)
  })

  it('a dry run reports and writes nothing', async () => {
    const b = fakeBucket([])
    const r = await ensurePrivateBucketCors(b, ['artifacts.example.com'], { dryRun: true })
    expect(r.changed).toBe(true)
    expect(b.writes).toEqual([])
  })

  it('refuses an empty address list', async () => {
    await expect(ensurePrivateBucketCors(fakeBucket([]), [])).rejects.toThrow(/no hub address/)
  })

  it('a rule missing a header the browser sends does not count as covering', () => {
    const r = { ...privateBucketCorsRule(['a.example.com']), responseHeader: ['Content-Type'] }
    expect(ruleCovers(r, ['a.example.com'])).toBe(false)
    expect(mergePrivateCors([r], ['a.example.com'])[0].responseHeader).toContain('x-goog-content-length-range')
  })
})
