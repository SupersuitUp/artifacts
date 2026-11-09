// Who gets "Owner view" in a page's menu (artifact hub admin center, task 4): the owner and the hub's admins signed in,
// never a reader who came in on their own link, never a signed-in stranger, never a visitor.
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
import { ridSig } from '../artifacts/recipients.js'
import { GRANT_COOKIE, mintGrant, type Reader } from '../artifacts/reader.js'

const S = 's'.repeat(40)
const RS = 'rs'
const ID = 'abcd2345'
const owner: Reader = { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }
const admin: Reader = { uid: 'u2', email: 'casey@example.com', name: 'Casey', member: true }
const dana: Reader = { uid: 'u3', email: 'dana@example.com', name: 'Dana', member: true }

async function render(who: Reader | null, links: 'per-reader' | undefined, r?: 'reader' | 'owner-row') {
  const recipients = memoryRecipientsStore()
  const [ada, mine] = await recipients.add(ID, [{ label: 'Reader A' }, { label: 'Me', owner: true }])
  const link = (rid: string) => `${rid}.${ridSig(S, ID, rid)}`
  const routes = createArtifactRoutes(testConfig({
    store: memoryArtifactStore([{ id: ID, title: 'At the river', markdown: 'x', ...(links ? { links } : {}) }]),
    recipients, recipientSecret: () => S, readerSecret: () => RS, ownerEmail: 'robin@example.com', admins: ['casey@example.com'],
    readCookie: async (n: string) => (who && n === GRANT_COOKIE ? mintGrant(RS, who) : undefined),
  }))
  const sp = r ? { r: link(r === 'reader' ? ada.rid : mine.rid) } : {}
  return renderToStaticMarkup(await routes.Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(sp) }))
}
const items = (html: string) => /data-page-menu-items="([^"]*)"/.exec(html)?.[1].split(' ').filter(Boolean) ?? []

describe('Owner view', () => {
  it('is in the menu for the owner and an admin signed in', async () => {
    expect(items(await render(owner, 'per-reader'))).toContain('owner-view')
    expect(items(await render(admin, undefined))).toContain('owner-view')
  })
  it('never for a reader who came in on their own link, nor the owner\'s own link row unsigned, nor anyone else', async () => {
    expect(items(await render(null, 'per-reader', 'reader'))).not.toContain('owner-view')
    expect(items(await render(null, 'per-reader', 'owner-row'))).not.toContain('owner-view')
    expect(items(await render(dana, 'per-reader', 'reader'))).not.toContain('owner-view')
    expect(items(await render(dana, undefined))).not.toContain('owner-view')
    expect(items(await render(null, undefined))).not.toContain('owner-view')
  })
})
