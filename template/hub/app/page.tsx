// The hub's home. For its owner or an admin signed in it is their dashboard (the shell's HubHome: the Artifacts tile
// over the whole hub, every page listed). Everyone else is shared pages by link, so this says whose pages these are
// and stops.
import { BrandGround, BrandMark } from '@supersuit/artifacts/brand'
import { hubTenant } from '@/tenant'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

export default async function Home({ searchParams }: Props) {
  const t = hubTenant()
  const owner = t.configured ? await hubRoutes().HubHome({ searchParams }) : null
  if (owner) return owner
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
