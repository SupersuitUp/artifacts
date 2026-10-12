// src/artifacts/recipients.test.ts
import { describe, it, expect } from 'vitest'
import { RID_RE, newRid, ridSig, ridLink, parseRidParam, verifyRid, mintRenderToken, verifyRenderToken, beatKey, isUnfurlAgent } from './recipients.js'

const S = 'k'.repeat(40)

describe('per-reader links', () => {
  it('a rid is 12 lowercase letters and digits, and two are never the same', () => {
    const a = newRid(), b = newRid()
    expect(a).toMatch(RID_RE)
    expect(a).not.toBe(b)
  })
  it('a link verifies for its own page only', () => {
    const url = ridLink('https://artifacts.example.com/abcd2345', 'abcd2345', 'r0r0r0r0r0r0', S)
    const p = parseRidParam(new URL(url).searchParams.get('r'))!
    expect(p.rid).toBe('r0r0r0r0r0r0')
    expect(verifyRid(S, 'abcd2345', p.rid, p.sig)).toBe(true)
    expect(verifyRid(S, 'zzzz9999', p.rid, p.sig)).toBe(false)
    expect(verifyRid(S, 'abcd2345', 'r1r1r1r1r1r1', p.sig)).toBe(false)
  })
  it('a malformed r is no link at all', () => {
    for (const v of [null, '', 'x', 'ABCDEFGHIJKL.0000000000000000', 'r0r0r0r0r0r0.short']) expect(parseRidParam(v)).toBeNull()
  })
  it('the signature depends on the secret', () => {
    expect(ridSig(S, 'abcd2345', 'r0r0r0r0r0r0')).not.toBe(ridSig('z'.repeat(40), 'abcd2345', 'r0r0r0r0r0r0'))
  })
})

describe('render tokens', () => {
  it('verify for the page and rid they were minted for, within a day', () => {
    const t = mintRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', 1_000_000)
    const ok = verifyRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', t, 1_000_000 + 60_000)
    expect(ok.ok).toBe(true)
    expect(verifyRenderToken(S, 'abcd2345', 'r1r1r1r1r1r1', t, 1_000_060).ok).toBe(false)
    expect(verifyRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', t, 1_000_000 + 86_400_001).ok).toBe(false)
  })
  it('a token nobody minted is refused', () => {
    expect(verifyRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', 'lx2.aaaaaaaaaaaaaaaa.0000000000000000').ok).toBe(false)
    expect(verifyRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', 'garbage').ok).toBe(false)
  })
  it('two renders mint two tokens with two keys', () => {
    const now = 5
    const a = verifyRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', mintRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', now), now)
    const b = verifyRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', mintRenderToken(S, 'abcd2345', 'r0r0r0r0r0r0', now), now)
    expect(a.ok && b.ok && a.key !== b.key).toBe(true)
  })
  it('a beat key is bound to its session', () => {
    expect(beatKey(S, 'abcd2345', 'r0r0r0r0r0r0', 's1')).not.toBe(beatKey(S, 'abcd2345', 'r0r0r0r0r0r0', 's2'))
  })
})

describe('unfurl agents', () => {
  it.each([
    'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'WhatsApp/2.23.20.0',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Twitterbot/1.0',
    'LinkedInBot/1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0)',
    'TelegramBot (like TwitterBot)',
  ])('%s is an unfurl fetcher', (ua) => expect(isUnfurlAgent(ua)).toBe(true))
  it('a phone browser is not', () => {
    expect(isUnfurlAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false)
    expect(isUnfurlAgent(null)).toBe(true)
  })
})
