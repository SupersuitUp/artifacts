// src/artifacts/recipients.ts
// A page published with `links: per-reader` opens only through a link made for one reader. The
// link names an opaque rid and a signature over the page and the rid, so a rid cannot be guessed
// or carried to another page. A view is counted only from a signal the rendered page sends, and
// that signal carries a token minted for this one render: a fetch that never runs the page (every
// messaging app's preview fetcher) can never produce one.
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto'

export const RID_RE = /^[a-z0-9]{12}$/
const SIG_RE = /^[0-9a-f]{16}$/
export const RID_COOKIE_MAX_AGE = 7_776_000
export const VIEW_AFTER_MS = 2000
export const TOKEN_MAX_AGE_MS = 86_400_000
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A signing secret shorter than this is treated as unset by the routes: the page shuts. */
export const RECIPIENT_SECRET_MIN = 32
export function usableSecret(secret: string | null | undefined): string | undefined {
  return typeof secret === 'string' && secret.length >= RECIPIENT_SECRET_MIN ? secret : undefined
}

const mac = (secret: string, text: string) => {
  // An empty key still produces a valid MAC that anyone can compute; never sign with one.
  if (!secret) throw new Error('a signing secret is required')
  return createHmac('sha256', secret).update(text).digest('hex').slice(0, 16)
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function newRid(): string {
  const bytes = randomBytes(12)
  let s = ''
  for (const b of bytes) s += ALPHA[b % ALPHA.length]
  return s
}

export function ridSig(secret: string, id: string, rid: string): string {
  return mac(secret, `${id}\n${rid}`)
}

export function ridLink(pageUrl: string, id: string, rid: string, secret: string): string {
  return `${pageUrl}?r=${rid}.${ridSig(secret, id, rid)}`
}

export function parseRidParam(v: string | null | undefined): { rid: string; sig: string } | null {
  if (typeof v !== 'string') return null
  const [rid, sig, extra] = v.split('.')
  if (extra !== undefined || !RID_RE.test(rid ?? '') || !SIG_RE.test(sig ?? '')) return null
  return { rid, sig }
}

export function verifyRid(secret: string, id: string, rid: string, sig: string): boolean {
  if (!secret || !RID_RE.test(rid) || !SIG_RE.test(sig)) return false
  return same(ridSig(secret, id, rid), sig)
}

export function ridCookieName(id: string): string {
  return `artifact_r_${id}`
}

/** `<time base36>.<nonce 16 hex>.<mac 16 hex>`, minted once per server render. */
export function mintRenderToken(secret: string, id: string, rid: string, now: number = Date.now()): string {
  const ts = now.toString(36)
  const nonce = randomBytes(8).toString('hex')
  return `${ts}.${nonce}.${mac(secret, `${id}\n${rid}\n${ts}\n${nonce}`)}`
}

export function verifyRenderToken(secret: string, id: string, rid: string, token: string, now: number = Date.now()):
  { ok: true; key: string; expiresAt: number } | { ok: false; why: string } {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) return { ok: false, why: 'malformed' }
  if (!secret) return { ok: false, why: 'no secret' }
  const [ts, nonce, m] = parts
  if (!/^[0-9a-z]{1,12}$/.test(ts) || !SIG_RE.test(nonce) || !SIG_RE.test(m)) return { ok: false, why: 'malformed' }
  if (!same(mac(secret, `${id}\n${rid}\n${ts}\n${nonce}`), m)) return { ok: false, why: 'not minted here' }
  const at = parseInt(ts, 36)
  if (!Number.isFinite(at) || now - at > TOKEN_MAX_AGE_MS || at - now > 60_000) return { ok: false, why: 'expired' }
  return { ok: true, key: createHash('sha256').update(token).digest('hex').slice(0, 32), expiresAt: at + TOKEN_MAX_AGE_MS }
}

export function beatKey(secret: string, id: string, rid: string, session: string): string {
  return mac(secret, `beat\n${id}\n${rid}\n${session}`)
}

/** Messaging apps' and search engines' preview fetchers. Apple's LinkPresentation presents as
 *  `facebookexternalhit/1.1 Facebot Twitterbot/1.0`. A request with no user agent is treated as one. */
export const UNFURL_AGENTS = /facebookexternalhit|facebot|twitterbot|slackbot|whatsapp|linkedinbot|discordbot|telegrambot|skypeuripreview|redditbot|applebot|googlebot|bingbot|embedly|iframely|pinterest|bitlybot|vkshare|mastodon|preview/i

export function isUnfurlAgent(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true
  return UNFURL_AGENTS.test(ua)
}
