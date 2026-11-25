// `floatingButton={false}` (0.74.0): a voice eCard hides the floating Comment button, and its own
// "Reply with your voice" (NOTE_AT) still opens the same comment card.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { CommentLayer } from './comment-layer.js'
import { NOTE_AT } from './page-bridge.js'

let root: Root | null = null
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entries: [], notes: [] }), { status: 200 })))
})
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals() })

async function mount(floatingButton?: boolean) {
  document.body.innerHTML = '<div id="voice-ecard-root"><div data-block="b-card-0123abcd">Dear Robin, thank you.</div></div><div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => {
    root!.render(<CommentLayer artifactId="card2345" rootId="voice-ecard-root" ownerName="Sam" comments="anyone" canShare signedIn={false} isOwner={false}
      version={1} accent="#e7cb75" ground="#111" {...(floatingButton === undefined ? {} : { floatingButton })} />)
  })
  await act(async () => { await Promise.resolve() })
}

describe('the floating Comment button', () => {
  it('shows on a document page, as before', async () => {
    await mount()
    expect(document.querySelector('[data-comment-button]')).not.toBeNull()
  })
  it('is gone with floatingButton={false}, and NOTE_AT still opens the comment card', async () => {
    await mount(false)
    expect(document.querySelector('[data-comment-button]')).toBeNull()
    await act(async () => { window.dispatchEvent(new CustomEvent(NOTE_AT, { detail: { block: 'b-card-0123abcd', at: 7 } })) })
    expect(document.body.textContent).toContain('At 0:07')
    expect(document.querySelector('textarea')).not.toBeNull()
  })
})
