// One route config for route tests: an in-memory artifact store holding whatever pages a test
// seeds, the key `test-key`, and the example host. Every field may be overridden.
import type { ArtifactRoutesConfig } from './artifacts.js'
import type { ArtifactRecord, ArtifactStore } from '../artifacts/store.js'
import { freedomDefault } from '../brand/pack.js'

export function memoryArtifactStore(pages: Partial<ArtifactRecord>[] = []): ArtifactStore & { pages: Map<string, ArtifactRecord> } {
  const all = new Map<string, ArtifactRecord>()
  for (const p of pages) all.set(p.id!, { title: 'T', summary: 'S', template: 'document', markdown: '', createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', ...p } as ArtifactRecord)
  return {
    pages: all,
    get: async (id: string) => all.get(id) ?? null,
    delete: async (id: string) => all.delete(id),
    bumpViews: async () => {},
  } as unknown as ArtifactStore & { pages: Map<string, ArtifactRecord> }
}

export function testConfig(over: Partial<ArtifactRoutesConfig> = {}): ArtifactRoutesConfig {
  return { store: memoryArtifactStore([{ id: 'abcd2345' }]), brand: freedomDefault, siteUrl: 'https://artifacts.example.com', publishKey: () => 'test-key', readCookie: async () => undefined, ...over } as ArtifactRoutesConfig
}
