// Who is reading a `links: per-reader` page, decided before anything of the page is rendered.
// Every refusal is the same quiet page; a revoked or expired reader learns only that it is gone.
import { parseRidParam, verifyRid } from '../artifacts/recipients.js'
import type { RecipientsStore } from '../artifacts/recipients-store.js'
import { PRIVATE_REF } from '../artifacts/assets.js'

export type PerReaderOpen = { state: 'open'; rid: string; sig: string; label: string; note: string | null; owner: boolean; group: boolean; closesAt: string | null; fromLink: boolean; forwarded: boolean }
export type PerReaderShut = { state: 'shut'; why: 'no-link' | 'revoked' | 'expired' | 'closed' }
/** Superlinks (0.56.0): a link shared by several people, or passed on by a reader, says who nobody
 *  is, so acting through it needs sign-in, at the moment of acting. Only on a forward link, or a
 *  page that turned forwarding on: a page without the line keeps its old rule, and
 *  `comment_name: required` keeps its typed name. One rule for the page and the state API. */
export function signInToAct(page: { forward?: string; commentName?: string }, link: { group: boolean; forwarded?: boolean }): boolean {
  return link.group && page.commentName !== 'required' && (!!link.forwarded || (!!page.forward && page.forward !== 'off'))
}
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
  // A forward never outlives the link it came from: any revoked link up its chain shuts it.
  const seen = new Set<string>()
  for (let at: typeof r | undefined = r; at; at = at.parent ? rec.recipients[at.parent] : undefined) {
    if (at.revokedAt || seen.has(at.rid)) return { state: 'shut', why: 'revoked' }
    seen.add(at.rid)
  }
  // A malformed expireAt parses to NaN: treat it as expired, never as no expiry.
  if (rec.expireAt && !(Date.parse(rec.expireAt) > (o.now ?? Date.now()))) return { state: 'shut', why: 'expired' }
  return { state: 'open', rid: pick.rid, sig: pick.sig, label: r.label, note: r.note ?? null, owner: r.owner === true, group: r.group === true, closesAt: r.closesAt ?? null, fromLink: pick.fromLink, forwarded: !!r.parent }
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
