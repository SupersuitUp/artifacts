// The hub's own home for its owner (artifact hub admin center, task 3): HubHome draws the Artifacts tile over the whole
// hub for the owner or an admin signed in, every page listed, and answers null to everyone else so the host keeps its
// plain front page. Memory stores only.
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { memoryArtifactStore, testConfig } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'

const RS = 'rs'
const NOW = Date.now()
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const owner: Reader = { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }
const admin: Reader = { uid: 'u2', email: 'casey@example.com', name: 'Casey', member: true }
const dana: Reader = { uid: 'u3', email: 'dana@example.com', name: 'Dana', member: true }

async function hub(who: Reader | null) {
  const store = memoryArtifactStore([
    { id: 'plan2345', title: 'The plan', links: 'per-reader', createdAt: ago(6), updatedAt: ago(6) },
    { id: 'note2345', title: 'A plain note', createdAt: ago(2), updatedAt: ago(2) },
    { id: 'cast2345', title: 'The broadcast', template: 'broadcast', createdAt: ago(1), updatedAt: ago(1) },
  ])
  const recipients = memoryRecipientsStore()
  const [kim, lee] = await recipients.add('plan2345', [{ label: 'Kim' }, { label: 'Lee' }])
  await recipients.setSent!('plan2345', [kim.rid, lee.rid], ago(5))
  await recipients.recordView({ artifactId: 'plan2345', rid: kim.rid, session: 's1', device: 'd1', at: ago(4), addSeconds: 40 })
  return createArtifactRoutes(testConfig({
    store, recipients, recipientSecret: () => 's'.repeat(40), state: createMemoryStateStore(),
    readerSecret: () => RS, ownerEmail: 'robin@example.com', admins: ['casey@example.com'],
    readCookie: async (n: string) => (who && n === GRANT_COOKIE ? mintGrant(RS, who) : undefined),
  }))
}
const html = async (who: Reader | null, searchParams: Record<string, string> = {}) => {
  const out = await (await hub(who)).HubHome({ searchParams: Promise.resolve(searchParams) })
  return out === null ? null : new DOMParser().parseFromString(renderToStaticMarkup(out), 'text/html')
}

describe('HubHome', () => {
  it('is null for a visitor and for a signed-in reader who is neither owner nor admin', async () => {
    expect(await html(null)).toBeNull()
    expect(await html(dana)).toBeNull()
  })
  it('draws the Artifacts tile over the whole hub for the owner, every page listed', async () => {
    const d = (await html(owner))!
    expect(d.querySelector('[data-view="counts"]')).not.toBeNull()
    expect([...d.querySelectorAll('[data-view="feed"] [data-event]')].map((e) => e.getAttribute('data-event'))).toContain('opened')
    expect([...d.querySelectorAll('[data-hub-page]')].map((e) => e.getAttribute('data-hub-page')).sort()).toEqual(['cast2345', 'note2345', 'plan2345'])
    // A page with readers links to its readers on this same home; every page opens at its own address.
    expect(d.querySelector('[data-hub-page="plan2345"] a[href="/?p=plan2345"]')).not.toBeNull()
    expect(d.querySelector('[data-hub-page="note2345"] a[href="https://artifacts.example.com/note2345"]')).not.toBeNull()
    expect(d.querySelector('[data-hub-page="plan2345"]')!.textContent).toContain('2 reader links')
  })
  it('an admin gets it too, and ?p= opens one page\'s readers on the home', async () => {
    const d = (await html(admin, { p: 'plan2345' }))!
    expect([...d.querySelectorAll('[data-reader]')].map((e) => e.getAttribute('data-reader'))).toEqual(['Kim', 'Lee'])
    expect(d.querySelector('[data-back]')!.getAttribute('href')).toBe('/')
  })
})
