// What the hub's pages actually render in, reduced to three colours, for /brand.json. Supersuit's
// publish script compares this with the brand universe the operator's workspace loads, so a pack
// that has fallen behind is named on the next publish instead of being noticed by eye. The pack's opening mode decides which
// palette counts: a light-mode pack renders its `light` palette, every other its dark one.
import type { BrandPack } from '@supersuit/artifacts/brand'

export type BrandColors = { ground: string; text: string; accent: string; mode: string; pack: string }

export function brandColors(pack: BrandPack): BrandColors {
  const mode = pack.mode ?? 'dark'
  const p = mode === 'light' && pack.light ? pack.light : { ground: pack.ground, ink: pack.ink, accent: pack.accent }
  return { ground: p.ground, text: p.ink, accent: p.accent, mode, pack: pack.id }
}
