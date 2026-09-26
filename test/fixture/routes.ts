import { createArtifactRoutes, createMemoryStateStore, freedomDefault, type ArtifactRecord, type ArtifactStore } from '@supersuit/artifacts'

const store: ArtifactStore = {
  get: async (id): Promise<ArtifactRecord | null> => (id === 'abc23456'
    ? {
        id, title: 'Fixture', summary: 'S', template: 'document', markdown: '# hi',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', versions: [], views: 0,
        state: { writers: 'anyone', visibility: 'tally', slots: { vote: { shape: 'one' } } },
      }
    : id === 'nts23456'
      ? {
          id, title: 'Notes', summary: 'S', template: 'document', markdown: '## Sales\n\nWords.\n\n```notes\n```\n',
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', versions: [], views: 0,
          state: { writers: 'anyone', visibility: 'shared', slots: { notes: { shape: 'many' } } },
        }
      : null),
  save: async () => ({ id: 'abc23456', version: 1, created: true }),
  delete: async () => true,
  bumpViews: async () => {},
}
export const artifacts = createArtifactRoutes({
  store, brand: freedomDefault, siteUrl: 'http://localhost', publishKey: () => 'k',
  state: createMemoryStateStore(),
})
