import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ id: string; name: string }> }

export const maxDuration = 60

export function PUT(request: NextRequest, ctx: Ctx) {
  return hubRoutes().PUT_ASSET(request, ctx)
}
