'use client'
import { useEffect, useRef, useState } from 'react'
import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, OAuthProvider, linkWithCredential, onAuthStateChanged, sendEmailVerification, signInWithPopup, signOut,
  type AuthCredential, type AuthError, type User,
} from 'firebase/auth'
import { providersFor, shouldLink, shouldSendVerification, signInOutcome, SIGN_IN_WORDS, type SignInProviderId } from '@supersuit/artifacts'
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

function popupProvider(id: SignInProviderId) {
  const p = id === 'google' ? new GoogleAuthProvider() : new OAuthProvider('microsoft.com')
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

type Failure = { code: string; other: SignInProviderId | null }

export function SignIn({ firebase, to, accent, ground, switchAccount = false, providers }: { firebase: FirebaseWebConfig; to: string | null; accent: string; ground: string; switchAccount?: boolean; providers: SignInProviderId[] }) {
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
  const auth = () => getAuth(getApps().some(a => a.name === NAME) ? getApp(NAME) : initializeApp(firebase, NAME))
  const enabled = providersFor(providers)

  // `switch=1` from the page's "Use a different account": forget the account this host holds
  // BEFORE watching it, or it would vouch for the same one again and the reader could never change.
  useEffect(() => {
    let off = () => {}
    let live = true
    ;(switchAccount ? signOut(auth()).catch(() => {}) : Promise.resolve()).then(() => {
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
      const res = await fetch(`/api/artifact-pass?to=${encodeURIComponent(to ?? '')}`, { headers: { authorization: `Bearer ${await u.getIdToken()}` } })
      const d = await res.json().catch(() => ({}))
      if (res.ok && typeof d.url === 'string') { window.location.replace(d.url); return }
      setState(res.status === 403 ? 'unverified' : 'error')
    } catch { setState('error') }
  }

  // A verified email: the pass request, as before. It waits while a pending credential is linked.
  useEffect(() => {
    if (!user || !to || state !== 'idle' || linking || !outcome || outcome.show !== 'open') return
    void openPage(user)
    // `state` stays OUT of the deps: openPage sets it to 'working' itself, and the page would
    // otherwise sit on "Opening…" or ask twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, to, linking, outcome?.show])

  // An unverified email: Firebase sends its own verification email, once per account on this browser,
  // and only when there is a page to open.
  useEffect(() => {
    if (!user || !to || user.emailVerified || linking || verify?.uid === user.uid) return
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
  }, [user, to, linking]) // eslint-disable-line react-hooks/exhaustive-deps

  async function signInWith(id: SignInProviderId) {
    setFailure(null)
    setState('idle')
    if (pending.current) setLinking(true)
    try {
      const r = await signInWithPopup(auth(), popupProvider(id))
      const held = pending.current
      pending.current = null
      // Link only to the account that owns the refused email; any other account drops it unlinked.
      if (held && shouldLink(held.email, r.user.email)) await linkWithCredential(r.user, held.credential).catch(() => {})
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'unknown'
      // A failed outcome never carries an older credential forward.
      pending.current = null
      if (code === 'auth/account-exists-with-different-credential') {
        const credential = (id === 'google' ? GoogleAuthProvider.credentialFromError(e as never) : OAuthProvider.credentialFromError(e as never)) ?? null
        const email = (e as AuthError).customData?.email ?? null
        if (credential) pending.current = { credential, email }
      }
      setFailure({ code, other: enabled.find((p) => p.id !== id)?.id ?? null })
    } finally {
      setLinking(false)
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
      {enabled.filter((p) => ids.includes(p.id)).map((p) => (
        <button key={p.id} style={button} onClick={() => { void signInWith(p.id) }}>{p.button}</button>
      ))}
    </div>
  )
  if (!to) return <p style={{ opacity: 0.7 }}>Nothing to open. Tap the link you were sent, then its sign-in button.</p>
  if (user === undefined || linking) return <p style={{ opacity: 0.6 }}>…</p>
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
        {buttons(enabled.map((p) => p.id))}
        {said?.show === 'failed' && <p style={{ opacity: 0.7, marginTop: '1rem' }}>{said.words}</p>}
      </>
    )
  }
  if (state === 'unverified') return <p style={{ opacity: 0.75 }}>{SIGN_IN_WORDS.notVerified}</p>
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
