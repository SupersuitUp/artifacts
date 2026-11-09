// The door a `links: per-reader` page shows anyone the gate shut out. It says what kind of page
// this is, what to do next, and, to a signed-in visitor, which account they are using. Nothing of
// the page itself (title, summary, body) is shown: who it was sent to is the page's own business.
import type { BrandPack } from '../brand/pack.js'
import type { Reader } from '../artifacts/reader.js'
import { NO_LINK, UNAVAILABLE } from './per-reader.js'

/** The longest note a visitor can send with a request for access. */
export const ASK_NOTE_MAX = 500

/** What a signed-in visitor turned away can do about it: ask the publisher, once, with a note.
 *  `asked` is their request already on the record; `canAsk` false means there is nowhere to keep one. */
export function AskForAccess({ brand, pageId, canAsk, asked }: { brand: BrandPack; pageId: string; canAsk: boolean; asked: boolean }) {
  if (asked) return <p data-per-reader-asked className="mt-4 opacity-80">You asked for access. The person who published it has your request, and can send you a link or add this account.</p>
  if (!canAsk) return null
  return (
    <form method="post" action="/api/reader/ask" data-per-reader-ask className="mx-auto mt-5 max-w-sm text-left">
      <input type="hidden" name="id" value={pageId} />
      <label className="block text-sm opacity-80" htmlFor="ask-note">Add a note for the person who published it (optional)</label>
      <textarea id="ask-note" name="note" maxLength={ASK_NOTE_MAX} rows={3} className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2 text-sm" style={{ borderColor: brand.accent }} />
      <button type="submit" className="mt-3 w-full rounded-lg px-5 py-2 text-sm font-medium" style={{ background: brand.accent, color: brand.ground }}>Ask for access</button>
    </form>
  )
}

export function PerReaderDoor({ brand, why, reader, signInHref, switchHref, recorded, pageId, canAsk = false, asked = false }: {
  brand: BrandPack
  why: 'no-link' | 'revoked' | 'expired' | 'closed'
  /** The signed-in visitor, when there is one (never the owner or an admin: they get through). */
  reader: Reader | null
  /** Where "Sign in" goes; null when this host cannot sign readers in. */
  signInHref: string | null
  /** Signs out and sends them to choose another account. */
  switchHref: string
  /** The refused attempt was written to the page's record, so the publisher can see it. */
  recorded: boolean
  pageId: string
  /** The host keeps a reader record, so a request for access has somewhere to go. */
  canAsk?: boolean
  /** This visitor already asked. */
  asked?: boolean
}) {
  const wrap = 'mx-auto max-w-md px-6 pt-32 pb-24 text-center'
  if (why !== 'no-link') {
    return (
      <div data-nospeak className={wrap}>
        <p data-per-reader-shut className="text-lg opacity-80">{UNAVAILABLE}</p>
        <p className="mt-4 text-sm opacity-70">The link you used was closed. If you still need this page, ask the person who sent it for a new link.</p>
      </div>
    )
  }
  return (
    <div data-nospeak className={wrap}>
      <p data-per-reader-shut className="text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>{NO_LINK}</p>
      <p className="mt-4 text-base opacity-80">
        Everyone it was sent to has their own link. Open it from the message it came in, or ask the person who sent it for yours.
      </p>
      {reader ? (
        <div data-per-reader-not-shared className="mt-8 text-sm">
          <p className="opacity-80">You are signed in as {reader.email}, and this page was not shared with that account.</p>
          {recorded ? <p className="mt-2 opacity-60">This attempt was recorded, so the person who published it can see you tried.</p> : null}
          <AskForAccess brand={brand} pageId={pageId} canAsk={canAsk} asked={asked} />
          <a href={switchHref} className="mt-4 inline-block underline" style={{ color: brand.accent }}>Use a different account</a>
        </div>
      ) : signInHref ? (
        <div data-per-reader-sign-in className="mt-8 text-sm">
          <p className="opacity-80">Think you should have access? Sign in. The person who published it, and anyone who helps run this site, can open it once signed in.</p>
          <a href={signInHref} className="mt-4 inline-block rounded-lg px-5 py-2 text-sm font-medium" style={{ background: brand.accent, color: brand.ground }}>Sign in</a>
        </div>
      ) : null}
    </div>
  )
}
