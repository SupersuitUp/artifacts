// The hub's shell routes, built once. Storage lives in the hub's own Firestore under tenants/hub/.
// Every app/ route file is a thin call into what this returns.
import { createArtifactAssets, createArtifactRoutes, createArtifactStore, createPersonalStore, createReadersStore, createRecipientsStore, createRecordStore, createStateStore } from '@supersuit/artifacts'
import { getAdminBucket, getAdminDb, getAdminPrivateBucket } from '@/lib/firebase-admin'
import { admins, ownerEmail, publishKey } from '@/lib/hub-env'
import { hubTenant } from '@/tenant'
import { signInNoteFor } from '@/lib/door-note'

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
    // The door names the providers this hub turned on (Google, Microsoft or both).
    signInNote: signInNoteFor(tenant.localSignIn?.providers),
    // Per-reader links (`links: per-reader`): who each link was made for, signed with one secret.
    recipients: createRecipientsStore(getAdminDb(), base),
    recipientSecret: () => process.env.ARTIFACT_RECIPIENT_SECRET?.trim() || undefined,
    // The recorder's batches (/record/<batch>): the owner records voice eCards, one person at a time.
    record: createRecordStore(getAdminDb(), base),
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
