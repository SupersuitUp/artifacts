// "Shared with you": the hub's home for a signed-in reader who is not its owner or an admin. It
// lists the pages this hub would let that reader open, grouped onto the hub's shelves, newest first.
//
// The rule for who sees a page is the hub's own decide() and nothing else, so the list can never
// drift from the door. Three kinds of page are never listed, for anyone: a password page and a
// per-reader-link page (each opens by its own link only, and a list would show its title to people
// without the key or the link), and an unpublished page. A public page is never listed either,
// shelf or not: a home lists what was shared with THIS reader (by name, or with every Supersuit
// member), never what anyone may open, or one friend would find the family's shelf on theirs.
// `shelf:` only says where a shared page goes; it never shares it.
import { decide, type AllowEntry, type Reader } from '../artifacts/reader.js'
import type { ArtifactListItem } from '../artifacts/store.js'
import type { SessionDoc } from '../artifacts/readers-store.js'
import type { BrandPack } from '../brand/pack.js'
import { BrandGround } from '../brand/wrapper.js'

/** One shelf as the hub names it. Order in the hub's `shelves` setting is the order on the page. */
export type Shelf = { id: string; label: string; blurb?: string }
export type ShelfPage = { id: string; title: string; summary: string; url: string; updatedAt: string; new: boolean }
export type ShelfGroup = Shelf & { pages: ShelfPage[] }

/** A page updated more than this long ago is not news, opened or not. */
export const NEW_WINDOW_DAYS = 14
export const OTHER_SHELF: Shelf = { id: 'other', label: 'Other pages' }

/** Whether a listed page may be shown on anyone's shelf at all, before asking who they are. */
export function shelvable(p: ArtifactListItem): boolean {
  return !p.locked && p.links !== 'per-reader' && !p.unpublished
}

/** The shelves one reader's home draws: every page decide() opens for them, grouped and ordered. */
export async function shelvesFor(input: {
  reader: Reader
  pages: ArtifactListItem[]
  shelves?: readonly Shelf[]
  allowList: (id: string) => Promise<AllowEntry[]>
  sessions?: (id: string) => Promise<SessionDoc[]>
  pageUrl: (id: string) => string
  now?: number
}): Promise<ShelfGroup[]> {
  const { reader, pages, allowList, sessions, pageUrl } = input
  const now = input.now ?? Date.now()
  const email = reader.email.trim().toLowerCase()
  const open = await Promise.all(pages.filter(shelvable).map(async (p) => {
    // staff is false on purpose: this is what the READER may open, even when the owner previews it.
    const ok = p.access ? decide(p.access, { ...reader, email }, await allowList(p.id), false).open : false
    return ok ? p : null
  }))
  const mine = open.filter((p): p is ArtifactListItem => p !== null)
  const lastSeen = async (id: string) => {
    if (!sessions) return null
    const own = (await sessions(id).catch(() => [])).filter((s) => s.email.trim().toLowerCase() === email)
    return own.reduce<string | null>((m, s) => (m === null || s.lastAt > m ? s.lastAt : m), null)
  }
  const lines = await Promise.all(mine.map(async (p) => {
    const recent = now - Date.parse(p.updatedAt) < NEW_WINDOW_DAYS * 86_400_000
    const seen = recent ? await lastSeen(p.id) : null
    return { shelf: p.shelf ?? OTHER_SHELF.id, page: { id: p.id, title: p.title, summary: p.summary, url: pageUrl(p.id), updatedAt: p.updatedAt, new: recent && (seen === null || p.updatedAt > seen) } }
  }))
  const named = new Map((input.shelves ?? []).map((s) => [s.id, s]))
  const order = [...(input.shelves ?? []).map((s) => s.id)]
  for (const l of lines) if (!order.includes(l.shelf) && l.shelf !== OTHER_SHELF.id) order.push(l.shelf)
  order.push(OTHER_SHELF.id)
  return order.map((id) => {
    const shelf = named.get(id) ?? (id === OTHER_SHELF.id ? OTHER_SHELF : { id, label: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ') })
    const pagesOn = lines.filter((l) => l.shelf === id).map((l) => l.page)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    return { ...shelf, pages: pagesOn }
  }).filter((g) => g.pages.length > 0)
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The page itself, in the hub's brand: one section per shelf, each page a row that opens it. */
export function ReaderShelves(props: { pack: BrandPack; brand: BrandPack; owner: string; name: string | null; groups: ShelfGroup[]; seeingAs?: string }) {
  const { pack, brand, owner, name, groups, seeingAs } = props
  return (
    <BrandGround pack={pack}>
      <main data-reader-home className="mx-auto max-w-2xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        {seeingAs ? (
          <p data-seeing-as className="mb-6 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: brand.accent }}>
            What {seeingAs} sees. <a href="/" className="underline">Back to your home</a>
          </p>
        ) : null}
        <p className="text-[11px] uppercase tracking-[0.3em]" style={{ color: brand.accent }}>Shared with you</p>
        <h1 className="mt-3 text-3xl sm:text-4xl" style={{ fontFamily: brand.type.display }}>
          {name ? `${name}, here is what ${owner} shared with you` : `What ${owner} shared with you`}
        </h1>
        {groups.length === 0 ? (
          <p data-shelves-empty className="mt-8 opacity-70">Nothing is shared with you here yet. When {owner} shares a page with you, it shows up here.</p>
        ) : groups.map((g) => (
          <section key={g.id} data-shelf={g.id} className="mt-10">
            <h2 className="text-xl" style={{ fontFamily: brand.type.display }}>{g.label}</h2>
            {g.blurb ? <p className="mt-1 text-sm opacity-70">{g.blurb}</p> : null}
            <ul className="mt-3 divide-y" style={{ borderColor: 'currentColor' }}>
              {g.pages.map((p) => (
                <li key={p.id} data-shelf-page={p.id} className="py-3">
                  <a href={p.url} className="block">
                    <span className="flex items-baseline gap-2">
                      <span className="text-lg">{p.title}</span>
                      {p.new ? <span data-new className="rounded px-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ background: brand.accent, color: brand.ground }}>New</span> : null}
                    </span>
                    <span className="mt-0.5 block text-sm opacity-70">{p.summary ? `${p.summary} · ` : ''}{day(p.updatedAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </BrandGround>
  )
}
