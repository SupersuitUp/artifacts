// Who may publish. The site gate lets the artifacts API through precisely because the
// Authorization header is the whole authorization.
import { verifyPublisherPass } from './publisher.js'

/** The Bearer is exactly this instance's publish key. */
export function isPublishAuthed(request: Request, key: string | undefined): boolean {
  if (!key) return false
  const h = request.headers.get('authorization') ?? ''
  return h === `Bearer ${key}`
}

export type PublishAuth = {
  /** The tenant's shared publish key. Read at request time. */
  publishKey: () => string | undefined
  /** Verifies publisher passes. Absent, or returning nothing, means passes are refused. */
  publisherSecret?: () => string | undefined
  /** The hostname a pass must name (`h`), e.g. artifacts.example.com. Absent means passes are refused. */
  publisherHost?: string
}

/** Every publish-key route's check: the tenant key, OR a valid publisher pass for this host
 *  when the host opted in. A host that configures neither pass field behaves exactly as before. */
export function isPublisherAuthed(request: Request, auth: PublishAuth, now = Date.now()): boolean {
  if (isPublishAuthed(request, auth.publishKey())) return true
  if (!auth.publisherHost || !auth.publisherSecret) return false
  const h = request.headers.get('authorization') ?? ''
  if (!h.startsWith('Bearer ')) return false
  return verifyPublisherPass(auth.publisherSecret(), h.slice(7).trim(), auth.publisherHost, now) !== null
}
