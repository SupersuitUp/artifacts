import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'
import { healthOf } from '@/lib/health'

export const dynamic = 'force-dynamic'

// Whether this hub's queries will be served, the comments feed's Firestore index first. No key.
export function GET(request: NextRequest) {
  return healthOf(hubRoutes(), request)
}
