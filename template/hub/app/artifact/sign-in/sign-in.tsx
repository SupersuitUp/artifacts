'use client'
import { useEffect, useState } from 'react'
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import type { FirebaseWebConfig } from '@/tenant'

const NAME = 'artifacts'

export function SignIn({ firebase, to, accent, ground, switchAccount = false }: { firebase: FirebaseWebConfig; to: string | null; accent: string; ground: string; switchAccount?: boolean }) {
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
      <p style={{ opacity: 0.75, marginBottom: '1.4rem' }}>Sign in with the Google account this page was shared with.</p>
      <button style={button} onClick={() => {
        const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' })
        signInWithPopup(auth(), p).catch(() => setState('error'))
      }}>Sign in with Google</button>
      {state === 'error' && <p style={{ opacity: 0.7, marginTop: '1rem' }}>That did not finish. Try again.</p>}
    </>
  )
  if (state === 'unverified') return <p style={{ opacity: 0.75 }}>That Google account has no verified email. Sign in with one that does.</p>
  if (state === 'error') return <p style={{ opacity: 0.75 }}>Signed in as {user.email}, but the page did not open. Reload to try again.</p>
  return <p style={{ opacity: 0.6 }}>Opening…</p>
}
