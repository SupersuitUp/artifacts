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
  signedInNotOpened: (email: string) => `Signed in as ${email}, but the page did not open. Reload to try again.`,
}
