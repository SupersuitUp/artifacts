// GET /brand.json: the colours this hub renders its everyday pages in (src/lib/brand-colors.ts).
// Public on purpose: it is three colours any page on the hub already shows.
import { brandColors } from '@/lib/brand-colors'
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(brandColors(hubTenant().pack), { headers: { 'cache-control': 'public, max-age=300' } })
}
