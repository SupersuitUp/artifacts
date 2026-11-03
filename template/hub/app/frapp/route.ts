// GET /frapp: the door every texted tile app link opens first, on the operator's own hub and in its
// own brand pack. See src/lib/frapp-door.mjs.
//
// The tailnet target rides in the URL FRAGMENT, which the browser never sends, so this handler
// cannot see, log or store a key even by accident. It reads only `?k=` (a kind from a closed
// list) and `?t=` (the page title), so the share card can say what is being sent.
import { doorHtml } from '@/lib/frapp-door.mjs'
import { DOOR_CSP, doorTheme } from '@/lib/frapp-door-theme'
import { hubTenant } from '@/tenant'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const tenant = hubTenant()
  const url = new URL(req.url)
  const html = doorHtml({ origin: tenant.siteUrl, kind: url.searchParams.get('k'), title: url.searchParams.get('t'), theme: doorTheme(tenant) })
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': DOOR_CSP,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'public, max-age=300',
    },
  })
}
