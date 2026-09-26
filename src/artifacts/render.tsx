// Markdown to the house look, for /a/<id>. Server-safe: no hooks, no client
// directive. Raw HTML is escaped by react-markdown's default; never add
// rehype-raw here, this renders strangers' links on a public route.
// Two extensions past GFM, both small on purpose:
//   ```links   one "url | note" per line, rendered as link cards
//   > [!note] / > [!warning]   a callout instead of a blockquote
import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { hasNotesWidget, headingsOf, type Heading } from './widgets.js'
import { HeadingNotes, NoteToggle, NotesEarlier, NotesProvider } from '../widgets/notes.js'

const GOLD = '#C2A15C'

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function LinkCards({ source }: { source: string }) {
  const rows = source
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [url, ...rest] = l.split('|')
      return { url: url.trim(), note: rest.join('|').trim() }
    })
  return (
    <ul data-artifact-links className="my-6 grid list-none gap-3 p-0">
      {rows.map((r) => (
        <li key={r.url} className="m-0 p-0">
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 no-underline transition-colors hover:border-white/25"
          >
            <span className="block text-[11px] uppercase tracking-[0.2em]" style={{ color: GOLD }}>
              {hostOf(r.url)}
            </span>
            <span className="block text-zinc-100">{r.note || r.url}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

const CALLOUT = /^\[!(note|warning)\]\s*/i

// A link the reader can actually follow: absolute, a scheme like mailto:, a
// root path on this host (uploaded assets), or an in-page fragment. Anything
// else is a path on the author's disk (../meeting-transcripts/x.md), which the
// publisher never uploads, so the anchor would 404. Those render as their text.
const REACHABLE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i
export function isReachableHref(href: unknown): href is string {
  return typeof href === 'string' && REACHABLE.test(href)
}

const components: Components = {
  h1: ({ children }) => <h1 className="mt-10 mb-4 font-serif text-3xl text-zinc-50">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-10 mb-3 font-serif text-2xl text-zinc-50">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-8 mb-2 text-lg font-semibold text-zinc-100">{children}</h3>,
  p: ({ children }) => <p className="my-4 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>,
  hr: () => <hr className="my-10 border-white/10" />,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-white/20 px-3 py-2 text-left font-semibold text-zinc-100">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-white/10 px-3 py-2 align-top">{children}</td>,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="my-6 w-full rounded-lg border border-white/10" />
  ),
  a: ({ href, children }) =>
    !isReachableHref(href) ? (
      <span>{children}</span>
    ) : (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-50 underline decoration-white/30 underline-offset-4 hover:decoration-white"
    >
      {children}
      {href && hostOf(href) ? (
        <span data-nospeak className="ml-1 text-xs text-zinc-500">
          ({hostOf(href)})
        </span>
      ) : null}
    </a>
    ),
  code: ({ className, children }) => {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1]
    if (lang === 'links') return <LinkCards source={textOf(children)} />
    // A notes fence is the widget's place on the page. Without notes enabled (the host keeps no
    // answers) it draws nothing: its settings are not prose and never shown as code.
    if (lang === 'notes') return null
    if (!className) {
      return <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.9em] text-zinc-100">{children}</code>
    }
    return <code className={className}>{children}</code>
  },
  pre: ({ children }) => {
    // A links fence renders its own block; do not wrap it in <pre>.
    const inner = Array.isArray(children) ? children[0] : children
    const cls = (inner as { props?: { className?: string } })?.props?.className ?? ''
    if (/language-(links|notes)/.test(cls)) return <>{children}</>
    return (
      <pre
        data-artifact-code
        className="my-6 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-zinc-100"
      >
        {children}
      </pre>
    )
  },
  blockquote: ({ children }) => {
    const t = textOf(children).trim()
    const m = CALLOUT.exec(t)
    if (!m) {
      return (
        <blockquote className="my-6 border-l-2 pl-4 italic text-zinc-300" style={{ borderColor: GOLD }}>
          {children}
        </blockquote>
      )
    }
    const kind = m[1].toLowerCase()
    const body = t.replace(CALLOUT, '')
    return (
      <aside
        data-callout={kind}
        className="my-6 rounded-lg border px-4 py-3"
        style={{ borderColor: kind === 'warning' ? '#d97706' : GOLD, background: 'rgba(255,255,255,0.03)' }}
      >
        <span data-nospeak className="block text-[11px] uppercase tracking-[0.2em]" style={{ color: GOLD }}>
          {kind}
        </span>
        <p className="mt-1 text-zinc-100">{body}</p>
      </aside>
    )
  },
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-10 mb-4 font-serif text-3xl text-zinc-50',
  2: 'mt-10 mb-3 font-serif text-2xl text-zinc-50',
  3: 'mt-8 mb-2 text-lg font-semibold text-zinc-100',
  4: 'mt-6 mb-2 font-semibold text-zinc-100',
  5: 'mt-6 mb-2 font-semibold text-zinc-100',
  6: 'mt-6 mb-2 font-semibold text-zinc-100',
}

/** Components for a page with a notes block: every heading gets its slug as an id, a note
 *  control, and its notes after it. The heading is found by its source line, so the slug is the
 *  one headingsOf derived, the same one a note stores. */
function notesComponents(headings: Heading[]): Components {
  const byLine = new Map(headings.map((h) => [h.line, h]))
  const heading = (depth: 1 | 2 | 3 | 4 | 5 | 6): Components['h1'] =>
    function NotedHeading({ node, children }) {
      const Tag = `h${depth}` as const
      const h = byLine.get(node?.position?.start.line ?? -1)
      if (!h) return <Tag className={HEADING_CLASS[depth]}>{children}</Tag>
      return (
        <>
          <Tag id={h.slug} className={HEADING_CLASS[depth]}>
            {children}
            <NoteToggle slug={h.slug} />
          </Tag>
          <HeadingNotes slug={h.slug} text={h.text} />
        </>
      )
    }
  const Code = components.code!
  return {
    ...components,
    h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    code: (props) => (/language-notes/.test(props.className ?? '') ? <NotesEarlier /> : <Code {...props} />),
  }
}

/** `notes` turns on the notes widget, for a host that keeps answers; it draws only when the
 *  page carries a ```notes block. */
export function ArtifactMarkdown({ markdown, notes }: { markdown: string; notes?: { artifactId: string; accent?: string } }) {
  const on = !!notes && hasNotesWidget(markdown)
  const headings = on ? headingsOf(markdown) : []
  const body = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={on ? notesComponents(headings) : components}>
      {markdown}
    </ReactMarkdown>
  )
  return (
    <div className="text-[17px] text-zinc-200">
      {on ? (
        <NotesProvider artifactId={notes!.artifactId} headings={headings.map(({ slug, text }) => ({ slug, text }))} accent={notes!.accent}>
          {body}
        </NotesProvider>
      ) : body}
    </div>
  )
}
