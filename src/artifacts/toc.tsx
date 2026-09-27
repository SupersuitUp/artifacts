// The table of contents: the page's sections, as a sticky rail on a wide screen and a
// collapsible list above the body on a narrow one. Both are marked data-nospeak so the
// read-along never narrates them, and both link to the ids the renderer puts on headings,
// which come from the same headingsOf the notes widget uses.
import { headingsOf } from './widgets.js'
import { TocSpy } from './toc-spy.js'

export type TocItem = { slug: string; text: string }

/** Sections below this count read fine without a contents list. */
const AUTO_MIN = 4

export function tocOf(markdown: string): TocItem[] {
  return headingsOf(markdown).filter((h) => h.depth === 2).map(({ slug, text }) => ({ slug, text }))
}

/** `flag` is the page's `toc:`. Absent, the list appears once there are enough sections. */
export function showToc(markdown: string, flag?: boolean): boolean {
  if (flag === false) return false
  const n = tocOf(markdown).length
  return flag === true ? n > 0 : n >= AUTO_MIN
}

const LINK = 'block border-l-2 border-transparent py-1 pl-3 no-underline transition-colors text-[color:var(--a-muted)] hover:text-[color:var(--a-strong)] aria-[current=location]:border-[color:var(--a-accent)] aria-[current=location]:text-[color:var(--a-strong)]'

function List({ items }: { items: TocItem[] }) {
  return (
    <ol className="m-0 list-none space-y-0.5 p-0 text-sm leading-snug">
      {items.map((i) => (
        <li key={i.slug} className="m-0 p-0">
          <a href={`#${i.slug}`} data-toc-slug={i.slug} className={LINK}>
            {i.text}
          </a>
        </li>
      ))}
    </ol>
  )
}

/** Wide screens: fixed in the left margin, so the reading column stays centred. */
export function TocRail({ items }: { items: TocItem[] }) {
  return (
    <nav
      data-nospeak
      data-artifact-toc="rail"
      aria-label="Contents"
      className="fixed top-28 left-6 z-10 hidden max-h-[calc(100vh-10rem)] w-56 overflow-y-auto xl:block 2xl:left-12 2xl:w-64"
    >
      <p className="mb-3 pl-3 text-[11px] font-medium uppercase tracking-[0.25em] text-[color:var(--a-accent)]">Contents</p>
      <List items={items} />
      <TocSpy slugs={items.map((i) => i.slug)} />
    </nav>
  )
}

/** Narrow screens: a closed list above the body. */
export function TocInline({ items }: { items: TocItem[] }) {
  return (
    <details data-nospeak data-artifact-toc="inline" className="mb-8 rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-surface)] px-4 py-3 xl:hidden">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.25em] text-[color:var(--a-accent)]">Contents</summary>
      <div className="mt-3">
        <List items={items} />
      </div>
    </details>
  )
}
