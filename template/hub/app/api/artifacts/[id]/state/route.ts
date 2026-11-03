import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest, ctx: Ctx) {
  return hubRoutes().STATE_GET(request, ctx)
}

export function POST(request: NextRequest, ctx: Ctx) {
  return hubRoutes().STATE_POST(request, ctx)
}
