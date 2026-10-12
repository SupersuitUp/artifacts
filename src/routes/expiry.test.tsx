import { describe, it, expect } from 'vitest'
import { createRecipientsRoutes } from './recipients-routes.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { COMMENTS_SLOT } from '../artifacts/comments.js'
import { memoryArtifactStore } from './test-config.js'

const NOW = new Date('2026-10-11T00:00:00.000Z')

function setup(pages = ['aaaa2222', 'bbbb3333']) {
  const recipients = memoryRecipientsStore()
  const state = createMemoryStateStore()
  const store = memoryArtifactStore(pages.map((id) => ({ id, links: 'per-reader' as const })))
  const deleted: string[] = []
  const logs: string[] = []
  const r = createRecipientsRoutes({
    store, recipients, state, recipientSecret: () => 's'.repeat(40), publishKey: () => 'k', pageUrl: (i) => i, authed: () => true,
    log: (m) => logs.push(m),
    assets: { put: async () => '', deletePage: async (id: string) => { deleted.push(id); return 3 } } as never,
  })
  return { r, recipients, state, store, deleted, logs }
}
const comment = (state: ReturnType<typeof setup>['state'], artifactId: string, key: string) =>
  state.append({ artifactId, slot: COMMENTS_SLOT, writer: { key: `r:${key}`, name: 'Ada', anonymous: true }, value: { body: 'hello' } })

describe('sweepExpired', () => {
  it('deletes an expired page, its files, readers and views, and leaves a kept page alone', async () => {
    const { r, recipients, store, deleted } = setup()
    await recipients.add('aaaa2222', [{ label: 'A' }])
    await recipients.setExpiry('aaaa2222', '2026-10-01T00:00:00.000Z')
    await recipients.add('bbbb3333', [{ label: 'B' }])
    await recipients.setExpiry('bbbb3333', null)
    expect(await r.sweepExpired(NOW)).toMatchObject({ pages: 1, files: 3, skipped: [], failed: [] })
    expect(store.pages.has('aaaa2222')).toBe(false)
    expect(store.pages.has('bbbb3333')).toBe(true)
    expect(deleted).toEqual(['aaaa2222'])
    expect(await recipients.get('aaaa2222')).toBeNull()
    expect(await recipients.get('bbbb3333')).not.toBeNull()
  })

  it('deletes the expired page reader comments and leaves every other page comments alone', async () => {
    const { r, recipients, state } = setup()
    await recipients.add('aaaa2222', [{ label: 'A' }])
    await recipients.setExpiry('aaaa2222', '2026-10-01T00:00:00.000Z')
    await recipients.add('bbbb3333', [{ label: 'B' }])
    await recipients.setExpiry('bbbb3333', '2027-01-01T00:00:00.000Z')
    await comment(state, 'aaaa2222', 'one'); await comment(state, 'aaaa2222', 'two'); await comment(state, 'bbbb3333', 'one')
    await r.sweepExpired(NOW)
    expect(await state.entries('aaaa2222')).toEqual([])
    expect(await state.entries('bbbb3333')).toHaveLength(1)
  })

  it('never deletes a page whose expireAt is in the future or is not a real time, and reports the bad one', async () => {
    const { r, recipients, store, deleted, logs } = setup(['aaaa2222', 'bbbb3333', 'cccc4444'])
    for (const [id, at] of [['aaaa2222', '2026-12-01T00:00:00.000Z'], ['bbbb3333', '1999-garbage'], ['cccc4444', '2026-13-45T99:00:00Z']] as const) {
      await recipients.add(id, [{ label: 'X' }])
      await recipients.setExpiry(id, at)
    }
    const out = await r.sweepExpired(NOW)
    expect(out).toMatchObject({ pages: 0, files: 0 })
    // cccc4444 sorts after any 2026 time, so the store never lists it; it is not deleted either way.
    expect(out.skipped).toEqual(['bbbb3333'])
    expect(deleted).toEqual([])
    expect([...store.pages.keys()].sort()).toEqual(['aaaa2222', 'bbbb3333', 'cccc4444'])
    expect(logs.join('\n')).toContain('bbbb3333')
    expect(await recipients.get('bbbb3333')).not.toBeNull()
  })

  it('a failure on one page leaves it listed for the next sweep and does not stop the others', async () => {
    const { recipients, state, store } = setup()
    const failing = createRecipientsRoutes({
      store, recipients, state, publishKey: () => 'k', pageUrl: (i) => i, authed: () => true, log: () => {},
      assets: { put: async () => '', deletePage: async (id: string) => { if (id === 'aaaa2222') throw new Error('bucket down'); return 1 } } as never,
    })
    for (const id of ['aaaa2222', 'bbbb3333']) { await recipients.add(id, [{ label: 'X' }]); await recipients.setExpiry(id, '2026-10-01T00:00:00.000Z') }
    const out = await failing.sweepExpired(NOW)
    expect(out).toMatchObject({ pages: 1, files: 1, failed: ['aaaa2222'] })
    expect(store.pages.has('aaaa2222')).toBe(true)
    expect(await recipients.expiring(NOW.toISOString())).toEqual(['aaaa2222'])
  })
})
