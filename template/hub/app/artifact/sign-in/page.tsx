import { notFound } from 'next/navigation'
import { hubTenant } from '@/tenant'
import { SignIn } from './sign-in'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in', robots: { index: false, follow: false } }

// The sign-in a private page's door links to: Google, against the hub's own Firebase project.
export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string; switch?: string }> }) {
  const tenant = hubTenant()
  if (!tenant.localSignIn) notFound()
  const { to, switch: sw } = await searchParams
  // Only a page on this host: `to` arrives as a full URL from the door.
  let path: string | null = null
  try {
    const u = new URL(to ?? '')
    if (u.origin === tenant.siteUrl && /^\/[a-z0-9]{8}$/.test(u.pathname)) path = u.pathname
  } catch {}
  const { pack } = tenant
  return (
    <main style={{ background: pack.ground, color: pack.ink, minHeight: '100vh', fontFamily: pack.type.body }}>
      <div style={{ maxWidth: '26rem', margin: '0 auto', padding: '18vh 1.5rem 4rem', textAlign: 'center' }}>
        <p style={{ fontSize: '.75rem', letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.6 }}>{pack.kicker}</p>
        <h1 style={{ fontFamily: pack.type.display, fontSize: '1.9rem', margin: '.6rem 0 1rem' }}>Open a private page</h1>
        <SignIn firebase={tenant.localSignIn.firebase} to={path} accent={pack.accent} ground={pack.ground} switchAccount={sw === '1'} providers={['google']} />
      </div>
    </main>
  )
}
