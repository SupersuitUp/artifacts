// Who is reading a `links: per-reader` page, decided before anything of the page is rendered.
// Every refusal is the same quiet page; a revoked or expired reader learns only that it is gone.
import { parseRidParam, verifyRid } from '../artifacts/recipients.js'
import type { RecipientsStore } from '../artifacts/recipients-store.js'
import { PRIVATE_REF } from '../artifacts/assets.js'

export type PerReaderOpen = { state: 'open'; rid: string; sig: string; label: string; note: string | null; owner: boolean; fromLink: boolean }
export type PerReaderShut = { state: 'shut'; why: 'no-link' | 'revoked' | 'expired' | 'closed' }
export const UNAVAILABLE = 'This page is no longer available.'
export const NO_LINK = 'This page opens from the link it was sent with.'

export async function perReaderGate(o: { id: string; param: string | undefined; cookie: string | undefined; secret: string | undefined; recipients: RecipientsStore | undefined; now?: number }): Promise<PerReaderOpen | PerReaderShut> {
  // An unset or empty secret verifies nothing: fail closed before any signature is compared.
  if (!o.secret || !o.recipients) return { state: 'shut', why: 'closed' }
  const fromParam = parseRidParam(o.param)
  const fromCookie = parseRidParam(o.cookie)
  const pick = fromParam && verifyRid(o.secret, o.id, fromParam.rid, fromParam.sig) ? { ...fromParam, fromLink: true }
    : fromCookie && verifyRid(o.secret, o.id, fromCookie.rid, fromCookie.sig) ? { ...fromCookie, fromLink: false } : null
  if (!pick) return { state: 'shut', why: 'no-link' }
  const rec = await o.recipients.get(o.id)
  const r = rec?.recipients[pick.rid]
  if (!rec || !r) return { state: 'shut', why: 'no-link' }
  if (r.revokedAt) return { state: 'shut', why: 'revoked' }
  if (rec.expireAt && Date.parse(rec.expireAt) <= (o.now ?? Date.now())) return { state: 'shut', why: 'expired' }
  return { state: 'open', rid: pick.rid, sig: pick.sig, label: r.label, note: r.note ?? null, owner: r.owner === true, fromLink: pick.fromLink }
}

const REF_IN_MD = /\]\((private:[A-Za-z0-9][A-Za-z0-9._-]{0,140})\)/g

export async function withPrivateUrls(markdown: string, id: string, privateUrl: ((id: string, stored: string) => Promise<string>) | undefined): Promise<string> {
  const refs = [...new Set([...markdown.matchAll(REF_IN_MD)].map((m) => m[1]))]
  let out = markdown
  for (const ref of refs) {
    const stored = PRIVATE_REF.exec(ref)?.[1]
    const url = stored && privateUrl ? await privateUrl(id, stored) : '#'
    out = out.split(`](${ref})`).join(`](${url})`)
  }
  return out
}
