// The publisher pass: a short-lived, signed statement that a named person may do what the
// publish key does, on ONE host.
//
// A shared publish key cannot be self-served and cannot be revoked for one person without
// rotating it for everyone. A host that opts in (routes config `publisherSecret` +
// `publisherHost`) also accepts this pass as the Bearer: a sign-in authority that knows who the
// host's admins are mints it for one of them, and it expires within an hour, so revoking the
// admin stops new passes and an outstanding one dies on its own.
//
// THE SHAPE IS A CONTRACT WITH THE AUTHORITY THAT MINTS IT, byte for byte: `p1.<payload>.<sig>`,
// payload the base64url of `{ u, e, n, h, x }`, sig the first 32 hex of
// HMAC-SHA256(secret, `artifact-publisher:p1.<payload>`). Same scheme as the reader pass, with its
// own domain and version, so a reader pass (a1) or grant (g1) never verifies here and a
// publisher pass never verifies as either (publisher.test.ts pins both directions and the vector).
import { openToken, signToken } from './reader.js'

export const PUBLISHER_DOMAIN = 'artifact-publisher'
export const PUBLISHER_VERSION = 'p1'
export const PUBLISHER_PASS_TTL_SECONDS = 3600

/** Who a publisher pass names, and the one host it is good for. */
export type Publisher = { uid: string; email: string; name: string | null; host: string }

const normHost = (h: string) => h.trim().toLowerCase()

export function mintPublisherPass(secret: string, p: Publisher, exp: number): string {
  return signToken(secret, PUBLISHER_DOMAIN, PUBLISHER_VERSION, {
    u: p.uid,
    e: p.email.trim().toLowerCase(),
    n: p.name,
    h: normHost(p.host),
    x: exp,
  })
}

/** The publisher a pass names, if it is correctly signed, unexpired, and for `host` (a hostname
 *  like `artifacts.example.com`, no scheme). Anything else is null: a pass for another host is
 *  refused even under the same secret, because two hosts can share one. */
export function verifyPublisherPass(
  secret: string | undefined,
  pass: string | null | undefined,
  host: string | undefined,
  now = Date.now(),
): Publisher | null {
  if (!host) return null
  const d = openToken(secret, PUBLISHER_DOMAIN, PUBLISHER_VERSION, pass, now)
  if (!d) return null
  if (typeof d.u !== 'string' || !d.u || typeof d.e !== 'string' || !d.e.includes('@') || typeof d.h !== 'string') return null
  if (normHost(d.h) !== normHost(host)) return null
  return {
    uid: d.u,
    email: d.e.trim().toLowerCase(),
    name: typeof d.n === 'string' && d.n.trim() ? d.n.trim() : null,
    host: normHost(d.h),
  }
}
