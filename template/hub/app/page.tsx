// The hub's home. Pages are shared by link, so there is nothing to list here; this says whose
// pages these are and stops.
import { BrandGround, BrandMark } from '@supersuit/artifacts/brand'
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'

export default function Home() {
  const t = hubTenant()
  return (
    <BrandGround pack={t.pack}>
      <div className="mx-auto max-w-2xl px-6 pt-32 text-center">
        <BrandMark pack={t.pack} className="mx-auto mb-6 block h-14 w-auto text-5xl" />
        <p className="text-[11px] uppercase tracking-[0.3em]" style={{ color: t.pack.accent }}>
          {t.pack.kicker}
        </p>
        <h1 className="mt-4 text-3xl" style={{ fontFamily: t.pack.type.display }}>
          {t.configured ? `Pages ${t.owner ?? t.pack.name} shares by link` : 'This hub is not configured yet'}
        </h1>
        <p className="mt-4 opacity-70">
          {t.configured ? 'If you were sent one, the link takes you straight to it.' : 'Its setup sets HUB_TENANT when it deploys it.'}
        </p>
      </div>
    </BrandGround>
  )
}
