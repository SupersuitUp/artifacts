// The hub sign-in page's two newer doors, read from the page source (its Firebase client does not
// load in this test environment; the logic it calls is unit-tested in src/artifacts/sign-in.test.ts
// and test/microsoft-trust.test.ts).
// 1. After a Microsoft popup, the page asks the hub to trust the email BEFORE Firebase's
//    verification email can go out, and only a declined trust sends it.
// 2. "Email me a sign-in link" sends Firebase's email link back to this same page, and finishes it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '../template/hub/app/artifact/sign-in/sign-in.tsx'), 'utf8')
const route = readFileSync(resolve(__dirname, '../template/hub/app/api/artifact-trust-microsoft/route.ts'), 'utf8')
const fn = (name) => { const at = src.indexOf(name); expect(at).toBeGreaterThan(-1); return src.slice(at, src.indexOf('\n  }\n', at)) }

describe('trusting a Microsoft email before the verification email', () => {
  it('marks the trust attempt as running before the popup opens', () => {
    const body = fn('async function signInWith(')
    expect(body.indexOf('setTrusting(true)')).toBeGreaterThan(-1)
    expect(body.indexOf('setTrusting(true)')).toBeLessThan(body.indexOf('signInWithPopup('))
    expect(body).toContain('OAuthProvider.credentialFromResult(r)?.idToken')
    expect(body).toContain('shouldTryMicrosoftTrust(')
  })
  it('the verification email waits while the trust attempt runs', () => {
    const at = src.indexOf('Firebase sends its own verification email')
    const effect = src.slice(at, src.indexOf('sendEmailVerification(user)', at))
    expect(effect).toMatch(/if \(!user \|\| !to \|\| user\.emailVerified \|\| linking \|\| trusting/)
    expect(src).toMatch(/\}, \[user, to, linking, trusting, emailBusy\]\)/)
  })
  it('posts the Microsoft ID token with the Firebase token as Bearer, then reloads and refreshes on yes', () => {
    const body = fn('async function trustMicrosoftEmail(')
    expect(body).toContain("fetch('/api/artifact-trust-microsoft'")
    expect(body).toContain('authorization: `Bearer ${await u.getIdToken()}`')
    expect(body).toContain('JSON.stringify({ idToken: microsoftIdToken })')
    expect(body.indexOf('u.reload()')).toBeLessThan(body.indexOf('u.getIdToken(true)'))
  })
  it('the route marks a user verified only through the tested decision, and logs nothing', () => {
    expect(route).toContain('trustMicrosoftEmail(')
    expect(route).toContain('updateUser(uid, { emailVerified: true })')
    expect(route).toContain('tenant.localSignIn?.microsoftClientId')
    expect(route).not.toMatch(/console\./)
  })
})

describe('the email link door', () => {
  it('sends a link that opens in the app and returns to this page with the page asked for', () => {
    const body = fn('async function sendEmailLink(')
    expect(body).toContain('sendSignInLinkToEmail(auth(), email, { url: emailLinkContinueUrl(siteUrl, to), handleCodeInApp: true })')
    expect(body.indexOf('storeLinkEmail(email)')).toBeGreaterThan(body.indexOf('sendSignInLinkToEmail('))
  })
  it('finishes a returned link before the account is watched, and asks for the address when none is kept', () => {
    const at = src.indexOf('isSignInWithEmailLink(auth(), window.location.href)')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(src.indexOf('onAuthStateChanged(auth(), setUser)'))
    expect(src.slice(at, at + 200)).toContain("setEmailStage('ask')")
    expect(fn('async function finishEmailLink(')).toContain('signInWithEmailLink(auth(), email.trim(), window.location.href)')
  })
  it('keeps the Google and Microsoft buttons and the verify-link fallback', () => {
    expect(src).toContain('sendEmailVerification(user)')
    expect(src).toContain('continueAfterVerify')
    expect(src).toContain('signInWithPopup(auth(), popupProvider(id))')
  })
})
