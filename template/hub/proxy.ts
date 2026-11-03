// Ahead of a page: a per-reader link that was revoked, or whose broadcast passed its date, answers
// 410 Gone with the same quiet words the page shows, so preview services and crawlers drop it.
//
// Only a request carrying a reader's link (`?r=`) or its cookie (`artifact_r_<id>`) can be shut, so
// that cheap check runs first and loads nothing. A store that fails to answer never costs a reader
// the page: the page itself refuses a shut link.
import { NextResponse, type NextRequest } from 'next/server'

const RID_COOKIE = 'artifact_r_'

export async function proxy(request: NextRequest) {
  const carriesLink = request.nextUrl.searchParams.has('r') || request.cookies.getAll().some((c) => c.name.startsWith(RID_COOKIE))
  if (!carriesLink) return NextResponse.next()
  try {
    const { hubRoutes } = await import('@/lib/routes')
    const shut = await hubRoutes().shutPageResponse(request)
    if (shut) return shut
  } catch {
    // Fall through to the page, which applies the same gate.
  }
  return NextResponse.next()
}

export const config = { matcher: ['/:id([a-z0-9]{8})'] }
