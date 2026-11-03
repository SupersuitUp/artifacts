import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  return hubRoutes().ENTER(request)
}
