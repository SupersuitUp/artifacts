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
