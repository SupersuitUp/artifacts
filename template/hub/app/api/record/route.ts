import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export function POST(request: NextRequest) {
  return hubRoutes().RECORD(request)
}
