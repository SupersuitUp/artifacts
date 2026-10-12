// The per-reader routes. SEEN is public (the page calls it); everything else needs the publish key.
import { NextResponse, type NextRequest } from 'next/server'
import { RID_RE, beatKey, isUnfurlAgent, verifyRenderToken, verifyRid } from '../artifacts/recipients.js'
import type { RecipientsStore } from '../artifacts/recipients-store.js'
import type { ArtifactStore } from '../artifacts/store.js'
import type { StateStore } from '../artifacts/state-store.js'
import type { ArtifactAssets } from '../artifacts/assets.js'
import { ARTIFACT_ID_RE } from './ids.js'

type Params = { params: Promise<{ id: string }> }
export type RecipientsRoutesCtx = {
  store: ArtifactStore
  recipients?: RecipientsStore
  recipientSecret?: () => string | undefined
  publishKey: () => string | undefined
  state?: StateStore
  assets?: ArtifactAssets
  pageUrl: (id: string) => string
  authed: (r: Request) => boolean
}
// Session and device ids become part of a stored view's id, so only a short plain shape is let in.
const SESSION = /^[a-z0-9]{1,32}$/
const MEDIA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,140}$/
const none = () => new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } })
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { 'cache-control': 'no-store' } })

export function createRecipientsRoutes(ctx: RecipientsRoutesCtx) {
  /** POST /api/artifacts/<id>/seen: the page's own signal that a reader looked at it. */
  async function SEEN(req: NextRequest, { params }: Params) {
    const { id } = await params
    // An unfurl agent is dropped before anything is read: no state, no answer worth reading.
    if (isUnfurlAgent(req.headers.get('user-agent'))) return none()
    // An unset or empty secret verifies nothing: fail closed before any signature is compared.
    const secret = ctx.recipientSecret?.()
    if (!secret || !ctx.recipients || !ARTIFACT_ID_RE.test(id)) return json({ error: 'not found' }, 404)
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const rid = str(b?.rid), sig = str(b?.sig), session = str(b?.session), device = str(b?.device)
    if (!RID_RE.test(rid) || !SESSION.test(session) || !SESSION.test(device)) return json({ error: 'bad signal' }, 400)
    if (!verifyRid(secret, id, rid, sig)) return json({ error: 'forbidden' }, 403)
    // The rid must be one this page was sent to, still live: a signature alone proves only that
    // the host minted it once.
    const rec = await ctx.recipients.get(id)
    const r = rec?.recipients[rid]
    // A malformed expireAt parses to NaN: treat it as expired, never as no expiry.
    if (!rec || !r || r.revokedAt || (rec.expireAt && !(Date.parse(rec.expireAt) > Date.now()))) return json({ error: 'gone' }, 410)
    // The owner's own opens record zero.
    if (r.owner) return none()
    const at = new Date().toISOString()
    const event = b?.event
    if (event === 'view') {
      const t = verifyRenderToken(secret, id, rid, str(b?.token))
      if (!t.ok || !(await ctx.recipients.useToken(t.key, t.expiresAt))) return json({ error: 'not a fresh render' }, 409)
      await ctx.recipients.recordView({ artifactId: id, rid, session, device, at, addSeconds: 2 })
      return json({ beat: beatKey(secret, id, rid, session) })
    }
    if (event === 'beat' || event === 'play') {
      if (str(b?.beat) !== beatKey(secret, id, rid, session)) return json({ error: 'forbidden' }, 403)
      const media = event === 'play' && typeof b?.media === 'string' && MEDIA.test(b.media) ? b.media : undefined
      const seconds = event === 'beat' ? Math.max(0, Math.min(20, Number(b?.seconds) || 0)) : 0
      await ctx.recipients.recordView({ artifactId: id, rid, session, device, at, addSeconds: seconds, ...(media ? { play: media } : {}) })
      return json({})
    }
    return json({ error: 'event must be view, beat or play' }, 400)
  }
  return { SEEN }
}
