'use client'
import { useEffect, useRef, useState } from 'react'
import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, OAuthProvider, linkWithCredential, onAuthStateChanged, sendEmailVerification, signInWithPopup, signOut,
  isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink,
  type AuthCredential, type AuthError, type User,
} from 'firebase/auth'
import {
  providersFor, shouldLink, shouldSendVerification, signInOutcome, SIGN_IN_WORDS, isPopupProvider, shouldTryMicrosoftTrust,
  emailLinkContinueUrl, looksLikeEmail, EMAIL_LINK_STORAGE_KEY, type SignInProviderId,
} from '@supersuit/artifacts'
import type { FirebaseWebConfig } from '@/tenant'

const NAME = 'artifacts'
const VERIFY_KEY = (uid: string) => `artifact-verify:${uid}`

// The verification email goes out at most once per account on this browser. The set stops a second
// send within this page while one is in flight; the storage flag is written only after Firebase
// accepted the send, so a failed send never makes a later visit say a link went out.
const sendingHere = new Set<string>()
function verificationSentBefore(uid: string): boolean {
  try { return localStorage.getItem(VERIFY_KEY(uid)) === '1' } catch { return false }
}
function rememberVerificationSent(uid: string) {
  try { localStorage.setItem(VERIFY_KEY(uid), '1') } catch { /* storage off: this page's set holds it */ }
}

// The address an emailed sign-in link went to, kept so the return finishes on this device.
function storedLinkEmail(): string | null {
  try { return localStorage.getItem(EMAIL_LINK_STORAGE_KEY) } catch { return null }
}
function storeLinkEmail(email: string | null) {
  try { email ? localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email) : localStorage.removeItem(EMAIL_LINK_STORAGE_KEY) } catch { /* storage off: the return asks for it */ }
}

function popupProvider(id: 'google' | 'microsoft') {
  const p = id === 'google' ? new GoogleAuthProvider() : new OAuthProvider('microsoft.com')
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

type Failure = { code: string; other: SignInProviderId | null }
// The email link door: idle (the form), sending, sent (check your email), ask (the link came back
// with no address kept on this device), finishing (signing in with the link).
type EmailStage = 'idle' | 'sending' | 'sent' | 'ask' | 'finishing'

export function SignIn({ firebase, to, siteUrl, accent, ground, switchAccount = false, providers, trustMicrosoft = false }: { firebase: FirebaseWebConfig; to: string | null; siteUrl: string; accent: string; ground: string; switchAccount?: boolean; providers: SignInProviderId[]; trustMicrosoft?: boolean }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [state, setState] = useState<'idle' | 'working' | 'unverified' | 'error'>('idle')
  const [failure, setFailure] = useState<Failure | null>(null)
  // The credential of a sign-in refused because the email already has an account with the other
  // provider. It is linked only after the reader signs in with that provider: one email, one reader.
  const pending = useRef<{ credential: AuthCredential; email: string | null } | null>(null)
  const [linking, setLinking] = useState(false)
  // For an unverified email: whether the email went out on an earlier visit, read once per user.
  const [verify, setVerify] = useState<{ uid: string; sentBefore: boolean; ready: boolean } | null>(null)
  const [, rerender] = useState(0)
  // True from just before a Microsoft popup until the hub has answered whether it trusts the email
  // (its tenant verified the domain). Firebase's verification email waits for that answer, so a reader
  // the hub trusts is never sent a link they do not need.
  const [trusting, setTrusting] = useState(false)
  const [emailStage, setEmailStage] = useState<EmailStage>('idle')
  const [emailValue, setEmailValue] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const auth = () => getAuth(getApps().some(a => a.name === NAME) ? getApp(NAME) : initializeApp(firebase, NAME))
  const enabled = providersFor(providers)
  const popups = enabled.filter((p) => isPopupProvider(p.id))
  const emailOn = enabled.some((p) => p.id === 'email')
  const emailBusy = emailStage === 'ask' || emailStage === 'finishing'

  // The returned link's own parameters come off the address, so a reload never reuses a spent link.
  function dropLinkFromAddress() {
    try {
      const u = new URL(window.location.href)
      for (const k of ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId']) u.searchParams.delete(k)
      window.history.replaceState(null, '', u.toString())
    } catch { /* leave it */ }
  }

  async function finishEmailLink(email: string) {
    setEmailStage('finishing')
    setEmailError(null)
    try {
      await signInWithEmailLink(auth(), email.trim(), window.location.href)
      storeLinkEmail(null)
      setEmailStage('idle')
    } catch {
      setEmailError(SIGN_IN_WORDS.emailLinkFailed)
      setEmailStage('idle')
    }
    dropLinkFromAddress()
  }

  // `switch=1` from the page's "Use a different account": forget the account this host holds
  // BEFORE watching it, or it would vouch for the same one again and the reader could never change.
  useEffect(() => {
    let off = () => {}
    let live = true
    ;(switchAccount ? signOut(auth()).catch(() => {}) : Promise.resolve()).then(async () => {
      if (!live) return
      // A returned sign-in link finishes before the account is watched, so a reader already signed in
      // on this browser is never opened as the old account. Email link users are verified.
      if (emailOn && isSignInWithEmailLink(auth(), window.location.href)) {
        const email = storedLinkEmail()
        if (email) await finishEmailLink(email)
        else setEmailStage('ask')
      }
      if (live) off = onAuthStateChanged(auth(), setUser)
    })
    return () => { live = false; off() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const outcome = user
    ? signInOutcome({
        user: { email: user.email, emailVerified: user.emailVerified, providerId: user.providerData[0]?.providerId ?? user.providerId },
        verificationSent: verify?.uid === user.uid ? verify.sentBefore : false,
      })
    : null

  async function openPage(u: User) {
    setState('working')
    try {
      // Always a fresh token: after the reader taps the verification link and reloads, the cached
      // token still says email_verified: false, and the pass route would refuse a verified reader.
      const res = await fetch(`/api/artifact-pass?to=${encodeURIComponent(to ?? '')}`, { headers: { authorization: `Bearer ${await u.getIdToken(true)}` } })
      const d = await res.json().catch(() => ({}))
      if (res.ok && typeof d.url === 'string') { window.location.replace(d.url); return }
      setState(res.status === 403 ? 'unverified' : 'error')
    } catch { setState('error') }
  }

  // A verified email: the pass request, as before. It waits while a pending credential is linked.
  useEffect(() => {
    if (!user || !to || state !== 'idle' || linking || trusting || emailBusy || !outcome || outcome.show !== 'open') return
    void openPage(user)
    // `state` stays OUT of the deps: openPage sets it to 'working' itself, and the page would
    // otherwise sit on "Opening…" or ask twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, to, linking, trusting, emailBusy, outcome?.show])

  // An unverified email: Firebase sends its own verification email, once per account on this browser,
  // and only when there is a page to open. It waits while the hub decides whether it trusts a
  // Microsoft email, and runs only if the hub declined.
  useEffect(() => {
    if (!user || !to || user.emailVerified || linking || trusting || emailBusy || verify?.uid === user.uid) return
    const sentBefore = verificationSentBefore(user.uid) || sendingHere.has(user.uid)
    if (!shouldSendVerification({ hasPage: !!to, email: user.email, emailVerified: user.emailVerified, sentBefore })) {
      if (user.email) setVerify({ uid: user.uid, sentBefore: true, ready: true })
      return
    }
    setVerify({ uid: user.uid, sentBefore: false, ready: false })
    sendingHere.add(user.uid)
    sendEmailVerification(user)
      .then(() => { rememberVerificationSent(user.uid); setVerify({ uid: user.uid, sentBefore: false, ready: true }) })
      .catch(() => { sendingHere.delete(user.uid); setState('error') })
  }, [user, to, linking, trusting, emailBusy]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ask the hub to trust a Microsoft email whose domain the tenant verified. On yes, the account is
  // reloaded and its token refreshed, so the page opens with no link. Any failure is silent: the
  // verification email runs as before.
  async function trustMicrosoftEmail(u: User, microsoftIdToken: string) {
    try {
      const res = await fetch('/api/artifact-trust-microsoft', {
        method: 'POST',
        headers: { authorization: `Bearer ${await u.getIdToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: microsoftIdToken }),
      })
      if (!res.ok) return
      await u.reload()
      await u.getIdToken(true)
      rerender((n) => n + 1)
    } catch { /* declined: the link flow runs */ }
  }

  async function signInWith(id: 'google' | 'microsoft') {
    setFailure(null)
    setState('idle')
    if (pending.current) setLinking(true)
    // Set BEFORE the popup: Firebase reports the new account before the popup's promise resolves,
    // and the verification email must not go out ahead of the trust answer.
    const mayTrust = id === 'microsoft' && trustMicrosoft
    if (mayTrust) setTrusting(true)
    try {
      const r = await signInWithPopup(auth(), popupProvider(id))
      const held = pending.current
      pending.current = null
      // Link only to the account that owns the refused email; any other account drops it unlinked.
      if (held && shouldLink(held.email, r.user.email)) await linkWithCredential(r.user, held.credential).catch(() => {})
      const microsoftIdToken = id === 'microsoft' ? OAuthProvider.credentialFromResult(r)?.idToken : undefined
      if (shouldTryMicrosoftTrust({ providerId: id, emailVerified: r.user.emailVerified, hasMicrosoftIdToken: !!microsoftIdToken, trustOn: trustMicrosoft })) {
        await trustMicrosoftEmail(r.user, microsoftIdToken!)
      }
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'unknown'
      // A failed outcome never carries an older credential forward.
      pending.current = null
      if (code === 'auth/account-exists-with-different-credential') {
        const credential = (id === 'google' ? GoogleAuthProvider.credentialFromError(e as never) : OAuthProvider.credentialFromError(e as never)) ?? null
        const email = (e as AuthError).customData?.email ?? null
        if (credential) pending.current = { credential, email }
      }
      setFailure({ code, other: popups.find((p) => p.id !== id)?.id ?? null })
    } finally {
      setLinking(false)
      setTrusting(false)
    }
  }

  async function sendEmailLink() {
    const email = emailValue.trim()
    setEmailError(null)
    if (!looksLikeEmail(email)) { setEmailError(SIGN_IN_WORDS.emailNotAnAddress); return }
    if (!to) return
    setEmailStage('sending')
    try {
      await sendSignInLinkToEmail(auth(), email, { url: emailLinkContinueUrl(siteUrl, to), handleCodeInApp: true })
      storeLinkEmail(email)
      setSentTo(email)
      setEmailStage('sent')
    } catch {
      setEmailError(SIGN_IN_WORDS.emailSendFailed)
      setEmailStage('idle')
    }
  }

  async function continueAfterVerify() {
    if (!user) return
    setState('working')
    try {
      await user.reload()
      await user.getIdToken(true)
    } catch { setState('error'); return }
    rerender((n) => n + 1)
    if (user.emailVerified) await openPage(user)
    else setState('idle')
  }

  const button = { background: accent, color: ground, border: 0, borderRadius: '.6rem', padding: '.65rem 1.3rem', fontSize: '.95rem', cursor: 'pointer' }
  const buttons = (ids: SignInProviderId[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
      {popups.filter((p) => ids.includes(p.id)).map((p) => (
        <button key={p.id} style={button} onClick={() => { void signInWith(p.id as 'google' | 'microsoft') }}>{p.button}</button>
      ))}
    </div>
  )
  const input = { width: '100%', maxWidth: '20rem', padding: '.6rem .8rem', borderRadius: '.6rem', border: `1px solid ${accent}`, background: 'transparent', color: 'inherit', fontSize: '.95rem' }
  const emailForm = (label: string, onSubmit: () => void) => (
    <form style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.75rem', marginTop: popups.length ? '1.6rem' : 0 }}
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
      <input type="email" autoComplete="email" inputMode="email" required aria-label={SIGN_IN_WORDS.emailLabel} placeholder={SIGN_IN_WORDS.emailLabel}
        value={emailValue} onChange={(e) => setEmailValue(e.target.value)} style={input} />
      <button type="submit" style={button} disabled={emailStage === 'sending'}>{label}</button>
      {emailError && <p style={{ opacity: 0.75, margin: 0 }}>{emailError}</p>}
    </form>
  )
  const emailDoor = () => emailOn && (emailStage === 'sent' && sentTo
    ? <p style={{ opacity: 0.75, marginTop: popups.length ? '1.6rem' : 0 }}>{SIGN_IN_WORDS.emailLinkSent(sentTo)}</p>
    : emailForm(enabled.find((p) => p.id === 'email')!.button, () => { void sendEmailLink() }))
  if (!to) return <p style={{ opacity: 0.7 }}>Nothing to open. Tap the link you were sent, then its sign-in button.</p>
  // The link came back where its address was not kept: ask for it, then finish signing in.
  if (emailStage === 'ask') return (
    <>
      <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>{SIGN_IN_WORDS.emailAskAgain}</p>
      {emailForm('Continue', () => {
        if (!looksLikeEmail(emailValue)) { setEmailError(SIGN_IN_WORDS.emailNotAnAddress); return }
        void finishEmailLink(emailValue)
      })}
    </>
  )
  if (user === undefined || linking || trusting || emailStage === 'finishing') return <p style={{ opacity: 0.6 }}>…</p>
  if (!user) {
    const said = failure ? signInOutcome({ user: null, errorCode: failure.code, otherProvider: failure.other }) : null
    if (said?.show === 'use-other' && failure?.other) return (
      <>
        <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>{said.words}</p>
        {buttons([failure.other])}
      </>
    )
    return (
      <>
        <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>{said?.show === 'blocked' ? said.words : SIGN_IN_WORDS.ask}</p>
        {popups.length > 0 && buttons(popups.map((p) => p.id))}
        {said?.show === 'failed' && <p style={{ opacity: 0.7, marginTop: '1rem' }}>{said.words}</p>}
        {emailDoor()}
      </>
    )
  }
  // A refused pass is never a dead end: the reader may still have a link to tap, and Continue reloads
  // the account and refreshes its token before it asks again.
  if (state === 'unverified') return user.email ? (
    <>
      <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>{SIGN_IN_WORDS.verifyThenContinue(user.email)}</p>
      <button style={button} onClick={() => { void continueAfterVerify() }}>Continue</button>
    </>
  ) : <p style={{ opacity: 0.75 }}>{SIGN_IN_WORDS.noEmail}</p>
  if (state === 'error') return <p style={{ opacity: 0.75 }}>{SIGN_IN_WORDS.signedInNotOpened(user.email)}</p>
  if (outcome?.show === 'failed') return <p style={{ opacity: 0.75 }}>{outcome.words}</p>
  if (outcome?.show === 'verify' || outcome?.show === 'sent') {
    if (verify?.uid !== user.uid || !verify.ready) return <p style={{ opacity: 0.6 }}>…</p>
    return (
      <>
        <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>{outcome.words}</p>
        <button style={button} disabled={state === 'working'} onClick={() => { void continueAfterVerify() }}>Continue</button>
      </>
    )
  }
  return <p style={{ opacity: 0.6 }}>Opening…</p>
}
