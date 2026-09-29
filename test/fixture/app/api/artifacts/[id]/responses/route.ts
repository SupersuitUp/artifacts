import type { NextRequest } from 'next/server'
import { artifacts } from '../../../../../routes'
type Ctx = { params: Promise<{ id: string }> }
export function GET(request: NextRequest, ctx: Ctx) { return artifacts.RESPONSES(request, ctx) }
export function DELETE(request: NextRequest, ctx: Ctx) { return artifacts.RESPONSES(request, ctx) }
