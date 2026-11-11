// The one tenant this hub serves, built from HUB_TENANT (src/lib/hub-env-parse.ts). Pages live in
// Firestore under tenants/hub/..., so a hub's data paths never depend on its domain.
import { freedomDefault, type BrandPack } from '@supersuit/artifacts/brand'
import type { SignInProviderId } from '@supersuit/artifacts'
import { markFromUrl } from '@/lib/url-mark'
import { parseHubEnv, type HubEnvConfig } from '@/lib/hub-env-parse'

/** A Firebase web app's public config. `authDomain` is the hub's own host: its `/__/auth` is
 *  rewritten to Firebase in next.config.ts, so the Google handler is same-origin. */
export type FirebaseWebConfig = { apiKey: string; appId: string; authDomain: string; projectId: string }

export type Tenant = {
  id: string
  /** The canonical https origin, used in returned URLs and share metadata. */
  siteUrl: string
  pack: BrandPack
  /** Who a confidential page's banner says grants access. */
  owner?: string
  /** Readers sign in on this host against the hub's own Firebase project, with the providers it
   *  turned on (HUB_TENANT `signIn`, default Google only). */
  localSignIn?: { firebase: FirebaseWebConfig; providers: SignInProviderId[] }
  /** False until HUB_TENANT is set: the app builds, and every page says so. */
  configured: boolean
}

/** The default look with the operator's own name on the kicker. */
export function defaultPackFor(name: string): BrandPack {
  return { ...freedomDefault, id: `freedom-default:${name}`, kicker: `A page from ${name}` }
}

export function tenantFromConfig(c: HubEnvConfig | null): Tenant {
  if (!c) return { id: 'hub', siteUrl: 'http://localhost:3000', pack: defaultPackFor('this hub'), configured: false }
  // Fail closed: this template has no other host's table to adopt from, and serving a blank hub
  // over someone's real pages is worse than not starting.
  if (c.adopt) throw new Error(`HUB_TENANT adopt (${c.adopt}) needs the host that holds that tenant; this hub serves its own pages only`)
  const base = defaultPackFor(c.owner)
  const p = c.pack
  const { light: _inherited, ...baseNoLight } = base
  const pack: BrandPack = {
    // A hub with its own pack gets its own id and no inherited light palette, so the package
    // derives light mode from the pack's accent instead of showing the default colors.
    ...(p ? { ...baseNoLight, id: `hub:${c.owner}` } : base),
    ...(p && {
      name: p.name ?? c.owner,
      kicker: p.kicker ?? `A page from ${c.owner}`,
      ground: p.ground,
      ink: p.text,
      accent: p.accent,
      type: { display: p.display ?? base.type.display, body: p.body ?? base.type.body },
      ...(p.light && { light: { ground: p.light.ground, ink: p.light.text, accent: p.light.accent } }),
      ...(p.mark && { Mark: markFromUrl(p.mark.src, p.mark.width, p.mark.height) }),
    }),
  }
  return { id: 'hub', siteUrl: `https://${c.host}`, pack, owner: c.owner, localSignIn: { firebase: c.firebase, providers: c.signIn ?? ['google'] }, configured: true }
}

let cached: Tenant | null = null

/** The hub's tenant, read from HUB_TENANT once. */
export function hubTenant(): Tenant {
  return (cached ??= tenantFromConfig(parseHubEnv(process.env.HUB_TENANT)))
}
