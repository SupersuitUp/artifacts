import { createArtifactRoutes, createMemoryStateStore, freedomDefault, type ArtifactRecord, type ArtifactStore } from '@supersuit/artifacts'

const store: ArtifactStore = {
  get: async (id): Promise<ArtifactRecord | null> => (id === 'abc23456'
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
      : null),
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
export const artifacts = createArtifactRoutes({
  store, brand: freedomDefault, siteUrl: 'http://localhost', publishKey: () => 'k',
  state: createMemoryStateStore(),
})
