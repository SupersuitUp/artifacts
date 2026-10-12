// The per-reader routes. SEEN is public (the page calls it); everything else needs the publish key.
import { NextResponse, type NextRequest } from 'next/server'
import { RID_RE, beatKey, isUnfurlAgent, ridLink, verifyRenderToken, verifyRid } from '../artifacts/recipients.js'
import { summarizeViews, type RecipientsStore } from '../artifacts/recipients-store.js'
import { COMMENTS_SLOT } from '../artifacts/comments.js'
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
  /** Where the sweep reports a page it skipped or could not finish. Defaults to console.warn. */
  log?: (message: string) => void
}
// Session and device ids become part of a stored view's id, so only a short plain shape is let in.
const SESSION = /^[a-z0-9]{1,32}$/
const MEDIA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,140}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
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
  const unauth = () => json({ error: 'publish key required' }, 401)
  async function listing(id: string) {
    const secret = ctx.recipientSecret!()!
    const rec = (await ctx.recipients!.get(id)) ?? { recipients: {}, expireAt: null, keep: false }
    return {
      id, expireAt: rec.expireAt, keep: rec.keep,
      recipients: Object.values(rec.recipients).map((r) => ({ rid: r.rid, label: r.label, group: r.group === true, owner: r.owner === true, revoked: !!r.revokedAt, url: ridLink(ctx.pageUrl(id), id, r.rid, secret) })),
    }
  }
  /** GET and POST /api/artifacts/<id>/recipients: who a per-reader page was sent to (publish key). */
  async function RECIPIENTS(req: NextRequest, { params }: Params) {
    const { id } = await params
    if (!ctx.authed(req)) return unauth()
    if (!ctx.recipients || !ctx.recipientSecret?.()) return json({ error: 'this host keeps no per-reader links' }, 501)
    const a = ARTIFACT_ID_RE.test(id) ? await ctx.store.get(id) : null
    if (!a) return json({ error: `no artifact with id ${id}` }, 404)
    if (req.method === 'GET') return json(await listing(id))
    if (a.links !== 'per-reader') return json({ error: 'this page is not links: per-reader' }, 409)
    const b = (await req.json().catch(() => null)) as { add?: unknown; revoke?: unknown; expires?: unknown } | null
    if (!b) return json({ error: 'body must be JSON' }, 400)
    const secret = ctx.recipientSecret()!
    let added: { rid: string; label: string; url: string }[] = []
    if (Array.isArray(b.add) && b.add.some((x) => !x || typeof x !== 'object' || typeof (x as { label?: unknown }).label !== 'string' || !(x as { label: string }).label.trim()))
      return json({ error: 'each reader to add needs a label' }, 400)
    if (typeof b.expires === 'string' && Number.isNaN(Date.parse(b.expires))) return json({ error: 'expires must be an ISO time or null' }, 400)
    if (typeof b.expires === 'string' && Date.parse(b.expires) <= Date.now()) return json({ error: 'expires must be in the future' }, 400)
    if (Array.isArray(b.add) && b.add.length) {
      const made = await ctx.recipients.add(id, b.add as { label: string; note?: string; owner?: boolean; group?: boolean }[])
      added = made.map((r) => ({ rid: r.rid, label: r.label, url: ridLink(ctx.pageUrl(id), id, r.rid, secret) }))
    }
    const revoked = b.revoke === '*' || Array.isArray(b.revoke)
      ? await ctx.recipients.revoke(id, b.revoke === '*' ? '*' : (b.revoke as unknown[]).filter((x): x is string => typeof x === 'string' && RID_RE.test(x)))
      : []
    if (b.expires === null || typeof b.expires === 'string') {
      await ctx.recipients.setExpiry(id, b.expires === null ? null : new Date(b.expires as string).toISOString())
    }
    return json({ ...(await listing(id)), added, revoked })
  }
  /** GET /api/artifacts/<id>/views: one line per reader, with their comments (publish key). */
  async function VIEWS(req: NextRequest, { params }: Params) {
    const { id } = await params
    if (!ctx.authed(req)) return unauth()
    if (!ctx.recipients) return json({ error: 'this host keeps no per-reader links' }, 501)
    const rec = await ctx.recipients.get(id)
    if (!rec) return json({ error: `no readers for ${id}` }, 404)
    const entries = ctx.state ? await ctx.state.entries(id) : []
    const comments = entries.filter((e) => e.slot === COMMENTS_SLOT && e.readerKey.startsWith('r:')).map((e) => ({ readerKey: e.readerKey, at: e.at, text: String((e.value as { body?: unknown } | null)?.body ?? '') }))
    return json({ id, expireAt: rec.expireAt, keep: rec.keep, recipients: summarizeViews(rec, await ctx.recipients.views(id), comments) })
  }
  /** The daily sweep: deletes only pages whose recipients record carries an expireAt that is a
   *  well-formed time in the past and is not kept. An unparseable expireAt is never deleted (the
   *  gate already shuts the page); it is reported in `skipped`. A page that fails midway stays
   *  listed (the expiry record is forgotten last) and is retried by the next sweep. */
  async function sweepExpired(now: Date = new Date()): Promise<{ pages: number; files: number; skipped: string[]; failed: string[] }> {
    const out = { pages: 0, files: 0, skipped: [] as string[], failed: [] as string[] }
    if (!ctx.recipients) return out
    const log = ctx.log ?? ((m: string) => console.warn(m))
    for (const id of await ctx.recipients.expiring(now.toISOString())) {
      try {
        const rec = await ctx.recipients.get(id)
        const at = rec && !rec.keep && typeof rec.expireAt === 'string' && ISO.test(rec.expireAt) ? Date.parse(rec.expireAt) : NaN
        if (!rec || rec.keep || !(at <= now.getTime())) {
          if (rec && !rec.keep) { out.skipped.push(id); log(`sweepExpired: not deleting ${id}, expireAt is not a past ISO time`) }
          continue
        }
        const files = (await ctx.assets?.deletePage?.(id)) ?? 0
        // Reader text expires with the page: every comment and answer, whoever wrote it.
        if (ctx.state) for (const key of new Set((await ctx.state.entries(id)).map((e) => e.readerKey))) await ctx.state.removeReader(id, key)
        await ctx.store.delete(id)
        await ctx.recipients.forget(id)
        out.pages++
        out.files += files
      } catch (e) {
        out.failed.push(id)
        log(`sweepExpired: ${id} not finished, will retry: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return out
  }
  return { SEEN, RECIPIENTS, VIEWS, sweepExpired }
}
