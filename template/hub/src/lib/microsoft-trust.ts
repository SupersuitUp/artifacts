// Trusting a Microsoft work email without the emailed link. Firebase leaves a Microsoft email
// unverified, because a tenant administrator can set any email on an account. Microsoft's own ID
// token says when that is not the case: the optional claim `xms_edov` is true when the email's domain
// belongs to the user's tenant and the tenant administrator verified it. So the hub trusts the email
// only when a Microsoft ID token, signed by Microsoft, issued for this hub's own app registration by
// the user's own tenant and still in date, carries `xms_edov` true and the same email as the Firebase
// user, who signed in with Microsoft. Anything else changes nothing and the emailed link runs as
// before. No imports but node:crypto, so it is unit-tested without Firebase. Never log a token.
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto'

export const MICROSOFT_KEYS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
/** Allowed clock difference between Microsoft and this server. */
export const CLOCK_SKEW_SECONDS = 300
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TrustReason =
  | 'no-microsoft-client' | 'not-signed-in' | 'no-microsoft-token' | 'not-microsoft-sign-in' | 'no-email'
  | 'bad-signature' | 'wrong-audience' | 'wrong-issuer' | 'expired' | 'not-yet-valid' | 'domain-not-verified'
  | 'email-mismatch' | 'update-failed'

/** `xms_edov` arrives as boolean true or as the string "1" or "true". Nothing else counts. */
export const edovTrue = (v: unknown): boolean => v === true || v === '1' || v === 'true'

/** The claims of a Microsoft ID token whose signature is already checked. The email is lowercased. */
export function checkMicrosoftClaims(c: Record<string, unknown>, o: { clientId: string; nowSeconds: number }):
  { ok: true; email: string } | { ok: false; reason: TrustReason } {
  if (typeof c.aud !== 'string' || c.aud !== o.clientId) return { ok: false, reason: 'wrong-audience' }
  if (typeof c.tid !== 'string' || !TENANT_ID.test(c.tid) || c.iss !== `https://login.microsoftonline.com/${c.tid}/v2.0`) return { ok: false, reason: 'wrong-issuer' }
  if (typeof c.exp !== 'number' || c.exp + CLOCK_SKEW_SECONDS < o.nowSeconds) return { ok: false, reason: 'expired' }
  if (typeof c.nbf === 'number' && c.nbf - CLOCK_SKEW_SECONDS > o.nowSeconds) return { ok: false, reason: 'not-yet-valid' }
  if (typeof c.email !== 'string' || !c.email.trim()) return { ok: false, reason: 'no-email' }
  if (!edovTrue(c.xms_edov)) return { ok: false, reason: 'domain-not-verified' }
  return { ok: true, email: c.email.trim().toLowerCase() }
}

const json = (part: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch { return null }
}

/** The claims of an RS256 token signed by the Microsoft key its header names, or null. */
export async function verifyMicrosoftIdToken(token: string, getKey: (kid: string) => Promise<JsonWebKey | null>): Promise<Record<string, unknown> | null> {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3 || parts.some((p) => !p)) return null
  const header = json(parts[0])
  const claims = json(parts[1])
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null
  try {
    const jwk = await getKey(header.kid)
    if (!jwk) return null
    const key = createPublicKey({ key: jwk, format: 'jwk' })
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))
    return ok ? claims : null
  } catch { return null }
}

/** Microsoft's signing keys, cached for an hour. A key not in the cache refetches the set, at most
 *  once in five minutes, because Microsoft rolls its keys. A failed fetch gives no key. */
export function microsoftKeys(o: { fetch: (url: string) => Promise<Response>; now?: () => number; url?: string; ttlMs?: number; refetchAfterMs?: number }) {
  const now = o.now ?? Date.now
  const ttl = o.ttlMs ?? 3_600_000
  const refetchAfter = o.refetchAfterMs ?? 300_000
  let keys = new Map<string, JsonWebKey>()
  let fetchedAt = -Infinity
  async function refresh() {
    fetchedAt = now()
    try {
      const res = await o.fetch(o.url ?? MICROSOFT_KEYS_URL)
      if (!res.ok) return
      const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: unknown })[] }
      const next = new Map<string, JsonWebKey>()
      for (const k of body.keys ?? []) if (typeof k.kid === 'string' && k.kty === 'RSA') next.set(k.kid, k)
      keys = next
    } catch { /* offline: keep what we had */ }
  }
  return async (kid: string): Promise<JsonWebKey | null> => {
    const age = now() - fetchedAt
    if (age >= ttl || (!keys.has(kid) && age >= refetchAfter)) await refresh()
    return keys.get(kid) ?? null
  }
}

export type FirebaseReader = { uid: string; email?: string; emailVerified: boolean; signInProvider?: string }
export type TrustResult = { ok: true; changed: boolean } | { ok: false; status: number; reason: TrustReason }

/** The whole decision for POST /api/artifact-trust-microsoft. Only the last step changes anything. */
export async function trustMicrosoftEmail(o: {
  clientId: string | undefined
  authorization: string | null
  microsoftIdToken: unknown
  verifyFirebase: (idToken: string) => Promise<FirebaseReader | null>
  verifyMicrosoft: (idToken: string) => Promise<Record<string, unknown> | null>
  markVerified: (uid: string) => Promise<void>
  now?: number
}): Promise<TrustResult> {
  if (!o.clientId) return { ok: false, status: 404, reason: 'no-microsoft-client' }
  const bearer = /^Bearer (.+)$/.exec(o.authorization ?? '')?.[1]
  const user = bearer ? await o.verifyFirebase(bearer).catch(() => null) : null
  if (!user) return { ok: false, status: 401, reason: 'not-signed-in' }
  if (typeof o.microsoftIdToken !== 'string' || !o.microsoftIdToken) return { ok: false, status: 400, reason: 'no-microsoft-token' }
  if (user.signInProvider !== 'microsoft.com') return { ok: false, status: 403, reason: 'not-microsoft-sign-in' }
  if (!user.email) return { ok: false, status: 403, reason: 'no-email' }
  if (user.emailVerified) return { ok: true, changed: false }
  const claims = await o.verifyMicrosoft(o.microsoftIdToken).catch(() => null)
  if (!claims) return { ok: false, status: 403, reason: 'bad-signature' }
  const checked = checkMicrosoftClaims(claims, { clientId: o.clientId, nowSeconds: Math.floor((o.now ?? Date.now()) / 1000) })
  if (!checked.ok) return { ok: false, status: 403, reason: checked.reason }
  if (checked.email !== user.email.trim().toLowerCase()) return { ok: false, status: 403, reason: 'email-mismatch' }
  try { await o.markVerified(user.uid) } catch { return { ok: false, status: 500, reason: 'update-failed' } }
  return { ok: true, changed: true }
}
