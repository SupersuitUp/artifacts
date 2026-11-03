// The root layout's metadata for a hub, as a pure function. Imports only types.
import type { Metadata } from 'next'
import type { HubEnvConfig } from './hub-env-parse'

export function hubMetadata(hub: HubEnvConfig | null): Metadata {
  const pack = hub?.pack
  return {
    title: pack ? (pack.name ?? hub!.owner) : hub ? hub.owner : 'Artifacts',
    robots: { index: false, follow: false },
    ...(pack?.favicon && { icons: { icon: pack.favicon } }),
  }
}
