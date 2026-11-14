// The hub's home, one page for everyone, filtered by who is signed in. The owner or an admin gets their dashboard
// (the shell's HubHome: the Artifacts tile over the whole hub, every page listed), or with ?as=<email> exactly what
// that person sees. Any other reader signed in gets "Shared with you" (the shell's ReaderHome: the pages the hub's own
// access rule opens for them, on the hub's shelves). A visitor signed out gets this door.
import { BrandGround, BrandMark } from '@supersuit/artifacts/brand'
import { hubTenant } from '@/tenant'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

export default async function Home({ searchParams }: Props) {
  const t = hubTenant()
  const home = t.configured
    ? ((await hubRoutes().ReaderHome({ searchParams })) ?? (await hubRoutes().HubHome({ searchParams })))
    : null
  if (home) return home
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
          {t.configured ? 'If you were sent one, the link takes you straight to it. Signed in, this page lists every page shared with you.' : 'Its setup sets HUB_TENANT when it deploys it.'}
        </p>
      </div>
    </BrandGround>
  )
}
