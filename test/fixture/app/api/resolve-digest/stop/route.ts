import { digests } from '../../../../routes'
export const dynamic = 'force-dynamic'
export function GET(request: Request) { return digests.STOP(request) }
export function POST(request: Request) { return digests.STOP(request) }
