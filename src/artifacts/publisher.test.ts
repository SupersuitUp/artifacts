import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { mintPublisherPass, verifyPublisherPass, PUBLISHER_PASS_TTL_SECONDS, type Publisher } from './publisher.js'
import { mintPass, verifyPass, mintGrant, verifyGrant, type Reader } from './reader.js'
import { isPublisherAuthed, isPublishAuthed } from './auth.js'

const HOST = 'artifacts.example.com'
const sam: Publisher = { uid: 'uid9', email: 'Sam@Example.com', name: 'Sam Rivera', host: HOST }
const reader: Reader = { uid: 'uid9', email: 'sam@example.com', name: 'Sam Rivera', member: true }

describe('the publisher pass', () => {
  it('is the exact shape the minting authority holds (same vector on both sides)', () => {
    const payload = Buffer.from(JSON.stringify({ u: 'uid9', e: 'sam@example.com', n: 'Sam Rivera', h: HOST, x: 1000 })).toString('base64url')
    const oracle = createHmac('sha256', 's').update(`artifact-publisher:p1.${payload}`).digest('hex').slice(0, 32)
    expect(mintPublisherPass('s', sam, 1000)).toBe(`p1.${payload}.${oracle}`)
  })
  it('lasts an hour', () => {
    expect(PUBLISHER_PASS_TTL_SECONDS).toBe(3600)
  })
  it('verifies only for its own host, unexpired, correctly signed', () => {
    const pass = mintPublisherPass('s', sam, 2000)
    expect(verifyPublisherPass('s', pass, HOST, 1999_000)).toEqual({ uid: 'uid9', email: 'sam@example.com', name: 'Sam Rivera', host: HOST })
    expect(verifyPublisherPass('s', pass, 'ARTIFACTS.example.com', 1999_000)?.uid).toBe('uid9')
    expect(verifyPublisherPass('s', pass, 'artifacts.other.example', 1999_000)).toBeNull()
    expect(verifyPublisherPass('s', pass, undefined, 1999_000)).toBeNull()
    expect(verifyPublisherPass('s', pass, HOST, 2001_000)).toBeNull()
    expect(verifyPublisherPass('other', pass, HOST, 1999_000)).toBeNull()
    expect(verifyPublisherPass(undefined, pass, HOST, 1999_000)).toBeNull()
    const [v, , sig] = pass.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'uid9', e: 'sam@example.com', n: null, h: 'evil.example', x: 2000 })).toString('base64url')
    expect(verifyPublisherPass('s', `${v}.${forged}.${sig}`, 'evil.example', 1999_000)).toBeNull()
  })
  it('a reader pass or grant never verifies as a publisher pass, and a publisher pass never as either', () => {
    const a1 = mintPass('s', reader, 2000)
    const g1 = mintGrant('s', reader, 0)
    expect(verifyPublisherPass('s', a1, HOST, 1000_000)).toBeNull()
    expect(verifyPublisherPass('s', g1, HOST, 1000_000)).toBeNull()
    // Same payload under the a1/g1 version prefix but the publisher domain, and vice versa.
    const p1 = mintPublisherPass('s', sam, 2000)
    expect(verifyPass('s', p1, 1000_000)).toBeNull()
    expect(verifyGrant('s', p1, 1000_000)).toBeNull()
    expect(verifyPass('s', p1.replace(/^p1\./, 'a1.'), 1000_000)).toBeNull()
    expect(verifyPublisherPass('s', a1.replace(/^a1\./, 'p1.'), HOST, 1000_000)).toBeNull()
  })
})

describe('isPublisherAuthed', () => {
  const req = (auth?: string) => new Request('https://x/api/artifacts', { headers: auth ? { authorization: auth } : {} })
  const now = 1000_000
  const pass = mintPublisherPass('s', sam, 2000)
  it('the tenant key still works exactly as before, with or without pass config', () => {
    expect(isPublisherAuthed(req('Bearer k'), { publishKey: () => 'k' }, now)).toBe(true)
    expect(isPublisherAuthed(req('Bearer k'), { publishKey: () => 'k', publisherSecret: () => 's', publisherHost: HOST }, now)).toBe(true)
    expect(isPublisherAuthed(req('Bearer nope'), { publishKey: () => 'k' }, now)).toBe(false)
    expect(isPublisherAuthed(req(), { publishKey: () => 'k' }, now)).toBe(false)
    expect(isPublisherAuthed(req('Bearer k'), { publishKey: () => undefined }, now)).toBe(false)
    expect(isPublishAuthed(req('Bearer k'), 'k')).toBe(true)
  })
  it('without publisherSecret or publisherHost, a valid pass is refused', () => {
    expect(isPublisherAuthed(req(`Bearer ${pass}`), { publishKey: () => 'k' }, now)).toBe(false)
    expect(isPublisherAuthed(req(`Bearer ${pass}`), { publishKey: () => 'k', publisherSecret: () => 's' }, now)).toBe(false)
    expect(isPublisherAuthed(req(`Bearer ${pass}`), { publishKey: () => 'k', publisherHost: HOST }, now)).toBe(false)
    expect(isPublisherAuthed(req(`Bearer ${pass}`), { publishKey: () => 'k', publisherSecret: () => undefined, publisherHost: HOST }, now)).toBe(false)
  })
  it('an opted-in host accepts a valid pass for itself, even with no tenant key set', () => {
    expect(isPublisherAuthed(req(`Bearer ${pass}`), { publishKey: () => 'k', publisherSecret: () => 's', publisherHost: HOST }, now)).toBe(true)
    expect(isPublisherAuthed(req(`Bearer ${pass}`), { publishKey: () => undefined, publisherSecret: () => 's', publisherHost: HOST }, now)).toBe(true)
    expect(isPublisherAuthed(req(pass), { publishKey: () => 'k', publisherSecret: () => 's', publisherHost: HOST }, now)).toBe(false)
  })
})
