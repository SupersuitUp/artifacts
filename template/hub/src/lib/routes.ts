// The hub's shell routes, built once. Storage lives in the hub's own Firestore under tenants/hub/.
// Every app/ route file is a thin call into what this returns.
import { createArtifactAssets, createArtifactRoutes, createArtifactStore, createPersonalStore, createReadersStore, createRecipientsStore, createStateStore } from '@supersuit/artifacts'
import { getAdminBucket, getAdminDb, getAdminPrivateBucket } from '@/lib/firebase-admin'
import { admins, ownerEmail, publishKey } from '@/lib/hub-env'
import { hubTenant } from '@/tenant'

/** The line a private page's door shows: readers sign in here, with Google. */
export const LOCAL_SIGN_IN_NOTE = 'This page is private. Sign in with the Google account it was shared with.'

let routes: ReturnType<typeof createArtifactRoutes> | null = null

export function hubRoutes() {
  if (routes) return routes
  const tenant = hubTenant()
  const base = `tenants/${tenant.id}/artifact`
  routes = createArtifactRoutes({
    store: createArtifactStore(getAdminDb(), `tenants/${tenant.id}/artifacts`),
    // Private media goes to its own bucket (ARTIFACT_PRIVATE_BUCKET); with none, the package
    // refuses `media: private` rather than storing it where the public read grant reaches it.
    assets: createArtifactAssets(getAdminBucket(), `tenants/${tenant.id}/artifacts`, { privateBucket: getAdminPrivateBucket() }),
    brand: tenant.pack,
    siteUrl: tenant.siteUrl,
    publishKey: () => publishKey(),
    // Gated pages (`access:` in front matter): readers sign in on this host and get a pass.
    readers: createReadersStore(getAdminDb(), base),
    readerSecret: () => process.env.ARTIFACT_PASS_SECRET,
    signInOrigin: tenant.siteUrl,
    signInNote: LOCAL_SIGN_IN_NOTE,
    // Per-reader links (`links: per-reader`): who each link was made for, signed with one secret.
    recipients: createRecipientsStore(getAdminDb(), base),
    recipientSecret: () => process.env.ARTIFACT_RECIPIENT_SECRET?.trim() || undefined,
    // Readers' answers on pages that declare `state:`. firestore.indexes.json carries the composite
    // its comments feed needs (artifactState: slot, at).
    state: createStateStore(getAdminDb(), base),
    // Readers' personal notes: a store no publisher route reads, so "only you will see this" is true.
    personal: createPersonalStore(getAdminDb(), base),
    owner: tenant.owner,
    ownerEmail: ownerEmail(),
    admins: admins(),
    history: 'admins',
  })
  return routes
}
