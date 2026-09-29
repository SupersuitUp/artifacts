import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CommentCard, warningLine } from './comment-card.js'

let root: Root | null = null
async function mount(el: React.ReactNode) {
  document.body.innerHTML = '<div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(el) })
}
afterEach(async () => { await act(async () => root?.unmount()); root = null })
const noop = async () => null

describe('CommentCard', () => {
  it('without comment access, the warning is the first thing in the card, before anything is typed', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="off" canShare={false} signedIn={false} onSave={noop} onCancel={() => {}} />)
    const warning = document.querySelector('[data-comment-warning]')!
    expect(warning.textContent).toBe('Only you will see this. Robin Vale has not opened this page to comments, so this is a personal note. They won\'t see it.')
    // Above the box, and no share switch at all.
    expect(warning.compareDocumentPosition(document.querySelector('textarea')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('[data-comment-share]')).toBeNull()
    // Not signed in: the note stays on this device, and the card says so.
    expect(document.body.textContent).toContain('Saved on this device. Sign in to keep it everywhere.')
  })

  it('a page taking comments only from signed-in readers says that instead, and still warns', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="signed-in" canShare={false} signedIn={false} onSave={noop} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-warning]')!.textContent).toBe(warningLine('Robin Vale', 'signed-in'))
    expect(warningLine('Robin Vale', 'signed-in')).toMatch(/^Only you will see this\. .* They won't see it\.$/)
  })

  it('with comment access there is no warning, and the switch defaults to Share with the owner', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} onSave={noop} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-warning]')).toBeNull()
    const share = document.querySelector<HTMLInputElement>('[data-comment-share="share"]')!
    const mine = document.querySelector<HTMLInputElement>('[data-comment-share="mine"]')!
    expect(share.checked).toBe(true)
    expect(mine.checked).toBe(false)
    expect(share.closest('label')!.textContent).toBe('Share with Robin Vale')
    expect(mine.closest('label')!.textContent).toBe('Just for me')
    // Shared: no device line. Switched to Just for me while signed out: the device line appears.
    expect(document.body.textContent).not.toContain('Saved on this device')
    await act(async () => { mine.click() })
    expect(document.body.textContent).toContain('Saved on this device. Sign in to keep it everywhere.')
  })

  it('saves the typed text with the choice, and shows a refusal from the server', async () => {
    const onSave = vi.fn(async () => 'that did not save; try again')
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn onSave={onSave} onCancel={() => {}} />)
    const box = document.querySelector('textarea')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(box, 'A thought')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    expect(onSave).toHaveBeenCalledWith('A thought', true)
    expect(document.body.textContent).toContain('that did not save; try again')
  })
})
