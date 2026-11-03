// The door wears the hub it is served on (src/lib/frapp-door.mjs). The door is plain HTML under a
// strict CSP, so a pack's React parts (Wrapper, Mark) cannot run there; this reduces a pack to what
// plain HTML can wear: its palettes, its kicker and its display face (served by /frapp/font from
// the pack's own share-card font).
import { createHash } from 'node:crypto'
import type { BrandPack } from '@supersuit/artifacts/brand'
import { DOOR_SCRIPT, type DoorTheme } from './frapp-door.mjs'
import type { Tenant } from '@/tenant'

/** A CSS font stack with its `var(--…)` entries dropped: the door loads no next/font variables. */
export function plainStack(stack: string): string {
  const parts = stack.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('var('))
  return parts.length ? parts.join(', ') : 'Georgia, serif'
}

export function doorTheme(tenant: Tenant, pack: BrandPack = tenant.pack): DoorTheme {
  return {
    name: pack.name,
    kicker: pack.kicker,
    scheme: pack.mode ?? 'dark',
    dark: { ground: pack.ground, ink: pack.ink, accent: pack.accent },
    light: pack.light ?? null,
    display: plainStack(pack.type.display),
    font: Boolean(pack.share?.font),
    mark: null,
    backdrop: null,
  }
}

const SCRIPT_HASH = createHash('sha256').update(DOOR_SCRIPT).digest('base64')

/** The door's CSP. Nothing loads but its own inline script (by hash) and style, its own mark,
 *  backdrop and face, and the one probe the page makes, which may only go to a tailnet host. */
export const DOOR_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${SCRIPT_HASH}'`,
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  'connect-src https://*.ts.net',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

// renderShareCard caches a pack's font and backdrop by pack object, so one derived pack per
// tenant and kicker keeps that cache warm.
const cardPacks = new Map<string, BrandPack>()

/** The tenant's pack with the door card's kicker on it, for the shell's share card. */
export function cardPack(tenantId: string, pack: BrandPack, kicker: string): BrandPack {
  const key = `${tenantId}\u0000${kicker}`
  let p = cardPacks.get(key)
  if (!p) cardPacks.set(key, (p = { ...pack, kicker }))
  return p
}
