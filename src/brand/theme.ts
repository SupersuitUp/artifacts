// Light, dark, or the reader's device. A pack's top-level ground/ink/accent are its dark
// palette (every pack before 0.4.0 was dark); `light` is the other half, and `mode` picks which
// one a page opens in. A page can override the mode with `theme:` in its front matter.
//
// The page never paints a colour directly: the route renders with `themedPack`, whose colours
// are CSS variables, and `themeCss` defines those variables per mode. That is what lets
// `system` switch with the device, which a colour baked into an inline style never could.
import type { BrandPack, Palette } from './pack.js'

export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/** The light palette a pack gets when it declares none: warm paper, near-black ink, and its
 *  own accent, which every shipped accent is dark enough to read on. */
const FALLBACK_LIGHT = { ground: '#f7f3ea', ink: '#1d1b17' }

export function resolveMode(pack: BrandPack, page?: ThemeMode): ThemeMode {
  return page ?? pack.mode ?? 'dark'
}

function vars(p: Palette, scheme: 'light' | 'dark'): string {
  return `--a-ground:${p.ground};--a-ink:${p.ink};--a-accent:${p.accent};color-scheme:${scheme}`
}

/** The stylesheet for one pack: its two palettes, the tones derived from them, and the
 *  device switch for `system`. */
export function themeCss(pack: BrandPack): string {
  const dark: Palette = { ground: pack.ground, ink: pack.ink, accent: pack.accent }
  const light: Palette = pack.light ?? { ...FALLBACK_LIGHT, accent: pack.accent }
  const mix = (n: number) => `color-mix(in srgb,var(--a-ink) ${n}%,var(--a-ground))`
  return [
    `[data-artifact-theme]{--a-strong:var(--a-ink);--a-body:${mix(86)};--a-muted:${mix(55)};` +
      `--a-line:${mix(12)};--a-line-strong:${mix(28)};--a-surface:${mix(4)};--a-surface-strong:${mix(9)};` +
      `--a-code:${mix(6)};--a-on-accent:var(--a-ground)}`,
    `[data-artifact-theme="dark"]{${vars(dark, 'dark')}}`,
    `[data-artifact-theme="light"]{${vars(light, 'light')}}`,
    `[data-artifact-theme="system"]{${vars(dark, 'dark')}}`,
    `@media (prefers-color-scheme: light){[data-artifact-theme="system"]{${vars(light, 'light')}}}`,
  ].join('\n')
}

/** The pack as the page renders it: every colour is the variable the mode sets. */
export function themedPack(pack: BrandPack): BrandPack {
  return { ...pack, ground: 'var(--a-ground)', ink: 'var(--a-ink)', accent: 'var(--a-accent)' }
}
