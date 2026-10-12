import { applySettingsPatch, createArtifactRoutes, createMemoryPersonalStore, createMemoryResolveDigestStore, createMemoryStateStore, createResolveDigests, type DigestMessage, freedomDefault, type AllowEntry, type ArtifactRecord, type ArtifactStore, type ReadersStore } from '@supersuit/artifacts'

/** Signs the fixture's admin in: check-packed (and a headless browser) mint a grant with it. Not a secret. */
export const FIXTURE_READER_SECRET = 'fixture-reader-secret'
// The settings the page menu's sheets change (0.31.0), kept per page for the life of the server.
// On globalThis: Next bundles this module once per route, and the page must see what the
// settings route wrote.
const shared = ((globalThis as { __fixtureSettings?: { settings: Map<string, Partial<ArtifactRecord>>; list: AllowEntry[] } }).__fixtureSettings ??=
  { settings: new Map(), list: [{ email: 'dana@example.com', name: 'Dana Ruiz' }] })
const settings = shared.settings
const readers: ReadersStore = {
  allowList: async () => shared.list,
  allow: async (_id, add, remove) => { shared.list = [...shared.list.filter((e) => !remove.includes(e.email)), ...add]; return shared.list },
  touchSession: async () => {}, flag: async () => {}, sessions: async () => [], flags: async () => [],
  acknowledged: async () => true, acknowledge: async () => {}, acks: async () => [],
}

const records: ArtifactStore['get'] = async (id): Promise<ArtifactRecord | null> => (id === 'abc23456'
    ? {
        id, title: 'Fixture', summary: 'S', template: 'document', markdown: '# hi\n\nThe harness runs, and the harness reads.',
        definitions: [{ term: 'harness', text: 'The agent loop.' }],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', version: 2, note: 'Second pass', views: 0,
        state: { writers: 'anyone', visibility: 'tally', slots: { vote: { shape: 'one' } } },
      }
    : id === 'nts23456'
      ? {
          id, title: 'Notes', summary: 'S', template: 'document', markdown: '## Sales\n\nWords.\n\n```notes\n```\n',
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', versions: [], views: 0,
          state: { writers: 'anyone', visibility: 'shared', slots: { notes: { shape: 'many' } } },
        }
      : id === 'cmt23456'
        ? {
            id, title: 'Comments', summary: 'S', template: 'document', markdown: '## Findings\n\nThe river runs north.\n',
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', version: 1, views: 0,
            comments: 'anyone', commentsVisible: 'owner',
            state: { writers: 'signed-in', visibility: 'private', slots: { comments: { shape: 'many', visibility: 'private', writers: 'anyone' } } },
          }
        : id === 'chk23456'
          ? {
              id, title: 'Mac prep', summary: 'Tick these off before the call.', template: 'document',
              markdown: '## Before the call\n\nWork down the list on the new Mac.\n\n```checklist\nsend: anyone\n- Update macOS {#update}\n  Apple menu > System Settings > General > Software Update. Restart and check again.\n- Sign in with your personal Apple Account\n  Not a work one. This brings over your messages, contacts and photos.\n- Install Chrome and sign in\n  Download it from [google.com/chrome](https://www.google.com/chrome/).\n- Send us your GitHub username {#gh-send}\n  <b>raw html stays text</b>\n```\n\nThat is everything.\n',
              createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', version: 1, views: 0,
              state: { writers: 'signed-in', visibility: 'private', slots: { checklist: { shape: 'one', visibility: 'private', writers: 'anyone' } } },
            }
          : null)
const store: ArtifactStore = {
  get: async (id) => { const a = await records(id); return a ? { ...a, ...settings.get(id) } : null },
  setSettings: async (id, patch) => {
    const a = await store.get(id)
    if (!a) return null
    const r = applySettingsPatch(a, patch)
    if (!r.ok) throw new Error(r.error)
    settings.set(id, { ...settings.get(id), ...r.live })
    return store.get(id)
  },
  save: async () => ({ id: 'abc23456', version: 1, created: true }),
  delete: async () => true,
  bumpViews: async () => {},
  history: async (id) => (id === 'abc23456'
    ? [{ version: 2, at: '2026-01-02T00:00:00Z', note: 'Second pass', current: true }, { version: 1, at: '2026-01-01T00:00:00Z', note: 'First draft' }]
    : null),
  version: async (id, n) => (id !== 'abc23456' ? null
    : n === 1 ? { version: 1, at: '2026-01-01T00:00:00Z', markdown: '# the first body', note: 'First draft' }
      : n === 2 ? { version: 2, at: '2026-01-02T00:00:00Z', markdown: '# hi', current: true }
        : null),
}
// Resolution digests (0.34.0), on globalThis for the same reason as the settings: one queue and one
// outbox whichever route bundle reads them. The sender records instead of emailing.
const dg = ((globalThis as { __fixtureDigests?: { store: ReturnType<typeof createMemoryResolveDigestStore>; sent: DigestMessage[] } }).__fixtureDigests ??=
  { store: createMemoryResolveDigestStore(), sent: [] })
export const sentDigests = dg.sent
export const digests = createResolveDigests({
  store: dg.store, send: async (m) => { dg.sent.push(m); return { id: `fx_${dg.sent.length}` } },
  secret: () => 'fixture-stop-secret', siteUrl: process.env.FIXTURE_SITE_URL ?? 'http://localhost', brandName: 'Fixture Co',
  ownerEmail: 'owner@example.com', titleOf: async (id) => (await store.get(id))?.title ?? null,
})
export const artifacts = createArtifactRoutes({
  store, brand: freedomDefault, siteUrl: process.env.FIXTURE_SITE_URL ?? 'http://localhost', publishKey: () => 'k',
  state: createMemoryStateStore(),
  personal: createMemoryPersonalStore(),
  // The fixture signs nobody in, so it cannot be an admin: 'everyone' lets it prove the History
  // panel and the /v/<n> page render from the tarball. Who sees them is proven in versions.test.tsx.
  history: 'everyone',
  // One signed-in admin, so the page menu's settings sheets can be proven from the tarball.
  readers,
  readerSecret: () => FIXTURE_READER_SECRET,
  ownerEmail: 'owner@example.com',
  onResolve: digests.onResolve,
})
