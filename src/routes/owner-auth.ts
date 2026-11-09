// Who may call an owner endpoint: the publish key (an agent's command), OR the owner or an admin of
// this host signed in by the reader grant (the owner's panel on the page). The same check every
// endpoint the panel uses applies, so the panel and the agent can never disagree about a page.
// A change made with the grant must come from this host's own pages, exactly as /settings and
// /resolve require (Origin and Sec-Fetch-Site), and a body must be JSON, which a cross-site form
// cannot send: a form on another site can never delete or unpublish a page.
import { NextResponse, type NextRequest } from 'next/server'
import { GRANT_COOKIE, verifyGrant, type Reader } from '../artifacts/reader.js'

export type OwnerAuth = {
  /** The publish key or a publisher pass. */
  authed: (request: Request) => boolean
  readerSecret: () => string | undefined
  /** The owner or one of this host's admins. */
  isAdmin: (reader: Reader | null) => boolean
  siteUrl: string
}

/** Null when the caller may go on; otherwise the refusal to answer with. `write`: the call changes
 *  something, so a grant must come from this host's own pages. `json`: it carries a body, which
 *  with a grant must be sent as JSON. The publish key is never held to either: it is not a cookie
 *  a browser sends on its own. */
export function keyOrOwner(request: NextRequest, auth: OwnerAuth, opts: { write?: boolean; json?: boolean } = {}): NextResponse | null {
  if (auth.authed(request)) return null
  const no = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
  const reader = verifyGrant(auth.readerSecret(), request.cookies.get(GRANT_COOKIE)?.value)
  if (!reader) return no('Unauthorized: send the publish key, or sign in as the owner', 401)
  if (!auth.isAdmin(reader)) return no('only the owner and this hub\'s admins', 403)
  if (opts.write) {
    const origin = request.headers.get('origin')
    const site = request.headers.get('sec-fetch-site')
    if ((origin !== null && origin !== new URL(auth.siteUrl).origin) || (site !== null && site !== 'same-origin')) return no('wrong origin', 403)
    if (opts.json && !/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return no('send JSON', 415)
  }
  return null
}
