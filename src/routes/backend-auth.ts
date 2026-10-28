// A host whose cloud credential is refused (a workload identity provider trusting another
// issuer, a revoked or missing service account key) fails every Firestore call. Unhandled, each
// route then answers a bare 500 that a publisher reads as "something broke" and a client hint
// can only guess at (on 2026-10-28 it guessed "a missing index"). This turns that one cause into
// a typed 503 the publisher can name, and leaves every other error exactly as it was.
import { NextResponse } from 'next/server'

const AUTH_MESSAGE = /invalid_grant|Getting metadata from plugin failed|Could not load the default credentials|UNAUTHENTICATED|Request had invalid authentication credentials/i

/** True when an error is the host failing to authenticate to its own backend. */
export function isBackendAuthError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if ((e as { code?: unknown }).code === 16) return true // gRPC UNAUTHENTICATED
  return AUTH_MESSAGE.test(e.message)
}

export const BACKEND_AUTH_MESSAGE =
  "This host could not sign in to its database, so nothing was read or saved. Its owner should check the host's cloud credentials (the workload identity provider's issuer and audience, or the service account key)."

export function backendAuthResponse(): NextResponse {
  return NextResponse.json({ error: 'backend-auth', message: BACKEND_AUTH_MESSAGE }, { status: 503, headers: { 'cache-control': 'no-store' } })
}

/** Wrap a route handler so a backend credential failure answers the typed 503. */
export function guardBackendAuth<A extends unknown[], R>(handler: (...args: A) => R | Promise<R>): (...args: A) => Promise<R | NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (e) {
      if (!isBackendAuthError(e)) throw e
      console.error('[artifacts] backend credential refused:', e)
      return backendAuthResponse()
    }
  }
}

/** Every route handler in a route table (its UPPER_CASE functions) gets the guard. */
export function guardRouteTable<T extends Record<string, unknown>>(table: T): T {
  const out: Record<string, unknown> = { ...table }
  for (const [k, v] of Object.entries(table)) {
    if (typeof v === 'function' && /^[A-Z][A-Z0-9_]*$/.test(k)) out[k] = guardBackendAuth(v as (...a: unknown[]) => unknown)
  }
  return out as T
}
