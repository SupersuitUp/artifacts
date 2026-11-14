// GET /api/shelves?as=<email>: exactly what that reader's "Shared with you" home lists. The publish key or the
// owner signed in; what `hub shelves --as` asks.
import { hubRoutes } from '@/lib/routes'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  return hubRoutes().SHELVES(request)
}
