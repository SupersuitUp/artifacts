import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function GET(request: NextRequest) {
  return hubRoutes().ACTIVITY(request)
}
