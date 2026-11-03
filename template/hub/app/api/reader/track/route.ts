import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

export function POST(request: NextRequest) {
  return hubRoutes().TRACK(request)
}
