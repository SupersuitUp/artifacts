import type { ComponentType, ReactNode } from 'react'
import { newsreader } from './default-share.js'
import type { ThemeMode } from './theme.js'

/** One set of page colours. */
export type Palette = { ground: string; ink: string; accent: string }

/** The animated ground behind a page. `bubbles` is soft colour drifting under a veil of the
 *  ground colour. Colours are `r,g,b` triplets. */
export type Backdrop = { kind: 'bubbles'; colors?: string[]; veil?: number }

/**
 * A brand pack is what makes an operator's pages theirs: data plus at most two
 * components. The package ships `freedomDefault`; an instance passes its own. A pack
 * that carries anyone's trademark lives in that instance, never in this package.
 */
export type BrandPack = {
  id: string
  name: string
  /** CSS colours: the DARK palette, which is every pack's original one. */
  ground: string
  ink: string
  accent: string
  /** The light palette. Absent, a warm paper palette with this pack's accent is used. */
  light?: Palette
  /** The mode a page opens in unless its front matter says otherwise. Default `dark`. */
  mode?: ThemeMode
  /** An animated ground drawn behind the page. Ignored when the pack has its own Wrapper. */
  backdrop?: Backdrop
  /** CSS font-family values for headings and body. */
  type: { display: string; body: string }
  /** The small uppercase line above a title, e.g. "From Sam Rivera". */
  kicker: string
  /** The label under the play button, by narrator voice id. */
  narratorLabel: (voice?: string) => string
  /** Optional full-page backdrop. Receives the page as children. */
  Wrapper?: ComponentType<{ children: ReactNode }>
  /** Optional mark rendered once above the kicker. */
  Mark?: ComponentType<{ className?: string }>
  /** How a page with no cover unfurls: the shell draws its title over these, so a link
   *  previews as the page rather than as the brand. Absent, the instance's static default
   *  share image is used. Both loaders run once per instance. */
  share?: ShareCardAssets
  /** Optional: draws the page's title block instead of the default centred header. Receives the
   *  title, subtitle and summary to render (they are SPOKEN, in that order, so render all three),
   *  plus the shell's unspoken kicker and version line to place. Anything else it draws must be
   *  inside `data-nospeak`, or the read-along highlight loses its place. */
  Cover?: ComponentType<CoverProps>
  /** Optional: the element that holds the title block and the body, instead of the default
   *  centred column. Receives the cover (the pack's Cover or the default header), the inline
   *  table of contents when the page shows one, and the body. */
  Article?: ComponentType<ArticleProps>
  /** Optional: each top-level section of the body (split at the shallowest heading level the page
   *  uses) is rendered through this, so a pack can draw a break before it or wrap it. Content
   *  before the first such heading is left as it is. Decoration must be `data-nospeak`. */
  Section?: ComponentType<SectionProps>
  /** Optional: replaces an image (or `.mp4`/`.mp3` embed) with a component, by its src. Return
   *  undefined to keep the default. The shell wraps the result in `data-nospeak`, and an image
   *  alone in its paragraph replaces the paragraph, so the component may draw block content. */
  figure?: (src: string, alt: string) => ComponentType<FigureProps> | undefined
}

export type CoverProps = {
  title: string
  subtitle?: string
  summary: string
  /** Who the page is for, when it says. Already inside `kicker`. */
  to?: string
  /** The body, for a cover that quotes from it (anything quoted must be `data-nospeak`). */
  markdown: string
  /** The shell's kicker line (the pack's kicker, then who it is for), unspoken. */
  kicker: ReactNode
  /** The version line and, for a signed-in reader, who they are signed in as. Unspoken. */
  meta: ReactNode
  version: number
  updatedAt: string
  createdAt: string
}

export type ArticleProps = { cover: ReactNode; toc: ReactNode; children: ReactNode }

/** One top-level heading of the page, in order. */
export type SectionOutline = { index: number; depth: number; text: string; slug: string }

export type SectionProps = {
  /** This section's place among the page's top-level sections, from 0, and how many there are. */
  index: number
  count: number
  /** Every top-level section, so a pack can tell what came before and what comes next. */
  outline: SectionOutline[]
  /** The heading's plain text and slug (its id, which the table of contents links to). */
  text: string
  slug: string
  /** The heading as the shell draws it by default. */
  heading: ReactNode
  /** The heading's inner content and the attributes it carries (its id and its comment anchor),
   *  for a pack that draws the heading element itself. Put the attributes on whatever holds it. */
  headingContent: ReactNode
  headingAttrs: { id?: string; 'data-block'?: string }
  /** Everything under the heading, up to the next top-level heading. */
  children: ReactNode
}

export type FigureProps = { src: string; alt: string }

export type ShareCardAssets = {
  /** The display font, as bytes the renderer can embed. Satori needs a real file: a CSS
   *  font-family name is not enough. */
  font: () => Promise<{ name: string; data: ArrayBuffer; weight: number }>
  /** A 1200x630 image as a data: URL, drawn full-bleed under the text. Anything that needs
   *  a blur or a glow is baked in here; the renderer only sets type. Absent, `ground` fills. */
  backdrop?: () => Promise<string>
}

export const freedomDefault: BrandPack = {
  id: 'freedom-default',
  name: 'Freedom',
  ground: '#0e0f13',
  ink: '#ece7dc',
  accent: '#c9a96e',
  light: { ground: '#f6f1e7', ink: '#1c1a17', accent: '#8a6a2c' },
  type: {
    display: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  kicker: 'A page from Freedom',
  narratorLabel: () => 'Read aloud by Freedom',
  // Pages unfurl as their title on the ground colour. A pack with a backdrop of its own
  // overrides this whole field.
  share: { font: newsreader },
}
