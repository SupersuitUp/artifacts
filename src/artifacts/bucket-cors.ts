// THE PRIVATE BUCKET'S CORS RULE (ContinentalWorks/supersuit-dev#2519). A reader's browser reads a
// private file (a spreadsheet page's table, a played voice memo) and PUTs an upload (a voice memo)
// straight to the private bucket through a signed URL. Without a CORS rule naming the hub's
// addresses, the browser refuses both: a spreadsheet page shows only its fallback line and a memo
// never uploads, with no error the owner can see. A hub on its own cloud gets this rule from the
// Supersuit hub setup (steps.mjs private-bucket-cors). A tenant on a shared host never runs that
// step, so the host runs this, for each tenant's private bucket, in its tenant setup and in
// update-artifacts. The rule is the same shape the hub setup builds (hubCorsRule there).
import type { Bucket } from '@google-cloud/storage'

export const PRIVATE_CORS_METHODS = ['GET', 'HEAD', 'PUT']
export const PRIVATE_CORS_HEADERS = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'cache-control', 'x-goog-content-length-range']
export const PRIVATE_CORS_MAX_AGE = 3600

export type CorsRule = { origin?: string[]; method?: string[]; responseHeader?: string[]; maxAgeSeconds?: number }

/** Hub addresses as https origins: a bare host, or a full origin, either is accepted. */
export function hubOriginsOf(hosts: string[]): string[] {
  return [...new Set(hosts.filter(Boolean).map((h) => {
    const s = String(h).trim().replace(/\/+$/, '')
    return /^https?:\/\//.test(s) ? new URL(s).origin : `https://${s}`
  }))]
}

/** The one rule a private bucket needs for these hub addresses. */
export function privateBucketCorsRule(hosts: string[]): CorsRule {
  return { origin: hubOriginsOf(hosts), method: [...PRIVATE_CORS_METHODS], responseHeader: [...PRIVATE_CORS_HEADERS], maxAgeSeconds: PRIVATE_CORS_MAX_AGE }
}

const list = (x: unknown) => (Array.isArray(x) ? x : x ? [x] : []).map(String)
const lower = (a: string[]) => a.map((x) => x.toLowerCase())

/** Whether one existing rule already lets every hub address GET, HEAD and PUT with every header. */
export function ruleCovers(rule: CorsRule, hosts: string[]): boolean {
  const want = privateBucketCorsRule(hosts)
  const has = lower(list(rule.responseHeader))
  return want.origin!.every((o) => list(rule.origin).includes(o))
    && want.method!.every((m) => lower(list(rule.method)).includes(m.toLowerCase()))
    && want.responseHeader!.every((h) => has.includes(h.toLowerCase()))
}

/** The bucket's rules with the hub's added: a rule naming a hub address is widened in place, and
 *  every other rule is kept as it is. */
export function mergePrivateCors(existing: CorsRule[], hosts: string[]): CorsRule[] {
  const want = privateBucketCorsRule(hosts)
  const rules = existing.map((r) => ({ ...r }))
  const at = rules.findIndex((r) => want.origin!.some((o) => list(r.origin).includes(o)))
  if (at < 0) return [...rules, want]
  const r = rules[at]
  const union = (cur: unknown, add: string[]) => [...new Set([...list(cur), ...add])]
  r.origin = union(r.origin, want.origin!)
  r.method = union(r.method, want.method!)
  r.responseHeader = union(r.responseHeader, want.responseHeader!)
  r.maxAgeSeconds = r.maxAgeSeconds ?? want.maxAgeSeconds
  return rules
}

export type PrivateCorsResult = { bucket: string; changed: boolean; rules: CorsRule[] }

/**
 * Make sure a tenant's private bucket lets its hub addresses read and upload. Reads the bucket's
 * CORS rules, and writes them only when no rule already covers every address, so a re-run changes
 * nothing. `dryRun` reports what it would write. Refuses an empty address list, which would write
 * a rule that opens the bucket to nobody and reads as done.
 */
export async function ensurePrivateBucketCors(bucket: Pick<Bucket, 'name' | 'getMetadata' | 'setCorsConfiguration'>, hosts: string[], { dryRun = false } = {}): Promise<PrivateCorsResult> {
  if (!hubOriginsOf(hosts).length) throw new Error(`no hub address given for gs://${bucket.name}: name every address the hub answers on`)
  const [meta] = await bucket.getMetadata()
  const existing = (Array.isArray(meta?.cors) ? meta.cors : []) as CorsRule[]
  if (existing.some((r) => ruleCovers(r, hosts))) return { bucket: bucket.name, changed: false, rules: existing }
  const rules = mergePrivateCors(existing, hosts)
  if (!dryRun) await bucket.setCorsConfiguration(rules as Parameters<Bucket['setCorsConfiguration']>[0])
  return { bucket: bucket.name, changed: true, rules }
}
