// GET /frapp/font: the pack's display face, the same bytes its share card is set in, so the door
// (plain HTML, no next/font) can wear it. Same-origin only by the door's CSP (font-src 'self').
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'

export async function GET() {
  const pack = hubTenant().pack
  if (!pack.share?.font) return new Response(null, { status: 404 })
  const f = await pack.share.font()
  return new Response(f.data, { headers: { 'content-type': 'font/ttf', 'cache-control': 'public, max-age=86400' } })
}
