import { NextResponse, type NextRequest } from 'next/server'
import { digests, sentDigests } from '../../../routes'
export const dynamic = 'force-dynamic'
// The fixture's stand-in for a host's cron: flush as if `ahead` minutes had passed.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const report = await digests.flush({ now: new Date(Date.now() + Number(q.get('ahead') ?? 0) * 60_000), dryRun: q.get('dry') === '1' })
  return NextResponse.json({ report, sent: sentDigests.map((m) => ({ to: m.to, subject: m.subject, text: m.text, idempotencyKey: m.idempotencyKey })) })
}
