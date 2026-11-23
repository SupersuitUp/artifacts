// The hub's sign-in providers (Microsoft sign-in, 2026-11-11). The page draws one button for each
// provider the hub turned on, and its words name none of them, so adding a provider is a row here.
// `email` is Firebase email link sign-in ("Email me a sign-in link"): a door for ANY address, drawn as
// a form rather than a popup button. Its ID tokens say `sign_in_provider: password`.
export type SignInProviderId = 'google' | 'microsoft' | 'email'
export const SIGN_IN_PROVIDERS = [
  { id: 'google', button: 'Sign in with Google', firebaseId: 'google.com' },
  { id: 'microsoft', button: 'Sign in with Microsoft', firebaseId: 'microsoft.com' },
  { id: 'email', button: 'Email me a sign-in link', firebaseId: 'password' },
] as const satisfies readonly { id: SignInProviderId; button: string; firebaseId: string }[]
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number]
export const providersFor = (enabled: readonly SignInProviderId[]): SignInProvider[] => SIGN_IN_PROVIDERS.filter((p) => enabled.includes(p.id))
/** Google and Microsoft open a popup; the email link door is a form on the page. */
export const isPopupProvider = (id: SignInProviderId): id is 'google' | 'microsoft' => id !== 'email'
export const SIGN_IN_WORDS = {
  ask: 'Sign in with the account this page was shared with.',
  notVerified: 'That account has no verified email. Sign in with one that does.',
  // A Microsoft account with no mailbox (a test or unlicensed user) signs in with no email at all.
  noEmail: 'That account did not share an email address, so this page cannot check it was shared with you. Sign in with an account that has its own mailbox.',
  failed: 'That did not finish. Try again.',
  // The pass was refused for an unverified email: point at the link already sent, never a dead end.
  verifyThenContinue: (email: string) => `${email} is not verified yet. Tap the link we emailed you, then come back and tap Continue.`,
  // Microsoft can return an account with no email, so that case names none.
  signedInNotOpened: (email: string | null) => email
    ? `Signed in as ${email}, but the page did not open. Reload to try again.`
    : 'You are signed in, but the page did not open. Reload to try again.',
  // The email link door.
  emailLabel: 'Your email address',
  emailLinkSent: (email: string) => `We sent a sign-in link to ${email}. Open it on this device.`,
  // The link was opened where the address was not kept (another device, or storage cleared).
  emailAskAgain: 'Type the email address the link was sent to.',
  emailNotAnAddress: 'That is not an email address. Check it and try again.',
  emailLinkFailed: 'That link did not work. It may be old or already used. Ask for a new one.',
  emailSendFailed: 'The link did not send. Try again.',
}

const NAMES: Record<SignInProviderId, string> = { google: 'Google', microsoft: 'Microsoft', email: 'an email link' }
export type SignInShow = 'open' | 'verify' | 'sent' | 'use-other' | 'blocked' | 'failed'

/** What the page shows. A Microsoft email is not verified unless Microsoft issued the domain, and a work
 *  tenant's administrator can set any email on an account, so an unverified email never gets a pass: the page
 *  asks Firebase to send its own verification email, once, and the reader taps it. */
export function signInOutcome(i: { user: { email: string | null; emailVerified: boolean; providerId: string } | null; errorCode?: string; otherProvider?: SignInProviderId | null; verificationSent?: boolean }): { show: SignInShow; words: string } {
  if (i.errorCode === 'auth/account-exists-with-different-credential' && i.otherProvider)
    return { show: 'use-other', words: `You used ${NAMES[i.otherProvider]} before with this email. Continue with ${NAMES[i.otherProvider]}.` }
  // auth/unauthorized-domain is the hub's own setup fault, not the reader's company, so it falls to the plain words.
  if (i.errorCode === 'auth/admin-restricted-operation')
    return { show: 'blocked', words: 'Your company does not let this account sign in to apps it has not approved. Sign in with another account.' }
  if (i.errorCode || !i.user) return { show: 'failed', words: SIGN_IN_WORDS.failed }
  if (!i.user.email) return { show: 'failed', words: SIGN_IN_WORDS.noEmail }
  if (i.user.emailVerified) return { show: 'open', words: 'Opening…' }
  return i.verificationSent
    ? { show: 'sent', words: `The link went to ${i.user.email}. Tap it, then come back and tap Continue.` }
    : { show: 'verify', words: `We sent a link to ${i.user.email}. Tap it, then come back and tap Continue.` }
}

/** The provider a pass was made for, from Firebase's `sign_in_provider` claim. */
export const providerOf = (claims: { firebase?: { sign_in_provider?: string } }): SignInProviderId | 'other' =>
  (SIGN_IN_PROVIDERS.find((p) => p.firebaseId === claims.firebase?.sign_in_provider)?.id ?? 'other')

/** Link a refused credential only to an account with the same email: the second popup can return any
 *  account, and linking a stranger's credential to it would make two readers one. */
export const shouldLink = (pendingEmail: string | null | undefined, userEmail: string | null | undefined): boolean =>
  !!pendingEmail && !!userEmail && pendingEmail.toLowerCase() === userEmail.toLowerCase()

/** The page sends Firebase's verification email only for an unverified email, with a page to open, once. */
export const shouldSendVerification = (i: { hasPage: boolean; email: string | null; emailVerified: boolean; sentBefore: boolean }): boolean =>
  i.hasPage && !!i.email && !i.emailVerified && !i.sentBefore

/** A sign-in counts once: when the ID token's `auth_time` is this close to now. A reader already
 *  signed in who opens more pages carries an older `auth_time`, so the count does not grow. */
export const FRESH_SIGN_IN_SECONDS = 300
export const isFreshSignIn = (claims: { auth_time?: unknown }, nowSeconds: number): boolean =>
  typeof claims.auth_time === 'number' && Math.abs(nowSeconds - claims.auth_time) <= FRESH_SIGN_IN_SECONDS

/** After a Microsoft popup: ask the hub to trust the email (its tenant verified the domain, the ID
 *  token's `xms_edov` claim) before Firebase's verification email is sent. Only for an unverified
 *  email, with Microsoft's ID token in hand, on a hub that has its Microsoft client id. */
export const shouldTryMicrosoftTrust = (i: { providerId: SignInProviderId; emailVerified: boolean; hasMicrosoftIdToken: boolean; trustOn: boolean }): boolean =>
  i.providerId === 'microsoft' && !i.emailVerified && i.hasMicrosoftIdToken && i.trustOn

/** Where an emailed sign-in link returns: this same sign-in page, with the page the reader asked for. */
export const emailLinkContinueUrl = (siteUrl: string, to: string): string => {
  const u = new URL('/artifact/sign-in', siteUrl)
  u.searchParams.set('to', new URL(to, siteUrl).toString())
  return u.toString()
}

/** A plain check before sending a link: a name, an @, a domain with a dot, no spaces. */
export const looksLikeEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Where the page keeps the address a link was sent to, so the return can finish on this device. */
export const EMAIL_LINK_STORAGE_KEY = 'artifact-email-link'
