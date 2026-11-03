// GET /api/health: the shell's HEALTH, which runs the comments feed's query and names a missing
// Firestore index. Every answer also carries `door`, the tile app door version this deploy serves
// (DOOR_VERSION): Supersuit sends a hosted Helm link through the door only when the hub says it
// follows one.
import { NextResponse, type NextRequest } from 'next/server'
import { DOOR_VERSION } from './frapp-door.mjs'

type Handler = (req: NextRequest) => Promise<Response> | Response

async function withDoor(res: Response): Promise<Response> {
  let body: unknown
  try { body = await res.clone().json() } catch { return res }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  return NextResponse.json({ ...(body as object), door: DOOR_VERSION }, { status: res.status, headers })
}

export async function healthOf(routes: object, req: NextRequest): Promise<Response> {
  const HEALTH = (routes as { HEALTH?: Handler }).HEALTH
  if (typeof HEALTH === 'function') return withDoor(await HEALTH(req))
  return NextResponse.json({ ok: false, door: DOOR_VERSION, error: "this hub's @supersuit/artifacts has no HEALTH" }, { status: 501, headers: { 'cache-control': 'no-store' } })
}
