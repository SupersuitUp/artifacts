import type { NextRequest } from 'next/server'
import { artifacts } from '../../../../../routes'
type Ctx = { params: Promise<{ id: string }> }
export function GET(request: NextRequest, ctx: Ctx) { return artifacts.STATE_GET(request, ctx) }
export function POST(request: NextRequest, ctx: Ctx) { return artifacts.STATE_POST(request, ctx) }
