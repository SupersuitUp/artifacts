// The hub's sign-in providers (Microsoft sign-in, 2026-11-11). The page draws one button for each
// provider the hub turned on, and its words name none of them, so adding a provider is a row here.
export type SignInProviderId = 'google' | 'microsoft'
export const SIGN_IN_PROVIDERS = [
  { id: 'google', button: 'Sign in with Google', firebaseId: 'google.com' },
  { id: 'microsoft', button: 'Sign in with Microsoft', firebaseId: 'microsoft.com' },
] as const satisfies readonly { id: SignInProviderId; button: string; firebaseId: string }[]
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number]
export const providersFor = (enabled: readonly SignInProviderId[]): SignInProvider[] => SIGN_IN_PROVIDERS.filter((p) => enabled.includes(p.id))
export const SIGN_IN_WORDS = {
  ask: 'Sign in with the account this page was shared with.',
  notVerified: 'That account has no verified email. Sign in with one that does.',
  failed: 'That did not finish. Try again.',
  // Microsoft can return an account with no email, so that case names none.
  signedInNotOpened: (email: string | null) => email
    ? `Signed in as ${email}, but the page did not open. Reload to try again.`
    : 'You are signed in, but the page did not open. Reload to try again.',
}

const NAMES: Record<SignInProviderId, string> = { google: 'Google', microsoft: 'Microsoft' }
export type SignInShow = 'open' | 'verify' | 'sent' | 'use-other' | 'blocked' | 'failed'

/** What the page shows. A Microsoft email is not verified unless Microsoft issued the domain, and a work
 *  tenant's administrator can set any email on an account, so an unverified email never gets a pass: the page
 *  asks Firebase to send its own verification email, once, and the reader taps it. */
export function signInOutcome(i: { user: { email: string | null; emailVerified: boolean; providerId: string } | null; errorCode?: string; otherProvider?: SignInProviderId | null; verificationSent?: boolean }): { show: SignInShow; words: string } {
  if (i.errorCode === 'auth/account-exists-with-different-credential' && i.otherProvider)
    return { show: 'use-other', words: `You used ${NAMES[i.otherProvider]} before with this email. Continue with ${NAMES[i.otherProvider]}.` }
  if (i.errorCode === 'auth/admin-restricted-operation' || i.errorCode === 'auth/unauthorized-domain')
    return { show: 'blocked', words: 'Your company does not let this account sign in to apps it has not approved. Sign in with another account.' }
  if (i.errorCode || !i.user) return { show: 'failed', words: SIGN_IN_WORDS.failed }
  if (!i.user.email) return { show: 'failed', words: SIGN_IN_WORDS.notVerified }
  if (i.user.emailVerified) return { show: 'open', words: 'Opening…' }
  return i.verificationSent
    ? { show: 'sent', words: `The link went to ${i.user.email}. Tap it, then come back and tap Continue.` }
    : { show: 'verify', words: `We sent a link to ${i.user.email}. Tap it, then come back and tap Continue.` }
}

/** The provider a pass was made for, from Firebase's `sign_in_provider` claim. */
export const providerOf = (claims: { firebase?: { sign_in_provider?: string } }): SignInProviderId | 'other' =>
  (SIGN_IN_PROVIDERS.find((p) => p.firebaseId === claims.firebase?.sign_in_provider)?.id ?? 'other')
