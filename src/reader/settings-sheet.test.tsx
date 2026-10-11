// The Share settings and Comment settings sheets in the browser (0.31.0): what they show, what a
// save sends, and the menu that opens them.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageMenu, menuItems, type PageMenuProps } from './page-menu.js'
import { REOPEN_KEY, settingsChanges, type PageSettings } from './settings-sheet.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const settings: PageSettings = {
  endpoint: '/api/artifacts/abc23456/settings', access: 'invite', levels: ['public', 'freedom', 'invite'], password: false,
  link: 'https://artifacts.example.com/abc23456', list: [{ email: 'dana@example.com', name: 'Dana Ruiz' }],
  comments: 'anyone', commentsVisible: 'owner', gated: true,
  facts: [{ label: 'A stranger with the bare URL sees', text: 'The title, the summary and the share card, then a sign-in door.' }],
}
const props: PageMenuProps = {
  role: 'admin', name: 'Casey', share: { url: settings.link, title: 'The Paper' }, comments: true, signIn: null,
  signOut: '/api/reader/leave?to=%2Fabc23456', history: null, markdown: null, settings,
}

let root: Root | null = null
let host: HTMLElement | null = null
async function mount(p: PageMenuProps) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<PageMenu {...p} />))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  document.body.innerHTML = ''
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})
const q = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)
async function openSheet(kind: 'share-settings' | 'comment-settings') {
  await act(async () => q<HTMLButtonElement>('[data-page-menu-button]')!.click())
  await act(async () => q(`[data-page-menu-item="${kind}"]`)!.click())
}
const checked = (name: string) => q<HTMLInputElement>(`input[name="${name}"]:checked`)?.value
async function choose(sel: string) { await act(async () => q<HTMLInputElement>(`[data-settings-choice="${sel}"] input`)!.click()) }
const sentBody = (f: ReturnType<typeof vi.fn>) => JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)
const stubReload = () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  return reload
}

describe('menuItems with settings', () => {
  it('Share settings, and Comment settings where the host keeps comments, after Share and the comments toggle', () => {
    expect(menuItems(props)).toEqual(['share', 'comments', 'share-settings', 'comment-settings', 'sign-out'])
    expect(menuItems({ ...props, settings: { ...settings, comments: null } })).toEqual(['share', 'comments', 'share-settings', 'sign-out'])
    expect(menuItems({ ...props, settings: null })).toEqual(['share', 'comments', 'sign-out'])
  })
})

describe('settingsChanges', () => {
  it('sends only what moved', () => {
    expect(settingsChanges(settings, { access: 'invite', password: false, comments: 'anyone', commentsVisible: 'owner' })).toEqual({})
    expect(settingsChanges(settings, { access: 'public', password: true, comments: 'off', commentsVisible: 'readers' }))
      .toEqual({ access: 'public', password: 'on', comments: 'off', commentsVisible: 'readers' })
  })
})

describe('Share settings sheet', () => {
  it('shows the current settings: who can open it, the list, the link, the facts', async () => {
    await mount(props)
    await openSheet('share-settings')
    const sheet = q('[data-settings-sheet="share"]')!
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.textContent).toContain('Share settings')
    expect(checked('access')).toBe('invite')
    expect([...document.querySelectorAll('input[name="access"]')].map((i) => (i as HTMLInputElement).value)).toEqual(['public', 'freedom', 'invite'])
    expect(q('[data-settings-list-entry="dana@example.com"]')!.textContent).toContain('Dana Ruiz')
    expect(q('[data-settings-link]')!.textContent).toContain('https://artifacts.example.com/abc23456')
    expect(q('[data-settings-facts]')!.textContent).toContain('A stranger with the bare URL sees')
    // The password applies to an open page only, and no Save shows until something moves.
    expect(q('[data-settings-choice="password"]')).toBeNull()
    expect(q('[data-settings-save]')).toBeNull()
    // The menu closed behind it.
    expect(q('[data-page-menu]')).toBeNull()
  })
  it('a change shows Save; saving posts only that change as JSON, then reloads to show the page as it is now', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...settings, access: 'public', password: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const reload = stubReload()
    await mount(props)
    await openSheet('share-settings')
    await choose('access:public')
    await act(async () => q<HTMLInputElement>('[data-settings-choice="password"] input')!.click())
    await act(async () => q<HTMLButtonElement>('[data-settings-save]')!.click())
    expect(fetch).toHaveBeenCalledWith('/api/artifacts/abc23456/settings', expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' } }))
    expect(sentBody(fetch)).toEqual({ access: 'public', password: 'on' })
    expect(window.sessionStorage.getItem(REOPEN_KEY)).toBe('share')
    expect(reload).toHaveBeenCalled()
  })
  it('a refused save says why and does not reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'only the owner and this hub\'s admins change a page\'s settings' }), { status: 403 })))
    const reload = stubReload()
    await mount(props)
    await openSheet('share-settings')
    await choose('access:freedom')
    await act(async () => q<HTMLButtonElement>('[data-settings-save]')!.click())
    expect(q('[data-settings-said]')!.textContent).toMatch(/only the owner/)
    expect(reload).not.toHaveBeenCalled()
  })
  it('adding to the list posts the email and shows the list it gets back, with no reload', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...settings, list: [...settings.list!, { email: 'lee@example.com' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const reload = stubReload()
    await mount(props)
    await openSheet('share-settings')
    const input = q<HTMLInputElement>('input[type="email"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'lee@example.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => q<HTMLFormElement>('[data-settings-list] form')!.requestSubmit())
    expect(sentBody(fetch)).toEqual({ add: [{ email: 'lee@example.com' }] })
    expect(q('[data-settings-list-entry="lee@example.com"]')).not.toBeNull()
    expect(q('[data-settings-said]')!.textContent).toBe('Added')
    expect(reload).not.toHaveBeenCalled()
  })
  it('removing from the list posts the email', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...settings, list: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await mount(props)
    await openSheet('share-settings')
    await act(async () => q<HTMLButtonElement>('button[aria-label="Remove dana@example.com"]')!.click())
    expect(sentBody(fetch)).toEqual({ remove: ['dana@example.com'] })
    expect(q('[data-settings-list-entry="dana@example.com"]')).toBeNull()
  })
  it('Escape and the close button close it', async () => {
    await mount(props)
    await openSheet('share-settings')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(q('[data-settings-sheet]')).toBeNull()
    await openSheet('share-settings')
    await act(async () => q<HTMLButtonElement>('[data-settings-sheet] button[aria-label="Close"]')!.click())
    expect(q('[data-settings-sheet]')).toBeNull()
  })
  it('after the reload a save caused, the sheet opens again saying Saved', async () => {
    window.sessionStorage.setItem(REOPEN_KEY, 'share')
    await mount(props)
    expect(q('[data-settings-sheet="share"]')).not.toBeNull()
    expect(q('[data-settings-said]')!.textContent).toBe('Saved')
    expect(window.sessionStorage.getItem(REOPEN_KEY)).toBeNull()
  })
  it('a page without settings never opens one, whatever storage says', async () => {
    window.sessionStorage.setItem(REOPEN_KEY, 'share')
    await mount({ ...props, settings: null })
    expect(q('[data-settings-sheet]')).toBeNull()
  })
})

describe('Comment settings sheet', () => {
  it('shows who can comment and who reads them, with the private-page line', async () => {
    await mount(props)
    await openSheet('comment-settings')
    expect(q('[data-settings-sheet="comments"]')!.textContent).toContain('Comment settings')
    expect(checked('comments')).toBe('anyone')
    expect(checked('visible')).toBe('owner')
    expect(q('[data-settings-choice="comments:anyone"]')!.textContent).toMatch(/private, so only signed-in readers/)
  })
  it('Nobody hides the visibility choice; saving sends it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...settings, comments: 'off' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    stubReload()
    await mount(props)
    await openSheet('comment-settings')
    await choose('comments:off')
    expect(q('input[name="visible"]')).toBeNull()
    await act(async () => q<HTMLButtonElement>('[data-settings-save]')!.click())
    expect(sentBody(fetch)).toEqual({ comments: 'off' })
    expect(window.sessionStorage.getItem(REOPEN_KEY)).toBe('comments')
  })
})
