import type { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/firebase-admin'
import { microsoftKeys, trustMicrosoftEmail, verifyMicrosoftIdToken } from '@/lib/microsoft-trust'
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Microsoft's signing keys, cached across requests in this instance.
const keys = microsoftKeys({ fetch: (url) => fetch(url) })

// Trust a reader's Microsoft work email without the emailed link, when Microsoft's own ID token says
// the tenant verified the email's domain (src/lib/microsoft-trust.ts holds every check). The sign-in
// page calls this right after a Microsoft popup, with the Firebase ID token as Bearer and Microsoft's
// ID token in the body. Any refusal changes nothing, and the page sends Firebase's verification email
// instead. No token is ever logged.
export async function POST(request: NextRequest) {
  const tenant = hubTenant()
  const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null
  const r = await trustMicrosoftEmail({
    clientId: tenant.localSignIn?.microsoftClientId,
    authorization: request.headers.get('authorization'),
    microsoftIdToken: body?.idToken,
    verifyFirebase: async (t) => {
      const d = await getAdminAuth().verifyIdToken(t)
      return { uid: d.uid, email: d.email, emailVerified: d.email_verified === true, signInProvider: d.firebase?.sign_in_provider }
    },
    verifyMicrosoft: (t) => verifyMicrosoftIdToken(t, keys),
    markVerified: async (uid) => { await getAdminAuth().updateUser(uid, { emailVerified: true }) },
  })
  return r.ok
    ? Response.json({ ok: true, changed: r.changed }, { headers: { 'cache-control': 'no-store' } })
    : Response.json({ error: r.reason }, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
