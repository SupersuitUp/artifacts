// Resolution digests (0.34.0): when the owner, an admin or the publisher resolves comment threads,
// each signed-in reader whose comments were in them hears about it, in ONE email per page per burst
// of resolving, rather than one email per thread.
//
//   resolve  -> onResolve(event)   queues a notice for every signed-in writer of a comment in the
//                                  thread, except the person resolving, the page's owner and its
//                                  admins; anonymous writers have no address and get nothing
//   reopen   -> onResolve(event)   drops the thread from every burst still waiting on that page
//   cron     -> flush()            a burst whose last resolution is QUIET_MS old (or whose first is
//                                  MAX_WAIT_MS old) becomes one digest, sent once
//
// Only resolutions recorded through the route after a host wires `onResolve` queue anything: there
// is no backfill, so threads resolved before a host turned digests on never produce an email.
//
// Sent once, by construction. A due burst is CLAIMED in one transaction that turns it into a digest
// record and deletes the burst, so two overlapping runs cannot both claim it. A digest is then
// LEASED in a transaction before it is sent, so two runs cannot both send it. A run that dies after
// the send and before recording it leaves the lease to expire; the retry carries the same
// idempotency key (the digest id), which the sender passes to its provider (Resend keeps one for 24
// hours), so a retry does not deliver twice.
//
// Every digest carries a signed stop link that ends these emails for that reader on that page.
// The package knows nothing about where an email goes: the host hands it a `send` function.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { CommentResolution, CommentValue } from './comments.js'
import type { StateEntry } from './state-store.js'

/** A burst closes after this long with no new resolution for that reader on that page. */
export const RESOLVE_DIGEST_QUIET_MS = 10 * 60_000
/** A burst that keeps growing is sent anyway once its first resolution is this old. */
export const RESOLVE_DIGEST_MAX_WAIT_MS = 6 * 3_600_000
/** A digest leased for sending and not recorded as sent is retried after this long. */
export const RESOLVE_DIGEST_LEASE_MS = 15 * 60_000
/** After this many attempts a digest is recorded as failed and never tried again. */
export const RESOLVE_DIGEST_MAX_ATTEMPTS = 5
/** How much of a reader's comment, and of the passage it is pinned to, the email quotes. */
export const DIGEST_BODY_CHARS = 280
export const DIGEST_QUOTE_CHARS = 160
/** Where the stop link lands, under the host's origin. */
export const RESOLVE_DIGEST_STOP_PATH = '/api/resolve-digest/stop'

/** What the resolve route tells a host after a thread is resolved or reopened. */
export type ResolveEvent = {
  artifactId: string
  title: string
  /** The page's address, e.g. https://artifacts.example.com/abc23456. */
  url: string
  /** The thread: its top comment's id and every comment in it, top comment first, oldest first. */
  thread: { id: string; entries: StateEntry[] }
  /** The resolution just recorded, or null when the thread was reopened. */
  resolution: CommentResolution | null
  /** Who did it: a signed-in owner or admin (their email), or the publish key or a publisher pass. */
  actor: { email?: string; publisher: boolean }
  at: string
}

/** One of a reader's comments in a resolved thread, as the email lists it. */
export type DigestItem = {
  entryId: string
  threadId: string
  /** The passage the thread is pinned to, trimmed; null for a box drawn over the page. */
  quote: string | null
  /** The reader's comment, trimmed. A voice memo with no text says so. */
  body: string
  note: string | null
  by: string
  resolvedAt: string
}

/** A reader's open burst on one page: the threads resolved so far, waiting for the quiet window. */
export type Burst = {
  key: string
  burstId: string
  artifactId: string
  email: string
  name: string | null
  title: string
  url: string
  firstAt: string
  lastAt: string
  threads: Record<string, DigestItem[]>
}

export type DigestStatus = 'pending' | 'sent' | 'skipped' | 'failed'
/** A claimed burst, frozen: what one email says. Its id is the burst's id, and the idempotency key. */
export type Digest = {
  id: string
  artifactId: string
  email: string
  name: string | null
  title: string
  url: string
  items: DigestItem[]
  status: DigestStatus
  createdAt: string
  leaseUntil: string
  attempts: number
  sentAt?: string
  reason?: string
  providerId?: string
}

export interface ResolveDigestStore {
  /** Put this thread's items into the reader's open burst on this page (replacing the thread's
   *  earlier items, if it was resolved again), opening a burst when none is waiting. */
  add(input: { artifactId: string; email: string; name: string | null; title: string; url: string; threadId: string; items: DigestItem[]; at: string }): Promise<void>
  /** Take this thread out of every burst still waiting on this page (it was reopened). A burst
   *  left with no thread is deleted. Returns how many bursts changed. */
  dropThread(artifactId: string, threadId: string): Promise<number>
  /** Bursts whose last resolution is at or before `quietBefore`, or whose first is at or before
   *  `maxBefore`. */
  due(quietBefore: string, maxBefore: string, limit: number): Promise<Burst[]>
  /** Atomically turn one due burst into a pending digest and delete the burst. Null when the
   *  burst is gone, was replaced, or is no longer due (a resolution landed since `due`). */
  claim(input: { key: string; burstId: string; quietBefore: string; maxBefore: string; now: string }): Promise<Digest | null>
  /** Pending digests whose lease has run out (or was never taken), oldest first. */
  pending(now: string, limit: number): Promise<Digest[]>
  /** Atomically take the lease on one pending digest whose lease has run out: sets `leaseUntil`
   *  and counts an attempt. Null when it is not pending or another run holds it. */
  lease(id: string, now: string, until: string): Promise<Digest | null>
  /** Record how a leased digest ended. */
  finish(id: string, outcome: { status: Exclude<DigestStatus, 'pending'>; at: string; reason?: string; providerId?: string }): Promise<void>
  /** A send failed: leave it pending, retried once `retryAt` passes. */
  release(id: string, retryAt: string): Promise<void>
  /** The reader followed the stop link for this page. Keyed by `emailKey`, so no address is stored. */
  stop(artifactId: string, emailKey: string, at: string): Promise<void>
  stopped(artifactId: string, emailKey: string): Promise<boolean>
}

/** One email, ready for a provider. `idempotencyKey` is the same on every retry of one digest. */
export type DigestMessage = {
  to: string
  subject: string
  text: string
  html: string
  /** List-Unsubscribe and List-Unsubscribe-Post (RFC 8058), pointing at the stop link. */
  headers: Record<string, string>
  idempotencyKey: string
}
/** The host's email provider. Throw to have the digest retried on the next run. */
export type DigestSender = (m: DigestMessage) => Promise<{ id?: string } | void>

const norm = (e: string) => e.trim().toLowerCase()

/** A stable, non-reversible key for an address, used in document ids and stop links. */
export function emailKey(email: string): string {
  return createHash('sha256').update(norm(email)).digest('hex').slice(0, 24)
}
export const burstKey = (artifactId: string, email: string) => `${artifactId}__${emailKey(email)}`

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const trim = (s: string, n: number) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t }

/** The notices one resolve event queues: per signed-in writer with an address, the comments in
 *  the thread that THEY wrote. Never the person resolving, the page's owner or its admins, never
 *  an anonymous writer, and never a comment somebody else wrote. A reopen queues nothing. Pure. */
export function noticesFor(
  event: ResolveEvent, o: { ownerEmail?: string; admins?: readonly string[] } = {},
): { email: string; name: string | null; items: DigestItem[] }[] {
  const r = event.resolution
  if (!r) return []
  const skip = new Set([o.ownerEmail, ...(o.admins ?? []), event.actor.email].filter((e): e is string => !!e && !!e.trim()).map(norm))
  const root = event.thread.entries.find((e) => e.id === event.thread.id)
  const anchor = (root?.value as CommentValue | undefined)?.anchor
  const quote = anchor?.kind === 'text' && anchor.quote ? trim(anchor.quote, DIGEST_QUOTE_CHARS) : null
  const by = new Map<string, { email: string; name: string | null; items: DigestItem[] }>()
  for (const e of event.thread.entries) {
    const w = e.writer
    if (w.anonymous || !w.email || !w.email.trim()) continue
    const email = norm(w.email)
    if (skip.has(email)) continue
    const v = e.value as CommentValue
    const body = v.body && v.body.trim() ? trim(v.body, DIGEST_BODY_CHARS) : 'a voice memo'
    const item: DigestItem = { entryId: e.id, threadId: event.thread.id, quote, body, note: r.note ?? null, by: r.by, resolvedAt: r.at }
    const n = by.get(email) ?? { email, name: w.name?.trim() || null, items: [] }
    n.items.push(item)
    by.set(email, n)
  }
  return [...by.values()]
}

/** A digest's items in the order the email lists them: by when each thread was resolved. */
export function itemsOf(threads: Record<string, DigestItem[]>): DigestItem[] {
  return Object.values(threads).flat().sort((x, y) => x.resolvedAt.localeCompare(y.resolvedAt))
}

// ---- Stop links

const stopSig = (secret: string, artifactId: string, key: string) =>
  createHmac('sha256', secret).update(`resolve-digest-stop|${artifactId}|${key}`).digest('base64url').slice(0, 32)

/** `<artifactId>.<emailKey>.<signature>`: names the page and the reader (by key, not address). */
export function stopToken(secret: string, artifactId: string, email: string): string {
  const key = emailKey(email)
  return `${artifactId}.${key}.${stopSig(secret, artifactId, key)}`
}

export function verifyStopToken(secret: string | undefined, token: string | null | undefined): { artifactId: string; emailKey: string } | null {
  if (!secret || !token) return null
  const m = /^([A-Za-z0-9]{1,32})\.([a-f0-9]{24})\.([A-Za-z0-9_-]{32})$/.exec(token.trim())
  if (!m) return null
  const want = Buffer.from(stopSig(secret, m[1], m[2]))
  const got = Buffer.from(m[3])
  return got.length === want.length && timingSafeEqual(got, want) ? { artifactId: m[1], emailKey: m[2] } : null
}

// ---- The email

const GENERIC_BY = new Set(['', 'the publisher', 'the owner'])
const join = (names: string[]) => names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Who resolved, as a person reads it: the names on the resolutions, with "the publisher" read as
 *  the page's owner (an agent resolving with the publish key is resolving on the owner's behalf). */
export function resolverName(items: DigestItem[], fallback: string): string {
  const names: string[] = []
  for (const i of items) {
    const n = GENERIC_BY.has(i.by.trim().toLowerCase()) ? fallback : i.by.trim()
    if (!names.includes(n)) names.push(n)
  }
  return join(names) || fallback
}

export type ComposeOptions = {
  /** Whose pages these are, as the email signs off: "Example Co". */
  brandName: string
  /** Who "the publisher" is when an agent resolved: the owner's first name. Default `brandName`. */
  ownerName?: string
  stopUrl: string
}

/** The digest as an email. Plain words, no em dashes, every comment linked to its place. */
export function composeDigest(d: Pick<Digest, 'name' | 'title' | 'url' | 'items'>, o: ComposeOptions): { subject: string; text: string; html: string } {
  const title = oneLine(d.title) || 'your page'
  const who = resolverName(d.items, o.ownerName?.trim() || o.brandName)
  const n = d.items.length
  const yours = n === 1 ? 'your comment' : `${n} of your comments`
  const subject = `${who} resolved ${yours} on ${title}`
  const first = d.name?.trim().split(/\s+/)[0]
  const hello = first ? `Hi ${first},` : 'Hi,'
  const lead = n === 1
    ? `${who} resolved the comment you left on "${title}".`
    : `${who} resolved ${n} of the comments you left on "${title}".`
  const link = (i: DigestItem) => `${d.url}#comment-${i.entryId}`
  const where = (i: DigestItem) => i.quote ? `On "${i.quote}"` : 'On a box on the page'
  const host = (() => { try { return new URL(d.url).host } catch { return '' } })()
  const why = 'You are getting this because you left these comments on the page while signed in.'

  const text = [
    hello, '', lead, '',
    ...d.items.flatMap((i, k) => [
      `${k + 1}. ${where(i)}`,
      `   You wrote: "${i.body}"`,
      ...(i.note ? [`   What changed: ${i.note}`] : []),
      `   See it: ${link(i)}`,
      '',
    ]),
    `Read the page: ${d.url}`, '',
    `${o.brandName}${host ? `, ${host}` : ''}`, '',
    why,
    `Stop these emails for this page: ${o.stopUrl}`,
  ].join('\n')

  const p = 'margin:0 0 14px'
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">',
    `<p style="${p}">${esc(hello)}</p>`,
    `<p style="${p}">${esc(lead)}</p>`,
    ...d.items.map((i) => [
      '<div style="margin:0 0 18px;padding:0 0 0 12px;border-left:3px solid #d0d0d0">',
      i.quote ? `<p style="margin:0 0 6px;color:#555">On &ldquo;${esc(i.quote)}&rdquo;</p>` : '<p style="margin:0 0 6px;color:#555">On a box on the page</p>',
      `<p style="margin:0 0 6px">You wrote: &ldquo;${esc(i.body)}&rdquo;</p>`,
      i.note ? `<p style="margin:0 0 6px"><strong>What changed:</strong> ${esc(i.note)}</p>` : '',
      `<p style="margin:0"><a href="${esc(link(i))}">See it on the page</a></p>`,
      '</div>',
    ].join('')),
    `<p style="${p}"><a href="${esc(d.url)}">Read the page</a></p>`,
    `<p style="${p};color:#555">${esc(o.brandName)}${host ? `, ${esc(host)}` : ''}</p>`,
    `<p style="margin:0;font-size:13px;color:#777">${esc(why)} <a href="${esc(o.stopUrl)}" style="color:#777">Stop these emails for this page</a>.</p>`,
    '</div>',
  ].join('')
  return { subject, text, html }
}

/** An address as a report shows it: enough to recognise, not enough to collect. */
export function maskEmail(email: string): string {
  const [user, domain] = norm(email).split('@')
  return domain ? `${user.slice(0, 1)}***@${domain}` : '***'
}

// ---- The engine

export type ResolveDigestOptions = {
  store: ResolveDigestStore
  send: DigestSender
  /** Signs stop links. Read at call time. Without it nothing is queued and nothing is sent, since
   *  every digest must carry a working stop link. */
  secret: () => string | undefined
  /** The host's origin, e.g. https://artifacts.example.com. */
  siteUrl: string
  brandName: string
  ownerName?: string
  /** Never notified about their own comments, like the person resolving. */
  ownerEmail?: string
  admins?: readonly string[]
  quietMs?: number
  maxWaitMs?: number
  /** The page's title for the stop page. Optional. */
  titleOf?: (artifactId: string) => Promise<string | null>
  stopPath?: string
}

export type FlushReport = {
  now: string
  dryRun: boolean
  due: number
  claimed: number
  sent: { id: string; to: string; subject: string; comments: number }[]
  skipped: { id: string; reason: string }[]
  failed: { id: string; error: string }[]
  /** dryRun only: what a real run would send now. */
  wouldSend?: { to: string; subject: string; comments: number; artifactId: string; stopped: boolean }[]
}

export function createResolveDigests(o: ResolveDigestOptions) {
  const quietMs = o.quietMs ?? RESOLVE_DIGEST_QUIET_MS
  const maxWaitMs = o.maxWaitMs ?? RESOLVE_DIGEST_MAX_WAIT_MS
  const origin = o.siteUrl.replace(/\/+$/, '')
  const stopPath = o.stopPath ?? RESOLVE_DIGEST_STOP_PATH

  function stopUrl(artifactId: string, email: string): string | null {
    const secret = o.secret()
    return secret ? `${origin}${stopPath}?t=${stopToken(secret, artifactId, email)}` : null
  }

  /** The resolve route's hook. Swallows nothing: the route catches. */
  async function onResolve(event: ResolveEvent): Promise<void> {
    if (!event.resolution) {
      await o.store.dropThread(event.artifactId, event.thread.id)
      return
    }
    if (!o.secret()) return
    for (const n of noticesFor(event, { ownerEmail: o.ownerEmail, admins: o.admins })) {
      if (await o.store.stopped(event.artifactId, emailKey(n.email))) continue
      await o.store.add({ artifactId: event.artifactId, email: n.email, name: n.name, title: event.title, url: event.url, threadId: event.thread.id, items: n.items, at: event.at })
    }
  }

  function message(d: Digest): DigestMessage | null {
    const stop = stopUrl(d.artifactId, d.email)
    if (!stop) return null
    const m = composeDigest(d, { brandName: o.brandName, ownerName: o.ownerName, stopUrl: stop })
    return {
      to: d.email, ...m, idempotencyKey: `resolve-digest/${d.id}`,
      headers: { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }
  }

  /** Send every digest that is due. Run it on a schedule. `dryRun` changes nothing and sends
   *  nothing: it reports what a real run would send now. */
  async function flush(opts: { now?: Date; dryRun?: boolean; limit?: number } = {}): Promise<FlushReport> {
    const at = opts.now ?? new Date()
    const now = at.toISOString()
    const limit = opts.limit ?? 50
    const quietBefore = new Date(at.getTime() - quietMs).toISOString()
    const maxBefore = new Date(at.getTime() - maxWaitMs).toISOString()
    const report: FlushReport = { now, dryRun: !!opts.dryRun, due: 0, claimed: 0, sent: [], skipped: [], failed: [] }
    const due = await o.store.due(quietBefore, maxBefore, limit)
    report.due = due.length
    if (opts.dryRun) {
      report.wouldSend = []
      for (const b of due) {
        const items = itemsOf(b.threads)
        const m = composeDigest({ ...b, items }, { brandName: o.brandName, ownerName: o.ownerName, stopUrl: '' })
        report.wouldSend.push({ to: maskEmail(b.email), subject: m.subject, comments: items.length, artifactId: b.artifactId, stopped: await o.store.stopped(b.artifactId, emailKey(b.email)) })
      }
      return report
    }
    if (!o.secret()) return report
    for (const b of due) if (await o.store.claim({ key: b.key, burstId: b.burstId, quietBefore, maxBefore, now })) report.claimed++
    for (const p of await o.store.pending(now, limit)) {
      const d = await o.store.lease(p.id, now, new Date(at.getTime() + RESOLVE_DIGEST_LEASE_MS).toISOString())
      if (!d) continue
      if (d.attempts > RESOLVE_DIGEST_MAX_ATTEMPTS) {
        await o.store.finish(d.id, { status: 'failed', at: now, reason: 'too many attempts' })
        report.failed.push({ id: d.id, error: 'too many attempts' })
        continue
      }
      if (!d.items.length) { await o.store.finish(d.id, { status: 'skipped', at: now, reason: 'empty' }); report.skipped.push({ id: d.id, reason: 'empty' }); continue }
      if (await o.store.stopped(d.artifactId, emailKey(d.email))) {
        await o.store.finish(d.id, { status: 'skipped', at: now, reason: 'stopped' })
        report.skipped.push({ id: d.id, reason: 'stopped' })
        continue
      }
      const m = message(d)
      if (!m) { await o.store.release(d.id, now); continue }
      try {
        const r = await o.send(m)
        await o.store.finish(d.id, { status: 'sent', at: new Date().toISOString(), ...(r && r.id ? { providerId: r.id } : {}) })
        report.sent.push({ id: d.id, to: maskEmail(d.email), subject: m.subject, comments: d.items.length })
      } catch (err) {
        // Back off a little more each attempt: 5, 10, 20, 40 minutes.
        const wait = 5 * 60_000 * 2 ** Math.max(0, d.attempts - 1)
        await o.store.release(d.id, new Date(at.getTime() + wait).toISOString())
        report.failed.push({ id: d.id, error: (err as Error)?.message ?? 'send failed' })
      }
    }
    return report
  }

  const page = (title: string, body: string, status = 200) => new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>` +
    `<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;line-height:1.5;color:#1a1a1a"><h1 style="font-size:20px">${esc(title)}</h1><p>${body}</p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )

  /** GET or POST <stopPath>?t=<token>: one click ends resolution emails for that reader on that
   *  page. POST answers the mail client's one-click unsubscribe (RFC 8058). */
  async function STOP(req: Request): Promise<Response> {
    const t = new URL(req.url).searchParams.get('t')
    const v = verifyStopToken(o.secret(), t)
    if (!v) return page('That link does not work', 'It may have been copied only in part. Open it again from the email.', 400)
    await o.store.stop(v.artifactId, v.emailKey, new Date().toISOString())
    if (req.method === 'POST') return new Response(null, { status: 204 })
    const title = o.titleOf ? await o.titleOf(v.artifactId).catch(() => null) : null
    return page('Done', `You will get no more emails about resolved comments on ${title ? `&ldquo;${esc(title)}&rdquo;` : 'this page'}.`)
  }

  return { onResolve, flush, STOP, stopUrl, message }
}
