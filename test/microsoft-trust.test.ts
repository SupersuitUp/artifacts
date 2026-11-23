// A Microsoft work email is trusted without the emailed link only when Microsoft itself says the
// tenant verified the email's domain (the `xms_edov` claim), in a Microsoft ID token whose signature,
// audience, issuer and expiry all check, for the same Firebase user and the same email.
import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto'
import { checkMicrosoftClaims, edovTrue, microsoftKeys, trustMicrosoftEmail, verifyMicrosoftIdToken, MICROSOFT_KEYS_URL } from '../template/hub/src/lib/microsoft-trust'

const CLIENT = '11111111-2222-3333-4444-555555555555'
const TID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const NOW = 1_800_000_000
const good = { aud: CLIENT, tid: TID, iss: `https://login.microsoftonline.com/${TID}/v2.0`, exp: NOW + 3600, nbf: NOW - 60, email: 'Reader@Contoso.example.com', xms_edov: true }

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', use: 'sig', kty: 'RSA' }
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const body = `${b64(header)}.${b64(claims)}`
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`
}
const getKey = async (kid: string) => (kid === 'k1' ? jwk : null)

describe('the xms_edov claim', () => {
  it('counts as true only as boolean true, "1" or "true"', () => {
    for (const v of [true, '1', 'true']) expect(edovTrue(v)).toBe(true)
    for (const v of [false, '0', 'false', 'yes', 1, 'TRUE', undefined, null, '']) expect(edovTrue(v)).toBe(false)
  })
})

describe('the Microsoft token claims', () => {
  const check = (c: Record<string, unknown>) => checkMicrosoftClaims(c, { clientId: CLIENT, nowSeconds: NOW })
  it('a token for this hub, from its own tenant, in date, with a verified domain and an email, passes', () => {
    expect(check(good)).toEqual({ ok: true, email: 'reader@contoso.example.com' })
    expect(check({ ...good, xms_edov: '1' }).ok).toBe(true)
    expect(check({ ...good, xms_edov: 'true' }).ok).toBe(true)
  })
  it('refuses another app\'s token', () => {
    expect(check({ ...good, aud: 'someone-else' })).toEqual({ ok: false, reason: 'wrong-audience' })
    expect(check({ ...good, aud: [CLIENT] })).toEqual({ ok: false, reason: 'wrong-audience' })
  })
  it('refuses an issuer that is not the token\'s own tenant', () => {
    expect(check({ ...good, iss: 'https://login.microsoftonline.com/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0' })).toEqual({ ok: false, reason: 'wrong-issuer' })
    expect(check({ ...good, iss: `https://sts.windows.net/${TID}/` })).toEqual({ ok: false, reason: 'wrong-issuer' })
    expect(check({ ...good, tid: undefined })).toEqual({ ok: false, reason: 'wrong-issuer' })
  })
  it('refuses an expired token, with five minutes of clock skew', () => {
    expect(check({ ...good, exp: NOW - 299 }).ok).toBe(true)
    expect(check({ ...good, exp: NOW - 301 })).toEqual({ ok: false, reason: 'expired' })
    expect(check({ ...good, exp: undefined })).toEqual({ ok: false, reason: 'expired' })
    expect(check({ ...good, nbf: NOW + 3600 })).toEqual({ ok: false, reason: 'not-yet-valid' })
  })
  it('refuses a token with no email or an unverified domain', () => {
    expect(check({ ...good, email: undefined })).toEqual({ ok: false, reason: 'no-email' })
    expect(check({ ...good, email: ' ' })).toEqual({ ok: false, reason: 'no-email' })
    expect(check({ ...good, xms_edov: undefined })).toEqual({ ok: false, reason: 'domain-not-verified' })
    expect(check({ ...good, xms_edov: false })).toEqual({ ok: false, reason: 'domain-not-verified' })
    expect(check({ ...good, xms_edov: 'yes' })).toEqual({ ok: false, reason: 'domain-not-verified' })
  })
})

describe('the Microsoft token signature', () => {
  it('returns the claims of a token signed by a Microsoft key', async () => {
    expect(await verifyMicrosoftIdToken(jwt(good), getKey)).toMatchObject({ email: good.email, xms_edov: true })
  })
  it('refuses a changed payload, an unknown key, another algorithm and a malformed token', async () => {
    const t = jwt(good)
    const [h, , s] = t.split('.')
    expect(await verifyMicrosoftIdToken(`${h}.${b64({ ...good, email: 'other@contoso.example.com' })}.${s}`, getKey)).toBeNull()
    expect(await verifyMicrosoftIdToken(jwt(good, { alg: 'RS256', kid: 'k9' }), getKey)).toBeNull()
    expect(await verifyMicrosoftIdToken(jwt(good, { alg: 'none', kid: 'k1' }), getKey)).toBeNull()
    expect(await verifyMicrosoftIdToken(jwt(good, { alg: 'HS256', kid: 'k1' }), getKey)).toBeNull()
    expect(await verifyMicrosoftIdToken('not.a.token', getKey)).toBeNull()
    expect(await verifyMicrosoftIdToken('', getKey)).toBeNull()
  })
})

describe("Microsoft's signing keys", () => {
  it('fetches the common v2.0 key set once and serves known keys from the cache', async () => {
    let now = 0
    const fetch = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })))
    const keys = microsoftKeys({ fetch, now: () => now })
    expect(await keys('k1')).toMatchObject({ kid: 'k1' })
    expect(await keys('k1')).toMatchObject({ kid: 'k1' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(MICROSOFT_KEYS_URL)
    // An unknown key refetches, but not more than once in five minutes.
    expect(await keys('k2')).toBeNull()
    now += 60_000
    expect(await keys('k2')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 300_000
    expect(await keys('k2')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('a failed fetch gives no key, never a throw', async () => {
    const keys = microsoftKeys({ fetch: async () => { throw new Error('offline') }, now: () => 0 })
    expect(await keys('k1')).toBeNull()
  })
})

describe('the trust route', () => {
  const firebaseUser = { uid: 'u1', email: 'reader@contoso.example.com', emailVerified: false, signInProvider: 'microsoft.com' }
  const run = (o: Partial<Parameters<typeof trustMicrosoftEmail>[0]> = {}) => {
    const markVerified = vi.fn(async () => {})
    const p = trustMicrosoftEmail({
      clientId: CLIENT, authorization: 'Bearer firebase-token', microsoftIdToken: jwt(good), now: NOW * 1000,
      verifyFirebase: async (t) => (t === 'firebase-token' ? firebaseUser : null),
      verifyMicrosoft: (t) => verifyMicrosoftIdToken(t, getKey),
      markVerified, ...o,
    })
    return p.then((r) => ({ r, markVerified: (o.markVerified as typeof markVerified | undefined) ?? markVerified }))
  }

  it('marks the Firebase user verified when every check passes', async () => {
    const { r, markVerified } = await run()
    expect(r).toEqual({ ok: true, changed: true })
    expect(markVerified).toHaveBeenCalledWith('u1')
  })
  it('declines with 404 when the hub has no Microsoft client id, so the link flow runs', async () => {
    const { r, markVerified } = await run({ clientId: undefined })
    expect(r).toEqual({ ok: false, status: 404, reason: 'no-microsoft-client' })
    expect(markVerified).not.toHaveBeenCalled()
  })
  it('a user already verified changes nothing', async () => {
    const { r, markVerified } = await run({ verifyFirebase: async () => ({ ...firebaseUser, emailVerified: true }) })
    expect(r).toEqual({ ok: true, changed: false })
    expect(markVerified).not.toHaveBeenCalled()
  })
  const refusals: [string, Partial<Parameters<typeof trustMicrosoftEmail>[0]>, number, string][] = [
    ['no Firebase token', { authorization: null }, 401, 'not-signed-in'],
    ['a Firebase token that does not verify', { verifyFirebase: async () => null }, 401, 'not-signed-in'],
    ['a Firebase verifier that throws', { verifyFirebase: async () => { throw new Error('bad') } }, 401, 'not-signed-in'],
    ['no Microsoft token', { microsoftIdToken: undefined }, 400, 'no-microsoft-token'],
    ['a Microsoft token that is not a string', { microsoftIdToken: { t: 1 } }, 400, 'no-microsoft-token'],
    ['a Firebase sign-in with another provider', { verifyFirebase: async () => ({ ...firebaseUser, signInProvider: 'google.com' }) }, 403, 'not-microsoft-sign-in'],
    ['a Firebase user with no email', { verifyFirebase: async () => ({ ...firebaseUser, email: undefined }) }, 403, 'no-email'],
    ['a forged Microsoft token', { microsoftIdToken: jwt(good).slice(0, -4) + 'AAAA' }, 403, 'bad-signature'],
    ['another app\'s Microsoft token', { microsoftIdToken: jwt({ ...good, aud: 'other' }) }, 403, 'wrong-audience'],
    ['an unverified domain', { microsoftIdToken: jwt({ ...good, xms_edov: false }) }, 403, 'domain-not-verified'],
    ['an expired Microsoft token', { microsoftIdToken: jwt({ ...good, exp: NOW - 3600 }) }, 403, 'expired'],
    ['a Microsoft token for another email', { microsoftIdToken: jwt({ ...good, email: 'someone@contoso.example.com' }) }, 403, 'email-mismatch'],
  ]
  for (const [name, o, status, reason] of refusals) {
    it(`refuses ${name} with ${status} ${reason} and changes nothing`, async () => {
      const { r, markVerified } = await run(o)
      expect(r).toEqual({ ok: false, status, reason })
      expect(markVerified).not.toHaveBeenCalled()
    })
  }
  it('an update that fails is a 500, not a pass', async () => {
    const { r } = await run({ markVerified: async () => { throw new Error('down') } })
    expect(r).toEqual({ ok: false, status: 500, reason: 'update-failed' })
  })
})
