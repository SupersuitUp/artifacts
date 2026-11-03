// The HUB_TENANT parser, with no imports at all, so next.config.ts can read the same value the
// app reads without pulling React into Next's config loader. HUB_TENANT is what makes this app one
// operator's hub, deployed into their own Firebase project; create-or-update-my-artifact-hub sets it.

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** A hub's own brand look, validated. Required: ground, text, accent. Everything else optional. */
export type HubPack = {
  name?: string
  kicker?: string
  ground: string
  text: string
  accent: string
  display?: string
  body?: string
  fontsUrl?: string
  light?: { ground: string; text: string; accent: string }
  mark?: { src: string; width: number; height: number }
  favicon?: string
}

function hex(v: unknown, field: string): string {
  if (typeof v !== 'string' || !HEX.test(v)) throw new Error(`HUB_TENANT ${field} must be a hex color like #rrggbb`)
  return v
}
function str(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !v.trim()) throw new Error(`HUB_TENANT ${field} must be a non-empty string`)
  return v.trim()
}
function https(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined
  let ok = false
  try { ok = typeof v === 'string' && new URL(v).protocol === 'https:' } catch { /* not a url */ }
  if (!ok) throw new Error(`HUB_TENANT ${field} must be an https: url`)
  return v as string
}
function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`HUB_TENANT ${field} must be a positive number`)
  return v
}

function parsePack(p: any): HubPack {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('HUB_TENANT pack must be an object')
  const out: HubPack = { ground: hex(p.ground, 'pack.ground'), text: hex(p.text, 'pack.text'), accent: hex(p.accent, 'pack.accent') }
  const name = str(p.name, 'pack.name'); if (name) out.name = name
  const kicker = str(p.kicker, 'pack.kicker'); if (kicker) out.kicker = kicker
  const display = str(p.display, 'pack.display'); if (display) out.display = display
  const body = str(p.body, 'pack.body'); if (body) out.body = body
  const fontsUrl = https(p.fontsUrl, 'pack.fontsUrl'); if (fontsUrl) out.fontsUrl = fontsUrl
  const favicon = https(p.favicon, 'pack.favicon'); if (favicon) out.favicon = favicon
  if (p.light !== undefined) {
    out.light = { ground: hex(p.light?.ground, 'pack.light.ground'), text: hex(p.light?.text, 'pack.light.text'), accent: hex(p.light?.accent, 'pack.light.accent') }
  }
  if (p.mark !== undefined) {
    out.mark = { src: https(p.mark?.src, 'pack.mark.src') ?? (() => { throw new Error('HUB_TENANT pack.mark.src must be an https: url') })(), width: num(p.mark?.width, 'pack.mark.width'), height: num(p.mark?.height, 'pack.mark.height') }
  }
  return out
}

export type HubEnvConfig = {
  host: string
  owner: string
  firebase: { apiKey: string; appId: string; authDomain: string; projectId: string }
  /** A tenant id of another host's table, served in place. This template carries no such table, so
   *  a hub that names one refuses to start (src/tenant.ts) rather than serve a blank hub. */
  adopt?: string
  /** The hub's own brand look. Not with `adopt`: an adopted row has its own look. */
  pack?: HubPack
}

export function parseHubEnv(raw: string | undefined): HubEnvConfig | null {
  if (!raw?.trim()) return null
  const c = JSON.parse(raw)
  if (!c.firebase?.projectId) throw new Error('HUB_TENANT has no firebase block; a sovereign hub must sign its own readers in')
  const host = typeof c.host === 'string' ? c.host.trim().toLowerCase() : ''
  const owner = typeof c.owner === 'string' ? c.owner.trim() : ''
  if (!host) throw new Error('HUB_TENANT has no host')
  if (!owner) throw new Error('HUB_TENANT has no owner')
  if (String(c.firebase.authDomain ?? '').trim().toLowerCase() !== host) {
    throw new Error('HUB_TENANT firebase.authDomain must equal host: the same-origin /__/auth rewrite depends on it')
  }
  if (c.adopt !== undefined && (typeof c.adopt !== 'string' || !c.adopt.trim())) {
    throw new Error('HUB_TENANT adopt must be a non-empty tenant id')
  }
  const adopt = typeof c.adopt === 'string' ? c.adopt.trim() : undefined
  if (adopt && c.pack !== undefined) throw new Error('HUB_TENANT cannot carry both adopt and pack: an adopted row has its own look')
  const pack = c.pack !== undefined ? parsePack(c.pack) : undefined
  return { host, owner, firebase: c.firebase, ...(adopt ? { adopt } : {}), ...(pack ? { pack } : {}) }
}
