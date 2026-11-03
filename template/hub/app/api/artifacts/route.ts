import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function POST(request: NextRequest) {
  return hubRoutes().POST(request)
}

export function GET(request: NextRequest) {
  return hubRoutes().LIST(request)
}
