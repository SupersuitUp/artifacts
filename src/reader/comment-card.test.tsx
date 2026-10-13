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
// Every test starts with nothing remembered. Without this the name one test saves is still there
// for the next wherever the test runtime has a working localStorage (Node 24 in the publish
// workflow), and absent where it does not (Node 25 locally), so a test asserting "asks before
// sending" passed on one and failed on the other (the 0.40.0 tag, 2026-10-13).
beforeEach(() => {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(),
  })
})
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

  it('asks a reader who is not signed in for their name, so the owner can credit them, and saves it with the comment', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    const onSave = vi.fn(async () => null)
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} onSave={onSave} onCancel={() => {}} />)
    const label = document.querySelector('[data-comment-name]')!
    expect(label.textContent).toContain('Your name, so Robin Vale can credit your feedback')
    const name = label.querySelector('input')!
    const box = document.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, ' Ada Lovelace ')
      name.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'A thought')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    expect(onSave).toHaveBeenCalledWith('A thought', true, undefined, 'Ada Lovelace')
    // Remembered on this device, so the next comment is already signed.
    expect(store.get('artifacts:comment-name')).toBe('Ada Lovelace')
    vi.unstubAllGlobals()
  })

  it('does not ask for a name when the reader is signed in, or when the note is just for them', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn onSave={noop} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-name]')).toBeNull()
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} onSave={noop} onCancel={() => {}} />)
    await act(async () => { document.querySelector<HTMLInputElement>('[data-comment-share="mine"]')!.click() })
    expect(document.querySelector('[data-comment-name]')).toBeNull()
  })

  const type = async (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
    await act(async () => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const save = async () => { await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() }) }

  it('with requireName a comment is not sent until a first name is typed', async () => {
    const saved: unknown[][] = []
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} requireName onSave={async (...a) => { saved.push(a); return null }} onCancel={() => {}} />)
    await type(document.querySelector('textarea')!, 'Tighten the opening.')
    await save()
    expect(saved).toEqual([])
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Add your first name first.')
    expect(document.querySelector('textarea')!.value).toBe('Tighten the opening.')
    await type(document.querySelector<HTMLInputElement>('[data-comment-name] input')!, 'Kit')
    await save()
    expect(saved).toHaveLength(1)
    expect(saved[0][3]).toBe('Kit')
  })
  it('with knownName the card never asks for a name', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} knownName="Reader A" onSave={noop} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-name]')).toBeNull()
  })
  it('once feedback is closed the card says a note stays with the reader', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare={false} closed signedIn={false} onSave={noop} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-warning]')!.textContent).toBe('Only you will see this. Feedback on this draft is closed, so this is a personal note. Robin Vale won\'t see it.')
  })
  it('a refusal from the server leaves the typed words in the box', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn={false} onSave={async () => 'Add your first name, so your note has a name on it.'} onCancel={() => {}} />)
    await type(document.querySelector('textarea')!, 'Cut the second paragraph.')
    await save()
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Add your first name, so your note has a name on it.')
    expect(document.querySelector('textarea')!.value).toBe('Cut the second paragraph.')
  })
  it('requireName shows the name field even to a signed-in reader, and asks before sending', async () => {
    const saved: unknown[][] = []
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn requireName onSave={async (...a) => { saved.push(a); return null }} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-name]')).not.toBeNull()
    await type(document.querySelector('textarea')!, 'Tighten the opening.')
    await save()
    expect(saved).toEqual([])
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Add your first name first.')
  })
  it('without requireName a signed-in reader is still never asked for a name', async () => {
    await mount(<CommentCard ownerName="Robin Vale" mode="anyone" canShare signedIn onSave={noop} onCancel={() => {}} />)
    expect(document.querySelector('[data-comment-name]')).toBeNull()
  })
})
