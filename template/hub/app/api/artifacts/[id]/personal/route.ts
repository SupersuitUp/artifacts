import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest, ctx: Ctx) {
  return hubRoutes().PERSONAL_GET(request, ctx)
}

export function POST(request: NextRequest, ctx: Ctx) {
  return hubRoutes().PERSONAL_POST(request, ctx)
}

export function DELETE(request: NextRequest, ctx: Ctx) {
  return hubRoutes().PERSONAL_DELETE(request, ctx)
}
