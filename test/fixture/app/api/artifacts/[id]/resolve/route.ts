import type { NextRequest } from 'next/server'
import { artifacts } from '../../../../../routes'
type Ctx = { params: Promise<{ id: string }> }
export const dynamic = 'force-dynamic'
export function POST(request: NextRequest, ctx: Ctx) { return artifacts.RESOLVE(request, ctx) }
