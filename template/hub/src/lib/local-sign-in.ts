// Sign-in on the hub's OWN host. The reader signs in with Google or Microsoft on `<siteUrl>/artifact/sign-in`
// against the hub's own Firebase project, the page posts the ID token to /api/artifact-pass, and
// this mints the five-minute PASS signed with ARTIFACT_PASS_SECRET, which the package's
// `/api/reader/enter` swaps for a grant.
//
// THE COST: this side knows nobody's Supersuit membership, so every pass says `member: false`.
// An `access: freedom` page opens only to people on its list here. `access: invite` and
// `password:` pages are unaffected.
import { mintPass, providerOf } from '@supersuit/artifacts'
import type { Tenant } from '@/tenant'

/** The package's pass lifetime (reader.ts), which its index does not export. */
const PASS_TTL_SECONDS = 300
const PAGE = /^\/[abcdefghjkmnpqrstuvwxyz23456789]{8}$/

/** `claims` is the decoded ID token; its `firebase.sign_in_provider` names the provider for the count. */
export type VerifiedUser = { uid: string; email?: string; emailVerified: boolean; name?: string; claims?: Record<string, unknown> }

export type PassResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string }

/** The enter URL for a signed-in reader, or the reason there is none. */
export async function localPass(opts: {
  tenant: Tenant
  to: string | null
  authorization: string | null
  verify: (idToken: string) => Promise<VerifiedUser | null>
  secret: string | undefined
  now?: number
  /** Counts a finished sign-in by provider. Never awaited into the answer: a failed count opens the page anyway. */
  count?: (provider: string) => Promise<void>
}): Promise<PassResult> {
  const { tenant, to, authorization, verify, secret } = opts
  if (!tenant.localSignIn) return { ok: false, status: 404, error: 'no-local-sign-in' }
  if (!secret) return { ok: false, status: 503, error: 'gate-not-configured' }
  if (typeof to !== 'string' || !PAGE.test(to)) return { ok: false, status: 400, error: 'not-an-artifact' }
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
  if (!token) return { ok: false, status: 401, error: 'not signed in' }
  const user = await verify(token).catch(() => null)
  if (!user) return { ok: false, status: 401, error: 'not signed in' }
  if (!user.email || !user.emailVerified) return { ok: false, status: 403, error: 'email-not-verified' }
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + PASS_TTL_SECONDS
  const pass = mintPass(secret, { uid: user.uid, email: user.email.toLowerCase(), name: user.name ?? null, member: false }, exp)
  const u = new URL('/api/reader/enter', tenant.siteUrl)
  u.searchParams.set('to', to)
  u.searchParams.set('pass', pass)
  try { void opts.count?.(providerOf((user.claims ?? {}) as Parameters<typeof providerOf>[0]))?.catch(() => {}) } catch { /* a count never blocks the pass */ }
  return { ok: true, url: u.toString() }
}
