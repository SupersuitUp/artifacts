// GET /frapp/og?k=<kind>&t=<title>: the share card a texted door link unfurls into, drawn by the
// shell's own share card in the hub's pack. With a title, the kind is the kicker above it.
import { renderShareCard } from '@supersuit/artifacts/brand'
import { doorCard } from '@/lib/frapp-door.mjs'
import { cardPack } from '@/lib/frapp-door-theme'
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const tenant = hubTenant()
  const url = new URL(req.url)
  const card = doorCard(url.searchParams.get('k'), url.searchParams.get('t'))
  if (!tenant.pack.share) return new Response(null, { status: 404 })
  const kicker = card.title ? card.kindTitle : tenant.pack.kicker
  return renderShareCard(cardPack(tenant.id, tenant.pack, kicker), card.heading)
}
