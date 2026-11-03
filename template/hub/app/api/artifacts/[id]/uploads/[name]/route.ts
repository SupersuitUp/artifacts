import type { NextRequest } from 'next/server'
import { hubRoutes } from '@/lib/routes'

type Ctx = { params: Promise<{ id: string; name: string }> }

// Big files (narration) skip the function: this signs a URL the publisher PUTs to directly.
export const maxDuration = 30

export function POST(request: NextRequest, ctx: Ctx) {
  return hubRoutes().UPLOAD(request, ctx)
}
