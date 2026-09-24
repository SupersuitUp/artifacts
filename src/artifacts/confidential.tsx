// What a gated page shows around its body: a banner that addresses the reader by name and says
// why they are reading it and what they may not do with it, and a faint watermark carrying
// their address across every screen, so any photo or screenshot names who it was shown to.
// Also the two doors: one for someone not yet signed in, one for someone signed in who is not
// on the list.
import type { BrandPack } from '../brand/pack.js'
import type { Reader } from './reader.js'

export function bannerLines({ name, email, reason, owner }: { name: string | null; email: string; reason: string; owner: string }) {
  return {
    lead: `${name ? `${name}, this` : 'This'} is confidential.`,
    why: `You are reading it because ${reason}.`,
    rule: `It is for you alone. Do not share, forward, copy, screenshot, print, or download it, or discuss its contents with anyone ${owner} has not given access.`,
    record: `Your reading is recorded under ${email}.`,
  }
}

export function ConfidentialBanner(props: { name: string | null; email: string; reason: string; owner: string; brand: BrandPack; signOutUrl: string }) {
  const l = bannerLines(props)
  return (
    <aside
      data-nospeak
      className="mx-auto max-w-2xl rounded-xl border px-5 py-4 text-sm leading-relaxed"
      style={{ borderColor: props.brand.accent, color: props.brand.ink }}
    >
      <p className="font-semibold" style={{ color: props.brand.accent }}>{l.lead}</p>
      <p className="mt-1">{l.why} {l.rule}</p>
      <p className="mt-2 text-xs opacity-60">
        {l.record} Not you? <a href={props.signOutUrl} className="underline">Sign out</a>.
      </p>
    </aside>
  )
}

/** A tiled, rotated, near-invisible line of the reader's address over the whole page. */
export function Watermark({ email }: { email: string }) {
  const text = `${email} · confidential`.replace(/[<>&"']/g, '')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'><text x='10' y='120' transform='rotate(-24 210 110)' font-family='sans-serif' font-size='14' fill='rgba(128,128,128,0.10)'>${text}</text></svg>`
  return (
    <div
      aria-hidden
      data-nospeak
      className="pointer-events-none fixed inset-0 z-40"
      style={{ backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")` }}
    />
  )
}

/** Printing shows this and nothing else, whichever way the print dialog was reached. */
export const NO_PRINT_CSS = `@media print { body * { visibility: hidden !important; } body::after { content: "This page is confidential and cannot be printed."; visibility: visible; position: fixed; top: 40%; left: 0; right: 0; text-align: center; font: 16px sans-serif; color: #000; } }`

export function SignInDoor({ brand, href }: { brand: BrandPack; href?: string }) {
  // No href means the host configured no sign-in authority: the door stays, with no way through.
  if (!href) {
    return (
      <div data-nospeak className="mx-auto max-w-sm px-6 pb-24 text-center">
        <p className="text-sm opacity-70">This page is confidential, and this site cannot sign readers in yet.</p>
      </div>
    )
  }
  return (
    <div data-nospeak className="mx-auto max-w-sm px-6 pb-24 text-center">
      <p className="text-sm opacity-70">This page is confidential. Sign in with the Google account your Freedom account uses, or the address it was shared with.</p>
      <a
        href={href}
        className="mt-5 inline-block rounded-lg px-5 py-2 text-sm font-medium"
        style={{ background: brand.accent, color: brand.ground }}
      >
        Sign in to read
      </a>
    </div>
  )
}

export function NotAllowedDoor({ brand, reader, signOutUrl }: { brand: BrandPack; reader: Reader; signOutUrl: string }) {
  return (
    <div data-nospeak className="mx-auto max-w-sm px-6 pb-24 text-center text-sm">
      <p className="opacity-80">
        You are signed in as {reader.email}, and this page has not been shared with that address.
        If it was sent to a different address of yours, sign out and use that one.
      </p>
      <p className="mt-3 opacity-60">This attempt was recorded.</p>
      <a href={signOutUrl} className="mt-5 inline-block underline" style={{ color: brand.accent }}>
        Sign out
      </a>
    </div>
  )
}

/** The agreement a reader makes before a confidential page opens. The exact string is stored
 *  with their acknowledgement, so the record says what they agreed to, not what it says today. */
export function ackText(owner: string): string {
  return `I understand this document is confidential. I will not share, forward, copy, screenshot, print, or download it, or discuss its contents with anyone ${owner} has not given access. I understand that my reading is recorded.`
}

export function AckDoor({ brand, name, email, owner, pageId, signOutUrl }: { brand: BrandPack; name: string | null; email: string; owner: string; pageId: string; signOutUrl: string }) {
  return (
    <form method="post" action="/api/reader/ack" data-nospeak className="mx-auto max-w-md px-6 pb-24 text-left text-sm">
      <input type="hidden" name="id" value={pageId} />
      <div className="rounded-xl border px-5 py-5" style={{ borderColor: brand.accent }}>
        <p className="font-semibold" style={{ color: brand.accent }}>{name ? `${name}, before you read` : 'Before you read'}</p>
        <p className="mt-3 leading-relaxed">{ackText(owner)}</p>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" name="agree" value="yes" required className="mt-1" />
          <span>I agree to keep it confidential.</span>
        </label>
        <button type="submit" className="mt-5 w-full rounded-lg px-5 py-2 text-sm font-medium" style={{ background: brand.accent, color: brand.ground }}>
          Agree and open
        </button>
        <p className="mt-3 text-xs opacity-60">
          Signed in as {email}. Your agreement is recorded with the time. Not you? <a href={signOutUrl} className="underline">Sign out</a>.
        </p>
      </div>
    </form>
  )
}
