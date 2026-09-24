import type { NextRequest } from 'next/server'
import { artifacts } from '../../../routes'
export const dynamic = 'force-dynamic'
export function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return artifacts.SHARE_IMAGE(request, ctx)
}
