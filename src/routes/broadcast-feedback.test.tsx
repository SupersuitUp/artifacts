// A broadcast with comments on hands its comment layer the same three things a document does: the
// reader's feedback window, whether a first name is required, and the name a named link already
// gives. The server enforces all three on a broadcast, so a card that did not know them would offer
// Share and then be refused. The comment layer is replaced here by a probe that prints what it was
// handed, since static markup of the real one does not show these props.
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
vi.mock('../reader/comment-layer.js', () => ({
  CommentLayer: (p: { rootId: string; closesAt?: string | null; requireName?: boolean; knownName?: string | null }) => (
    <span data-probe={JSON.stringify({ rootId: p.rootId, closesAt: p.closesAt ?? null, requireName: p.requireName ?? false, knownName: p.knownName ?? null })} />
  ),
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { createMemoryStateStore } from '../artifacts/state-store.js'
import { ridSig } from '../artifacts/recipients.js'
import { mergeCommentsState } from '../artifacts/comments.js'
import type { ArtifactRecord } from '../artifacts/store.js'

const S = 's'.repeat(40)
const ID = 'bcst2345'
const CLOSES = '2031-01-01T00:00:00.000Z'

function page(over: Partial<ArtifactRecord> = {}): Partial<ArtifactRecord> {
  const merged = mergeCommentsState(undefined, 'anyone', 'owner')
  if (!merged.ok) throw new Error(merged.error)
  return { id: ID, template: 'broadcast', title: 'At the lake', summary: 'A short one', links: 'per-reader', markdown: 'We finally made it up there.', comments: 'anyone', commentsVisible: 'owner', state: merged.state, ...over }
}
async function probe(over: Partial<ArtifactRecord>, reader: { label: string; group?: boolean; owner?: boolean; closesAt?: string }) {
  const recipients = memoryRecipientsStore()
  const [who] = await recipients.add(ID, [reader])
  const r = createArtifactRoutes(testConfig({ store: memoryArtifactStore([page(over)]), state: createMemoryStateStore(), recipients, recipientSecret: () => S, owner: 'Robin' }))
  const html = renderToStaticMarkup(await r.Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({ r: `${who.rid}.${ridSig(S, ID, who.rid)}` }) }))
  expect(html).toContain('data-broadcast-card')
  const m = /data-probe="([^"]+)"/.exec(html)
  return m ? (JSON.parse(m[1].replace(/&quot;/g, '"')) as { rootId: string; closesAt: string | null; requireName: boolean; knownName: string | null }) : null
}

describe('a broadcast\'s comment layer knows the window and the name rule', () => {
  it('a group link under comment_name: required: the card asks for a first name, and knows when feedback closes', async () => {
    expect(await probe({ commentName: 'required' }, { label: 'Anyone with the link', group: true, closesAt: CLOSES }))
      .toEqual({ rootId: 'broadcast-root', closesAt: CLOSES, requireName: true, knownName: null })
  })
  it('a named link under comment_name: required: never asked, the label is the name', async () => {
    expect(await probe({ commentName: 'required' }, { label: 'Reader A', closesAt: CLOSES }))
      .toEqual({ rootId: 'broadcast-root', closesAt: CLOSES, requireName: false, knownName: 'Reader A' })
  })
  it('the owner\'s own link carries no window and no name', async () => {
    expect(await probe({ commentName: 'required' }, { label: 'Robin', owner: true }))
      .toEqual({ rootId: 'broadcast-root', closesAt: null, requireName: false, knownName: null })
  })
  it('a broadcast without the line and without a window is handed nothing new', async () => {
    expect(await probe({}, { label: 'Anyone with the link', group: true }))
      .toEqual({ rootId: 'broadcast-root', closesAt: null, requireName: false, knownName: null })
  })
})
