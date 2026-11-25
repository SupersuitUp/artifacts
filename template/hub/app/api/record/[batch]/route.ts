import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ batch: string }> }

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest, ctx: Ctx) {
  return hubRoutes().RECORD_BATCH(request, ctx)
}
