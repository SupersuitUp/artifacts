// What happened on a hub's pages since a time, as one list (GET /api/activity, the owner's
// dashboard feed): each reader's opens and button clicks, and every comment, newest first. Opens
// and clicks come through summarizeViews, so they follow its rules: never the owner's own link,
// never a render from before the link was sent. Comments a publisher wrote (a reply) are left out:
// they are the owner's own words, not news. Pure, so the route only reads the stores.
import { summarizeViews, type RecipientsRecord, type ViewDoc } from './recipients-store.js'
import { ridOfReaderKey } from './recipients.js'
import { COMMENTS_SLOT } from './comments.js'
import type { StateEntry } from './state-store.js'

export const ACTIVITY_MAX = 500

export type ActivityReader = { rid: string; label: string } | { name: string | null }
export type ActivityEvent = {
  kind: 'open' | 'click' | 'comment'
  at: string
  artifactId: string
  title: string
  url: string
  reader: ActivityReader
  /** open */
  device?: string
  activeSeconds?: number
  /** click */
  cta?: string
  /** comment */
  commentId?: string
  parent?: string | null
  text?: string
}
export type ActivityPage = { id: string; title: string; url: string; recipients: RecipientsRecord | null; views: ViewDoc[]; entries: StateEntry[] }

/** A stable order for events at the same time, so a cursor never skips or repeats one. */
const keyOf = (e: ActivityEvent) => `${e.artifactId}|${e.kind}|${'rid' in e.reader ? e.reader.rid : e.reader.name ?? ''}|${e.commentId ?? e.cta ?? e.device ?? ''}`
const newer = (a: { at: string; k: string }, b: { at: string; k: string }) => b.at.localeCompare(a.at) || b.k.localeCompare(a.k)

export function encodeCursor(e: ActivityEvent): string {
  return Buffer.from(JSON.stringify({ at: e.at, k: keyOf(e) })).toString('base64url')
}
/** The position a cursor names, or null when it is not one this module wrote. */
export function decodeCursor(c: string): { at: string; k: string } | null {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as unknown
    if (!v || typeof v !== 'object') return null
    const { at, k } = v as { at?: unknown; k?: unknown }
    return typeof at === 'string' && typeof k === 'string' && !Number.isNaN(Date.parse(at)) ? { at, k } : null
  } catch { return null }
}

/** Every event after `since` (exclusive), newest first, at most `limit`, starting after `cursor`. */
export function activityOf(pages: ActivityPage[], since: string, opts: { limit?: number; cursor?: { at: string; k: string } | null } = {}): { events: ActivityEvent[]; cursor: string | null; more: boolean } {
  const limit = opts.limit ?? ACTIVITY_MAX
  const sinceMs = Date.parse(since)
  const all: ActivityEvent[] = []
  for (const p of pages) {
    const base = { artifactId: p.id, title: p.title, url: p.url }
    const comments = p.entries.filter((e) => e.slot === COMMENTS_SLOT)
    const labels = new Map<string, string>()
    if (p.recipients) {
      const lines = summarizeViews(p.recipients, p.views, comments.map((e) => ({ readerKey: e.readerKey, id: e.id, at: e.at, text: '' })))
      for (const r of lines) {
        labels.set(r.rid, r.label)
        const reader = { rid: r.rid, label: r.label }
        for (const o of r.opens) all.push({ ...base, kind: 'open', at: o.at, reader, device: o.device, activeSeconds: o.activeSeconds })
        for (const c of r.clicks) all.push({ ...base, kind: 'click', at: c.at, reader, cta: c.cta })
      }
    }
    for (const e of comments) {
      const v = (e.value ?? {}) as { body?: unknown; parent?: unknown; publisher?: unknown }
      if (v.publisher === true) continue
      const rid = ridOfReaderKey(e.readerKey)
      // A comment through the owner's own link: summarizeViews never lists the owner, so no label.
      if (rid && p.recipients?.recipients[rid]?.owner) continue
      const reader: ActivityReader = rid ? { rid, label: labels.get(rid) ?? e.writer.name ?? '' } : { name: e.writer.anonymous ? null : e.writer.name ?? null }
      all.push({ ...base, kind: 'comment', at: e.at, reader, commentId: e.id, parent: typeof v.parent === 'string' ? v.parent : null, text: String(v.body ?? '') })
    }
  }
  const after = opts.cursor ?? null
  const sorted = all
    .filter((e) => Date.parse(e.at) > sinceMs)
    .map((e) => ({ e, pos: { at: e.at, k: keyOf(e) } }))
    .filter(({ pos }) => !after || newer(pos, after) > 0)
    .sort((x, y) => newer(x.pos, y.pos))
  const page = sorted.slice(0, limit).map(({ e }) => e)
  const more = sorted.length > limit
  return { events: page, cursor: more ? encodeCursor(page[page.length - 1]) : null, more }
}
