import { describe, it, expect } from 'vitest'
import { SIGN_IN_PROVIDERS, SIGN_IN_WORDS, providersFor } from './sign-in.js'

describe('the sign-in providers', () => {
  it('lists Google first, then Microsoft, each with its button and Firebase id', () => {
    expect(SIGN_IN_PROVIDERS.map((p) => [p.id, p.button, p.firebaseId])).toEqual([['google', 'Sign in with Google', 'google.com'], ['microsoft', 'Sign in with Microsoft', 'microsoft.com']])
  })
  it('a hub draws only the providers it turned on, in list order', () => {
    expect(providersFor(['google']).map((p) => p.id)).toEqual(['google'])
    expect(providersFor(['microsoft', 'google']).map((p) => p.id)).toEqual(['google', 'microsoft'])
  })
  it('its words name no provider', () => {
    for (const w of [SIGN_IN_WORDS.ask, SIGN_IN_WORDS.notVerified, SIGN_IN_WORDS.failed, SIGN_IN_WORDS.signedInNotOpened('a@example.com')]) expect(w).not.toMatch(/Google|Microsoft/)
    expect(SIGN_IN_WORDS.ask).toBe('Sign in with the account this page was shared with.')
  })
})

import { signInOutcome, providerOf } from './sign-in.js'

describe('what the page says after a sign-in', () => {
  it('a verified email opens the page', () => {
    expect(signInOutcome({ user: { email: 'a@example.com', emailVerified: true, providerId: 'microsoft.com' } }).show).toBe('open')
  })
  it('an unverified Microsoft email asks Firebase to send its own email once, then waits', () => {
    const u = { email: 'a@contoso.example.com', emailVerified: false, providerId: 'microsoft.com' }
    expect(signInOutcome({ user: u })).toEqual({ show: 'verify', words: 'We sent a link to a@contoso.example.com. Tap it, then come back and tap Continue.' })
    expect(signInOutcome({ user: u, verificationSent: true }).show).toBe('sent')
  })
  it('an email used before with Google says so, and offers Google', () => {
    expect(signInOutcome({ user: null, errorCode: 'auth/account-exists-with-different-credential', otherProvider: 'google' }))
      .toEqual({ show: 'use-other', words: 'You used Google before with this email. Continue with Google.' })
  })
  it('a work account its company blocks is told in plain words, with the other button', () => {
    expect(signInOutcome({ user: null, errorCode: 'auth/admin-restricted-operation' }).words)
      .toBe('Your company does not let this account sign in to apps it has not approved. Sign in with another account.')
  })
  it('a closed popup or another error says try again', () => {
    expect(signInOutcome({ user: null, errorCode: 'auth/popup-closed-by-user' }).show).toBe('failed')
  })
})

describe('the provider a pass was made for', () => {
  it('reads Firebase\'s sign_in_provider claim', () => {
    expect(providerOf({ firebase: { sign_in_provider: 'microsoft.com' } })).toBe('microsoft')
    expect(providerOf({ firebase: { sign_in_provider: 'google.com' } })).toBe('google')
    expect(providerOf({})).toBe('other')
  })
})

describe('the words when the page did not open', () => {
  it('an account with no email reads plainly', () => {
    expect(SIGN_IN_WORDS.signedInNotOpened(null)).toBe('You are signed in, but the page did not open. Reload to try again.')
  })
})
