import type { ReactNode } from 'react'
import type { BrandPack } from './pack.js'

/** The page backdrop: the pack's own Wrapper when it has one, else a flat ground. */
export function BrandGround({ pack, children }: { pack: BrandPack; children: ReactNode }) {
  if (pack.Wrapper) return <pack.Wrapper>{children}</pack.Wrapper>
  return (
    <div
      data-brand-ground={pack.id}
      className="min-h-screen"
      style={{ background: pack.ground, color: pack.ink, fontFamily: pack.type.body }}
    >
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
