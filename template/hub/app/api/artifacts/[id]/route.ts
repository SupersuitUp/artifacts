import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ id: string }> }

export function GET(request: NextRequest, ctx: Ctx) {
  return hubRoutes().GET(request, ctx)
}

export function DELETE(request: NextRequest, ctx: Ctx) {
  return hubRoutes().DELETE(request, ctx)
}
