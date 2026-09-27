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
}

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
