// Who is reading a gated page, and whether they may.
//
// A page with `access:` in its front matter never renders its body to an anonymous request.
// The reader signs in at the host's sign-in authority (`signInOrigin`, the service that knows
// who holds a Freedom account), which bounces them back with a five-minute PASS naming them. The host swaps the pass for its
// own GRANT, an HttpOnly cookie on this host, and from then on every gated page on the host
// knows who is reading without asking again.
//
// THE PASS SHAPE IS A CONTRACT WITH THE SIGN-IN AUTHORITY, byte for byte (README, "The reader
// pass"): `a1.<payload>.<sig>`, payload the base64url of a small JSON, sig the first 32 hex of
// HMAC-SHA256(secret, `artifact-pass:a1.<payload>`). reader.test.ts pins the vector, so a
// change here is named by a failing test before it can reach a deploy and break every sign-in.
//
// WHY A PERSON AND NOT A LINK. Nothing in the URL opens the page, so a forwarded link opens a
// sign-in door and nothing else. When the person it was forwarded to signs in and is not on
// the list, their refusal is recorded under their own address, which is how a forward shows up.
import { createHmac, timingSafeEqual } from 'node:crypto'

export type Access = 'invite' | 'freedom'
export const ACCESS_LEVELS: readonly Access[] = ['invite', 'freedom']

/** The person a pass or a grant names. `member` is an active Freedom account at sign-in time. */
export type Reader = { uid: string; email: string; name: string | null; member: boolean }

export const PASS_TTL_SECONDS = 300
/** A week, so a revoked Freedom account loses `freedom` pages within seven days. Allowlist
 *  changes need no wait: the list is read on every request. */
export const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60
export const GRANT_COOKIE = 'artifact_reader'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const unb64url = (s: string) => Buffer.from(s, 'base64url').toString('utf8')
const sig = (secret: string, domain: string, body: string) =>
  createHmac('sha256', secret).update(`${domain}:${body}`).digest('hex').slice(0, 32)

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function encode(secret: string, domain: string, version: string, reader: Reader, exp: number): string {
  // Short keys: this rides in a URL and a cookie.
  const payload = b64url(JSON.stringify({ u: reader.uid, e: reader.email, n: reader.name, m: reader.member, x: exp }))
  const body = `${version}.${payload}`
  return `${body}.${sig(secret, domain, body)}`
}

function decode(secret: string | undefined, domain: string, version: string, token: string | null | undefined, now: number): Reader | null {
  if (!secret || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== version) return null
  const body = `${parts[0]}.${parts[1]}`
  if (!/^[0-9a-f]{32}$/.test(parts[2]) || !safeEqual(parts[2], sig(secret, domain, body))) return null
  let d: Record<string, unknown>
  try {
    d = JSON.parse(unb64url(parts[1]))
  } catch {
    return null
  }
  if (typeof d.x !== 'number' || d.x * 1000 < now) return null
  if (typeof d.u !== 'string' || !d.u || typeof d.e !== 'string' || !d.e.includes('@')) return null
  return {
    uid: d.u,
    email: d.e.trim().toLowerCase(),
    name: typeof d.n === 'string' && d.n.trim() ? d.n.trim() : null,
    member: d.m === true,
  }
}

export function mintPass(secret: string, reader: Reader, exp: number): string {
  return encode(secret, 'artifact-pass', 'a1', reader, exp)
}
export function verifyPass(secret: string | undefined, pass: string | null | undefined, now = Date.now()): Reader | null {
  return decode(secret, 'artifact-pass', 'a1', pass, now)
}
export function mintGrant(secret: string, reader: Reader, now = Date.now()): string {
  return encode(secret, 'artifact-grant', 'g1', reader, Math.floor(now / 1000) + GRANT_TTL_SECONDS)
}
export function verifyGrant(secret: string | undefined, grant: string | null | undefined, now = Date.now()): Reader | null {
  return decode(secret, 'artifact-grant', 'g1', grant, now)
}

/** One person let in by name. Stored on the host, never in the published file. */
export type AllowEntry = { email: string; name?: string; reason?: string; addedAt?: string }

export type Decision =
  | { open: true; why: 'listed'; reason: string }
  | { open: true; why: 'member'; reason: string }
  | { open: false; why: 'signed-out' }
  | { open: false; why: 'not-allowed'; reader: Reader }

export const MEMBER_REASON = 'you are a Freedom user'
export const LISTED_REASON = 'you were given access to it by name'

/** Whether this reader may open a page with this access level. The allowlist opens both
 *  levels; `freedom` also opens to any active Freedom account. A listed person's own reason
 *  wins over the membership one, because it is the truer account of why they are reading. */
export function decide(access: Access, reader: Reader | null, allow: AllowEntry[]): Decision {
  if (!reader) return { open: false, why: 'signed-out' }
  const listed = allow.find((a) => a.email.trim().toLowerCase() === reader.email)
  if (listed) return { open: true, why: 'listed', reason: listed.reason?.trim() || LISTED_REASON }
  if (access === 'freedom' && reader.member) return { open: true, why: 'member', reason: MEMBER_REASON }
  return { open: false, why: 'not-allowed', reader }
}

/** The name the banner addresses: the allowlist's name, then the account's, first word only. */
export function firstName(reader: Reader, allow: AllowEntry[]): string | null {
  const listed = allow.find((a) => a.email.trim().toLowerCase() === reader.email)
  const full = listed?.name?.trim() || reader.name
  return full ? full.split(/\s+/)[0] : null
}

/** Where a reader goes to sign in, carrying the page they asked for. */
export function signInUrl(signInOrigin: string, pageUrl: string): string {
  return `${signInOrigin}/artifact/sign-in?to=${encodeURIComponent(pageUrl)}`
}

/** A path on this host that `enter` may send a reader to after it sets the grant: one page id,
 *  nothing else, so the redirect cannot be pointed off the host. */
export function safeReturnPath(to: string | null | undefined, prefix = '/'): string | null {
  if (typeof to !== 'string') return null
  const m = new RegExp(`^${prefix.replace(/\//g, '\\/')}([abcdefghjkmnpqrstuvwxyz23456789]{8})$`).exec(to)
  return m ? `${prefix}${m[1]}` : null
}
