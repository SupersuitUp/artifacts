// Markdown to the house look, for /a/<id>. Server-safe: no hooks, no client
// directive. Raw HTML is escaped by react-markdown's default; never add
// rehype-raw here, this renders strangers' links on a public route.
// Two extensions past GFM, both small on purpose:
//   ```links   one "url | note" per line, rendered as link cards
//   > [!note] / > [!warning]   a callout instead of a blockquote
import { Children, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Root, RootContent } from 'mdast'
import type { FigureProps, SectionOutline, SectionProps } from '../brand/pack.js'
import { blocksOf, hasNotesWidget, headingsOf, type Heading } from './widgets.js'
import { HeadingNotes, NoteToggle, NotesEarlier, NotesProvider } from '../widgets/notes.js'
import { VideoAutoplay } from '../reader/video-autoplay.js'
import { DefinitionLayer } from '../reader/definition-layer.js'
import { remarkDefinitions, type Definition } from './definitions.js'

// Every colour is a theme variable (brand/theme.ts), so a page follows its light, dark or system mode.
const GOLD = 'var(--a-accent)'

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
            className="block rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-surface)] px-4 py-3 no-underline transition-colors hover:border-[color:var(--a-line-strong)]"
          >
            <span className="block text-[11px] uppercase tracking-[0.2em]" style={{ color: GOLD }}>
              {hostOf(r.url)}
            </span>
            <span className="block text-[color:var(--a-strong)]">{r.note || r.url}</span>
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

/** `![alt](x.mp4)` plays as video: an animation that must stay smooth on a phone. Animated WebP
 *  is decoded frame by frame on the CPU and stuttered on an iPhone at 24fps (2026-09-27); video
 *  is decoded in hardware. */
const VIDEO = /\.mp4(?:[?#].*)?$/i
/** `![caption](x.mp3)` is a clip the reader plays: an annotated conversation, a voice note, a
 *  quote heard rather than read. Native controls, and `preload="none"` so a page of clips fetches
 *  nothing until one is pressed. The alt is its caption, shown above the player. */
const AUDIO = /\.mp3(?:[?#].*)?$/i
const VIDEO_IN_MD = /\]\([^)\s]+\.mp4(?:[?#][^)]*)?\)/i
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Written as markup, not JSX: React renders `muted` as a property and leaves it out of server
// HTML, and iOS refuses to play a video unprompted whose markup is not muted. `playsinline` keeps
// iPhone from going full screen. No `autoplay`: VideoAutoplay starts each one as it nears the
// screen, so a page of videos does not download them all on open.
function InlineVideo({ src, label }: { src: string; label: string }) {
  const html = `<video src="${escapeAttr(src)}" aria-label="${escapeAttr(label)}" data-artifact-video muted loop playsinline preload="metadata" disablepictureinpicture class="block w-full"></video>`
  return <span className="my-6 block overflow-hidden rounded-lg border border-[color:var(--a-line)]" dangerouslySetInnerHTML={{ __html: html }} />
}

function InlineAudio({ src, label }: { src: string; label: string }) {
  const html = `<audio src="${escapeAttr(src)}" aria-label="${escapeAttr(label)}" data-artifact-audio controls preload="none" class="block w-full"></audio>`
  return (
    <span className="my-6 block rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-surface)] px-4 py-3">
      {label ? <span className="mb-2 block text-sm text-[color:var(--a-strong)]">{label}</span> : null}
      <span className="block" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  )
}

type Positioned = { position?: { start: { offset?: number } } } | undefined
/** `data-block` for a top-level block: the id a region comment is pinned to (widgets.blocksOf). */
type BlockAttr = (node: Positioned) => { 'data-block'?: string }

/** A pack's figure resolver (BrandPack.figure). */
export type FigureFor = (src: string, alt: string) => ComponentType<FigureProps> | undefined
type HastLike = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastLike[] }

/** The one image a paragraph holds and nothing else (whitespace aside), or null. */
function soleImage(node: unknown): { src: string; alt: string } | null {
  const kids = ((node as HastLike | undefined)?.children ?? []).filter((c) => !(c.type === 'text' && !c.value?.trim()))
  if (kids.length !== 1 || kids[0].type !== 'element' || kids[0].tagName !== 'img') return null
  const src = kids[0].properties?.src
  return typeof src === 'string' ? { src, alt: String(kids[0].properties?.alt ?? '') } : null
}

function baseComponents(block: BlockAttr, figure?: FigureFor): Components {
  return {
  p: ({ node, children }) => {
    // An image alone in its paragraph that the pack draws itself replaces the paragraph, so the
    // pack's figure may hold block content (a <p> cannot) and still carry the comment anchor.
    const img = figure ? soleImage(node) : null
    const F = img ? figure!(img.src, img.alt) : undefined
    if (img && F) {
      return (
        <div {...block(node)} data-nospeak data-artifact-figure>
          <F src={img.src} alt={img.alt} />
        </div>
      )
    }
    return <p {...block(node)} className="my-4 leading-relaxed">{children}</p>
  },
  ul: ({ node, children }) => <ul {...block(node)} className="my-4 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ node, children }) => <ol {...block(node)} className="my-4 list-decimal space-y-1 pl-6">{children}</ol>,
  hr: () => <hr className="my-10 border-[color:var(--a-line)]" />,
  table: ({ node, children }) => (
    <div {...block(node)} className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-[color:var(--a-line-strong)] px-3 py-2 text-left font-semibold text-[color:var(--a-strong)]">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-[color:var(--a-line)] px-3 py-2 align-top">{children}</td>,
  img: ({ src, alt }) => {
    const F = typeof src === 'string' ? figure?.(src, alt ?? '') : undefined
    if (F) {
      return (
        <span data-nospeak data-artifact-figure className="block">
          <F src={src as string} alt={alt ?? ''} />
        </span>
      )
    }
    return typeof src === 'string' && VIDEO.test(src) ? (
      <InlineVideo src={src} label={alt ?? ''} />
    ) : typeof src === 'string' && AUDIO.test(src) ? (
      <InlineAudio src={src} label={alt ?? ''} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="my-6 w-full rounded-lg border border-[color:var(--a-line)]" />
    )
  },
  a: ({ href, children }) =>
    !isReachableHref(href) ? (
      <span>{children}</span>
    ) : (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[color:var(--a-strong)] underline decoration-[color:var(--a-line-strong)] underline-offset-4 hover:decoration-[color:var(--a-strong)]"
    >
      {children}
      {href && hostOf(href) ? (
        <span data-nospeak className="ml-1 text-xs text-[color:var(--a-muted)]">
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
      return <code className="rounded bg-[color:var(--a-surface-strong)] px-1.5 py-0.5 text-[0.9em] text-[color:var(--a-strong)]">{children}</code>
    }
    return <code className={className}>{children}</code>
  },
  pre: ({ node, children }) => {
    // A links fence renders its own block; do not wrap it in <pre>.
    const inner = Array.isArray(children) ? children[0] : children
    const cls = (inner as { props?: { className?: string } })?.props?.className ?? ''
    if (/language-(links|notes)/.test(cls)) return <>{children}</>
    return (
      <pre
        {...block(node)}
        data-artifact-code
        className="my-6 overflow-x-auto rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-code)] p-4 text-sm text-[color:var(--a-strong)]"
      >
        {children}
      </pre>
    )
  },
  blockquote: ({ node, children }) => {
    const t = textOf(children).trim()
    const m = CALLOUT.exec(t)
    if (!m) {
      return (
        <blockquote {...block(node)} className="my-6 border-l-2 pl-4 italic text-[color:var(--a-body)]" style={{ borderColor: GOLD }}>
          {children}
        </blockquote>
      )
    }
    const kind = m[1].toLowerCase()
    const body = t.replace(CALLOUT, '')
    return (
      <aside
        {...block(node)}
        data-callout={kind}
        className="my-6 rounded-lg border px-4 py-3"
        style={{ borderColor: kind === 'warning' ? '#d97706' : GOLD, background: 'var(--a-surface)' }}
      >
        <span data-nospeak className="block text-[11px] uppercase tracking-[0.2em]" style={{ color: GOLD }}>
          {kind}
        </span>
        <p className="mt-1 text-[color:var(--a-strong)]">{body}</p>
      </aside>
    )
  },
  }
}

// scroll-mt keeps a heading clear of the top of the screen when a contents link jumps to it.
const HEADING_CLASS: Record<number, string> = {
  1: 'mt-10 mb-4 scroll-mt-24 font-serif text-3xl text-[color:var(--a-strong)]',
  2: 'mt-10 mb-3 scroll-mt-24 font-serif text-2xl text-[color:var(--a-strong)]',
  3: 'mt-8 mb-2 scroll-mt-24 text-lg font-semibold text-[color:var(--a-strong)]',
  4: 'mt-6 mb-2 scroll-mt-24 font-semibold text-[color:var(--a-strong)]',
  5: 'mt-6 mb-2 scroll-mt-24 font-semibold text-[color:var(--a-strong)]',
  6: 'mt-6 mb-2 scroll-mt-24 font-semibold text-[color:var(--a-strong)]',
}

/** Components for any page: every heading gets its slug as an id, the one headingsOf derived,
 *  so a contents link and a note both land on it. */
function pageComponents(headings: Heading[], block: BlockAttr, figure?: FigureFor): Components {
  const byLine = new Map(headings.map((h) => [h.line, h]))
  const heading = (depth: 1 | 2 | 3 | 4 | 5 | 6): Components['h1'] =>
    function Heading({ node, children }) {
      const Tag = `h${depth}` as const
      const h = byLine.get(node?.position?.start.line ?? -1)
      return <Tag id={h?.slug} {...block(node)} className={HEADING_CLASS[depth]}>{children}</Tag>
    }
  return { ...baseComponents(block, figure), h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6) }
}

/** Components for a page with a notes block: every heading gets its slug as an id, a note
 *  control, and its notes after it. The heading is found by its source line, so the slug is the
 *  one headingsOf derived, the same one a note stores. */
function notesComponents(headings: Heading[], block: BlockAttr, figure?: FigureFor): Components {
  const components = baseComponents(block, figure)
  const byLine = new Map(headings.map((h) => [h.line, h]))
  const heading = (depth: 1 | 2 | 3 | 4 | 5 | 6): Components['h1'] =>
    function NotedHeading({ node, children }) {
      const Tag = `h${depth}` as const
      const h = byLine.get(node?.position?.start.line ?? -1)
      if (!h) return <Tag {...block(node)} className={HEADING_CLASS[depth]}>{children}</Tag>
      return (
        <>
          <Tag id={h.slug} {...block(node)} className={HEADING_CLASS[depth]}>
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

/** The page's top-level sections: every heading among the body's top-level blocks at the
 *  shallowest depth any of them uses. Headings inside lists or quotes never start a section. */
export function sectionOutline(markdown: string, headings: Heading[] = headingsOf(markdown)): SectionOutline[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const tops = tree.children.filter((n): n is Extract<RootContent, { type: 'heading' }> => n.type === 'heading')
  if (!tops.length) return []
  const depth = Math.min(...tops.map((h) => h.depth))
  const byLine = new Map(headings.map((h) => [h.line, h]))
  return tops
    .filter((h) => h.depth === depth)
    .map((h, index) => {
      const known = byLine.get(h.position?.start.line ?? -1)
      return { index, depth, text: known?.text ?? '', slug: known?.slug ?? '' }
    })
}

/** Groups the root's blocks into one node per top-level section (a heading at `depth` and what
 *  follows it up to the next), so the renderer can hand each to the pack's Section. The blocks
 *  keep their positions, so comment anchors and heading slugs are exactly what they were. */
function remarkSections(depth: number) {
  return () => (tree: Root) => {
    const out: RootContent[] = []
    let body: { children: RootContent[] } | null = null
    let i = 0
    for (const n of tree.children) {
      if (n.type === 'heading' && n.depth === depth) {
        body = { children: [] }
        const b = { type: 'artifactSectionBody', data: { hName: 'div', hProperties: { dataArtifactSectionBody: '' } }, children: body.children }
        out.push({ type: 'artifactSection', data: { hName: 'section', hProperties: { dataArtifactSection: String(i++) } }, children: [n, b] } as unknown as RootContent)
      } else if (body) body.children.push(n)
      else out.push(n)
    }
    tree.children = out
  }
}

function sectionComponent(Section: ComponentType<SectionProps>, outline: SectionOutline[], block: BlockAttr): Components['section'] {
  return function ArtifactSection({ node, children }) {
    const i = Number((node?.properties as Record<string, unknown> | undefined)?.dataArtifactSection)
    const o = outline[i]
    // Not one of ours (a raw <section> never reaches here: raw HTML is escaped).
    if (!o) return <section>{children}</section>
    const [heading, body] = Children.toArray(children).filter(isValidElement) as ReactElement<{ children?: ReactNode; node?: Positioned }>[]
    return (
      <Section
        index={i}
        count={outline.length}
        outline={outline}
        text={o.text}
        slug={o.slug}
        heading={heading}
        headingContent={heading?.props.children}
        headingAttrs={{ id: o.slug, ...block(heading?.props.node) }}
      >
        {body?.props.children}
      </Section>
    )
  }
}

// The term is text with a dotted underline; the description copy is visually hidden and out of
// flow (absolute), so it takes no room in the line. Neither ever changes size: the definition
// that opens is drawn by DefinitionLayer on document.body.
const DEFINED_TERM_CSS =
  '.artifact-defined-term{text-decoration-line:underline;text-decoration-style:dotted;' +
  'text-decoration-color:color-mix(in srgb,currentColor 55%,transparent);text-decoration-thickness:0.08em;' +
  'text-underline-offset:0.2em;text-decoration-skip-ink:none;cursor:help;-webkit-tap-highlight-color:transparent}' +
  '.artifact-defined-term:hover,.artifact-defined-term[aria-expanded="true"]{text-decoration-color:currentColor}' +
  '.artifact-defined-term:focus-visible{outline:2px solid var(--a-accent);outline-offset:2px;border-radius:2px}' +
  '.artifact-defined-term .artifact-word{cursor:inherit}' +
  '@media (hover:none){.artifact-defined-term{cursor:pointer}}' +
  '.artifact-defined-note{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
  'clip:rect(0,0,0,0);white-space:nowrap;border:0}'

/** `notes` turns on the notes widget, for a host that keeps answers; it draws only when the
 *  page carries a ```notes block. */
export function ArtifactMarkdown({
  markdown,
  notes,
  definitions,
  Section,
  figure,
}: {
  markdown: string
  /** The pack's section component (BrandPack.Section): each top-level section is drawn through it. */
  Section?: ComponentType<SectionProps>
  /** The pack's figure resolver (BrandPack.figure). */
  figure?: FigureFor
  notes?: { artifactId: string; accent?: string }
  /** Terms to define inline (front matter `definitions:`): the first occurrence of each is underlined. */
  definitions?: Definition[]
}) {
  const on = !!notes && hasNotesWidget(markdown)
  const headings = headingsOf(markdown)
  const blocks = blocksOf(markdown)
  const block: BlockAttr = (node) => {
    const id = blocks.get(node?.position?.start.offset ?? -1)
    return id ? { 'data-block': id } : {}
  }
  const defined = definitions?.length ? definitions : null
  const outline = Section ? sectionOutline(markdown, headings) : []
  const plugins = [remarkGfm, ...(defined ? [remarkDefinitions(defined)] : []), ...(outline.length ? [remarkSections(outline[0].depth)] : [])]
  const components = on ? notesComponents(headings, block, figure) : pageComponents(headings, block, figure)
  if (outline.length) components.section = sectionComponent(Section!, outline, block)
  const body = (
    <ReactMarkdown remarkPlugins={plugins} components={components}>
      {markdown}
    </ReactMarkdown>
  )
  return (
    // break-words: a bare URL in prose is one unbreakable word and pushed phones 7px sideways (2026-09-26).
    <div className="break-words text-[17px] text-[color:var(--a-body)]">
      {on ? (
        <NotesProvider artifactId={notes!.artifactId} headings={headings.map(({ slug, text }) => ({ slug, text }))} accent={notes!.accent}>
          {body}
        </NotesProvider>
      ) : body}
      {VIDEO_IN_MD.test(markdown) ? <VideoAutoplay /> : null}
      {defined ? (
        <>
          <style>{DEFINED_TERM_CSS}</style>
          <DefinitionLayer />
        </>
      ) : null}
    </div>
  )
}
