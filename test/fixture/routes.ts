import { createArtifactRoutes, freedomDefault, type ArtifactStore } from '@supersuit/artifacts'

const store: ArtifactStore = {
  get: async (id) => (id === 'abc23456'
    ? { id, title: 'Fixture', summary: 'S', template: 'document', markdown: '# hi', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', versions: [], views: 0 }
    : null),
  save: async () => ({ id: 'abc23456', version: 1, created: true }),
  delete: async () => true,
  bumpViews: async () => {},
}
export const artifacts = createArtifactRoutes({ store, brand: freedomDefault, siteUrl: 'http://localhost', publishKey: () => 'k' })
