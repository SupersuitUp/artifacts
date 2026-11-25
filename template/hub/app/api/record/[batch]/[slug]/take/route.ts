import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ batch: string; slug: string }> }

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest, ctx: Ctx) {
  return hubRoutes().RECORD_TAKE(request, ctx)
}
export function POST(request: NextRequest, ctx: Ctx) {
  return hubRoutes().RECORD_TAKE(request, ctx)
}
export function PUT(request: NextRequest, ctx: Ctx) {
  return hubRoutes().RECORD_TAKE(request, ctx)
}
