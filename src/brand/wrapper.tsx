import type { ReactNode } from 'react'
import type { BrandPack } from './pack.js'
import { Bubbles } from './backdrop.js'
import { resolveMode, themeCss, type ThemeMode } from './theme.js'

/** The page backdrop: the pack's own Wrapper when it has one, else its ground (and its animated
 *  backdrop, when it declares one). Either way the colour variables for the mode are set here,
 *  so everything inside paints with them. `mode` is the page's override of the pack's. */
export function BrandGround({ pack, mode, children }: { pack: BrandPack; mode?: ThemeMode; children: ReactNode }) {
  const m = resolveMode(pack, mode)
  const css = <style dangerouslySetInnerHTML={{ __html: themeCss(pack) }} />
  if (pack.Wrapper) {
    // display:contents keeps the wrapper's own layout; custom properties still inherit through it.
    return (
      <div data-artifact-theme={m} style={{ display: 'contents' }}>
        {css}
        <pack.Wrapper>{children}</pack.Wrapper>
      </div>
    )
  }
  return (
    <div
      data-brand-ground={pack.id}
      data-artifact-theme={m}
      className="min-h-screen"
      // isolation puts the fixed backdrop (z-index -1) above this ground and below the page.
      style={{ background: 'var(--a-ground)', color: 'var(--a-ink)', fontFamily: pack.type.body, position: 'relative', isolation: 'isolate' }}
    >
      {css}
      {pack.backdrop?.kind === 'bubbles' ? <Bubbles backdrop={pack.backdrop} /> : null}
      {children}
    </div>
  )
}

/** The mark above the kicker: the pack's own, else a small dove. */
export function BrandMark({ pack, className }: { pack: BrandPack; className?: string }) {
  if (pack.Mark) return <pack.Mark className={className} />
  return (
    <span data-brand-mark={pack.id} aria-hidden className={className} style={{ color: pack.accent }}>
      🕊
    </span>
  )
}
