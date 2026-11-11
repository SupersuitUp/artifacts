import type { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { localPass } from '@/lib/local-sign-in'
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The pass for a reader who signed in on this host (app/artifact/sign-in).
export async function GET(request: NextRequest) {
  const r = await localPass({
    tenant: hubTenant(),
    to: request.nextUrl.searchParams.get('to'),
    authorization: request.headers.get('authorization'),
    verify: async (t) => {
      const d = await getAdminAuth().verifyIdToken(t)
      return { uid: d.uid, email: d.email, emailVerified: d.email_verified === true, name: typeof d.name === 'string' ? d.name : undefined, claims: d as unknown as Record<string, unknown> }
    },
    // Finished sign-ins by provider, one document a month. A pass only, so a failed sign-in never counts.
    count: async (p) => { await getAdminDb().doc(`signInCounts/${new Date().toISOString().slice(0, 7)}`).set({ [p]: FieldValue.increment(1) }, { merge: true }) },
    secret: process.env.ARTIFACT_PASS_SECRET,
  })
  return r.ok
    ? Response.json({ url: r.url }, { headers: { 'cache-control': 'no-store' } })
    : Response.json({ error: r.error }, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
