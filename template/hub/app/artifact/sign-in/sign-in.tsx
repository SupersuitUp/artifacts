'use client'
import { useEffect, useState } from 'react'
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, OAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { providersFor, SIGN_IN_WORDS, type SignInProviderId } from '@supersuit/artifacts'
import type { FirebaseWebConfig } from '@/tenant'

const NAME = 'artifacts'

export function SignIn({ firebase, to, accent, ground, switchAccount = false, providers }: { firebase: FirebaseWebConfig; to: string | null; accent: string; ground: string; switchAccount?: boolean; providers: SignInProviderId[] }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [state, setState] = useState<'idle' | 'working' | 'unverified' | 'error'>('idle')
  const auth = () => getAuth(getApps().some(a => a.name === NAME) ? getApp(NAME) : initializeApp(firebase, NAME))

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

  useEffect(() => {
    if (!user || !to || state !== 'idle') return
    let live = true
    setState('working')
    ;(async () => {
      try {
        const res = await fetch(`/api/artifact-pass?to=${encodeURIComponent(to)}`, { headers: { authorization: `Bearer ${await user.getIdToken()}` } })
        const d = await res.json().catch(() => ({}))
        if (!live) return
        if (res.ok && typeof d.url === 'string') { window.location.replace(d.url); return }
        setState(res.status === 403 ? 'unverified' : 'error')
      } catch { if (live) setState('error') }
    })()
    return () => { live = false }
    // `state` stays OUT of the deps: setting it to 'working' would re-run this effect, whose
    // cleanup marks the in-flight request dead, and the page would sit on "Opening…" forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, to])

  const button = { background: accent, color: ground, border: 0, borderRadius: '.6rem', padding: '.65rem 1.3rem', fontSize: '.95rem', cursor: 'pointer' }
  if (!to) return <p style={{ opacity: 0.7 }}>Nothing to open. Tap the link you were sent, then its sign-in button.</p>
  if (user === undefined) return <p style={{ opacity: 0.6 }}>…</p>
  if (!user) return (
    <>
      <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>{SIGN_IN_WORDS.ask}</p>
      {providersFor(providers).map((p) => (
        <button key={p.id} style={button} onClick={() => {
          const provider = p.id === 'google' ? new GoogleAuthProvider() : new OAuthProvider(p.firebaseId)
          if (p.id === 'google') provider.setCustomParameters({ prompt: 'select_account' })
          signInWithPopup(auth(), provider).catch(() => setState('error'))
        }}>{p.button}</button>
      ))}
      {state === 'error' && <p style={{ opacity: 0.7, marginTop: '1rem' }}>{SIGN_IN_WORDS.failed}</p>}
    </>
  )
  if (state === 'unverified') return <p style={{ opacity: 0.75 }}>{SIGN_IN_WORDS.notVerified}</p>
  if (state === 'error') return <p style={{ opacity: 0.75 }}>{SIGN_IN_WORDS.signedInNotOpened(user.email ?? 'your account')}</p>
  return <p style={{ opacity: 0.6 }}>Opening…</p>
}
