import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageMenu, roleLine, menuItems, type PageMenuProps } from './page-menu.js'
import { PINS_SET, announcePins } from './page-bridge.js'
import { CommentLayer } from './comment-layer.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const visitor: PageMenuProps = {
  role: 'visitor', name: null, share: { url: 'https://artifacts.example.com/abc23456', title: 'The Paper' }, comments: false,
  signIn: 'https://accounts.example.com/artifact/sign-in?to=https%3A%2F%2Fartifacts.example.com%2Fabc23456', signOut: null, history: null, markdown: null,
}
const adminProps: PageMenuProps = {
  ...visitor, role: 'admin', name: 'Casey', comments: true, signIn: null, signOut: '/api/reader/leave?to=%2Fabc23456',
  history: { items: [{ version: 2, at: '2026-09-13T15:04:00Z', current: true }, { version: 1, at: '2026-09-11T00:00:00Z', note: 'First draft' }], base: '/abc23456', viewing: 2 },
  markdown: '---\nid: abc23456\n---\n\nBody',
}

let root: Root | null = null
let host: HTMLElement | null = null
async function mount(props: PageMenuProps) {
  host = document.createElement('div')
  host.setAttribute('data-artifact-theme', 'dark')
  host.style.setProperty('--a-ground', '#101010')
  host.style.setProperty('--a-ink', '#f5f5f5')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<PageMenu {...props} />))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})
const button = () => document.querySelector<HTMLButtonElement>('[data-page-menu-button]')!
const menu = () => document.querySelector<HTMLElement>('[data-page-menu]')
const item = (k: string) => document.querySelector<HTMLElement>(`[data-page-menu-item="${k}"]`)
const shown = () => [...document.querySelectorAll<HTMLElement>('[data-page-menu-item]')].map((e) => e.dataset.pageMenuItem)
async function openMenu() { await act(async () => button().click()) }

describe('roleLine', () => {
  it('says who the reader is to this page', () => {
    expect(roleLine('visitor', null)).toBe('Not signed in')
    expect(roleLine('reader', 'Dana')).toBe('Signed in as Dana')
    expect(roleLine('reader', 'Dana', true)).toBe("Signed in as Dana · not on this page's list")
    expect(roleLine('owner', 'Robin')).toBe('Signed in as Robin · owner of this page')
    expect(roleLine('admin', 'Casey')).toBe('Signed in as Casey · admin of this hub')
  })
})

describe('menuItems', () => {
  it('lists only what was passed, in a fixed order, Sign out winning over Sign in', () => {
    expect(menuItems(visitor)).toEqual(['share', 'sign-in'])
    expect(menuItems(adminProps)).toEqual(['share', 'comments', 'history', 'markdown', 'sign-out'])
    expect(menuItems({ ...visitor, share: null, signIn: null })).toEqual([])
  })
})

describe('PageMenu', () => {
  it('is one small labelled button, on document.body, outside the page', async () => {
    await mount(visitor)
    const b = button()
    expect(b.getAttribute('aria-label')).toBe('Page menu')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(host!.contains(b)).toBe(false)
    expect(b.style.position).toBe('fixed')
    expect(b.style.width).toBe('36px')
    expect(b.style.borderRadius).toBe('999px')
    // Themed with the page's own variables, carried onto the portal.
    expect((b.closest('[data-page-menu-ui]') as HTMLElement).style.getPropertyValue('--a-ground')).toBe('#101010')
  })
  it('opens with the role line first, and only the items this reader can use', async () => {
    await mount(visitor)
    expect(menu()).toBeNull()
    await openMenu()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(menu()!.querySelector('[data-page-menu-role]')!.textContent).toBe('Not signed in')
    expect(shown()).toEqual(['share', 'sign-in'])
  })
  it('an admin gets every release-1 item, and the admin role line', async () => {
    await mount(adminProps)
    await openMenu()
    expect(menu()!.querySelector('[data-page-menu-role]')!.textContent).toBe('Signed in as Casey · admin of this hub')
    expect(shown()).toEqual(['share', 'comments', 'history', 'markdown', 'sign-out'])
    expect(item('sign-out')!.getAttribute('href')).toBe('/api/reader/leave?to=%2Fabc23456')
  })
  it('Share on a desk copies the link and says so', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await mount(visitor)
    await openMenu()
    await act(async () => item('share')!.click())
    expect(writeText).toHaveBeenCalledWith('https://artifacts.example.com/abc23456')
    expect(item('share')!.textContent).toBe('Link copied')
    expect(menu()!.querySelector('[role="status"]')!.textContent).toBe('Link copied')
  })
  it('a clipboard that never answers falls back and still says something', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => new Promise(() => {}) } })
    const exec = vi.fn(() => true)
    ;(document as unknown as { execCommand: unknown }).execCommand = exec
    await mount(visitor)
    await openMenu()
    await act(async () => { item('share')!.click(); await vi.advanceTimersByTimeAsync(1300) })
    expect(exec).toHaveBeenCalledWith('copy')
    expect(item('share')!.textContent).toBe('Link copied')
    vi.useRealTimers()
  })
  it('Share on a phone hands the link to the share sheet, and copies nothing', async () => {
    const share = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } })
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('pointer: coarse') || q.includes('max-width'), addEventListener() {}, removeEventListener() {} }))
    await mount(visitor)
    await openMenu()
    await act(async () => item('share')!.click())
    expect(share).toHaveBeenCalledWith({ title: 'The Paper', url: 'https://artifacts.example.com/abc23456' })
    expect(writeText).not.toHaveBeenCalled()
    expect(menu()).toBeNull()
  })
  it('a share sheet that refuses (not the reader cancelling) falls back to copying; a cancel does nothing', async () => {
    const writeText = vi.fn(async () => {})
    const refuse = vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }) })
    vi.stubGlobal('navigator', { ...navigator, share: refuse, clipboard: { writeText } })
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    await mount(visitor)
    await openMenu()
    await act(async () => item('share')!.click())
    expect(writeText).toHaveBeenCalledWith('https://artifacts.example.com/abc23456')
    expect(item('share')!.textContent).toBe('Link copied')
    writeText.mockClear()
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }), clipboard: { writeText } })
    await act(async () => item('share')!.click())
    expect(writeText).not.toHaveBeenCalled()
  })
  it('a phone with no share sheet falls back to copying', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } })
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    await mount(visitor)
    await openMenu()
    expect(menu()!.style.bottom).toContain('8px') // a sheet from the bottom on a phone
    await act(async () => item('share')!.click())
    expect(writeText).toHaveBeenCalledWith('https://artifacts.example.com/abc23456')
  })
  it('an invite page carries the line under Share', async () => {
    await mount({ ...visitor, share: { ...visitor.share!, note: 'Only people on the list can open it.' } })
    await openMenu()
    expect(item('share')!.querySelector('[data-page-menu-note]')!.textContent).toBe('Only people on the list can open it.')
  })
  it('Copy the markdown copies the source and says so', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await mount(adminProps)
    await openMenu()
    await act(async () => item('markdown')!.click())
    expect(writeText).toHaveBeenCalledWith('---\nid: abc23456\n---\n\nBody')
    expect(item('markdown')!.textContent).toBe('Markdown copied')
  })
  it('Sign in returns to the exact address, hash included', async () => {
    window.history.replaceState(null, '', '/abc23456#findings')
    await mount(visitor)
    await openMenu()
    const a = item('sign-in') as HTMLAnchorElement
    a.addEventListener('click', (e) => e.preventDefault())
    await act(async () => a.click())
    expect(new URL(a.href).searchParams.get('to')).toBe(`${window.location.origin}/abc23456#findings`)
  })
  it('Version history opens the history panel from the menu', async () => {
    await mount(adminProps)
    await openMenu()
    await act(async () => item('history')!.click())
    expect(menu()).toBeNull()
    const panel = document.querySelector<HTMLElement>('[data-version-panel]')!
    expect(panel.querySelector('[aria-current="page"]')!.getAttribute('href')).toBe('/abc23456')
    expect(panel.textContent).toContain('First draft')
  })
  it('Escape and a tap outside close it', async () => {
    await mount(visitor)
    await openMenu()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(menu()).toBeNull()
    await openMenu()
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(menu()).toBeNull()
  })
  it('Hide / Show comments drives the comment layer, and follows it when the layer moves first', async () => {
    const asked: boolean[] = []
    window.addEventListener(PINS_SET, (e) => asked.push((e as CustomEvent<boolean>).detail))
    await mount(adminProps)
    await openMenu()
    expect(item('comments')!.textContent).toBe('Hide comments')
    await act(async () => item('comments')!.click())
    expect(asked).toEqual([false])
    await openMenu()
    expect(item('comments')!.textContent).toBe('Show comments')
    // The layer's own toggle moved: the menu hears it.
    await act(async () => announcePins(true))
    expect(item('comments')!.textContent).toBe('Hide comments')
  })
})

describe('the menu and the comment layer stay in sync', () => {
  it("the menu's Hide comments hides the layer's pins, and the layer's toggle relabels the menu", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'sign in', device: true }), { status: 401 })))
    document.body.innerHTML = '<div id="root"><p data-block="b-p-1">The river runs north.</p></div><div id="layer"></div>'
    const layerRoot = createRoot(document.getElementById('layer')!)
    await act(async () => layerRoot.render(
      <CommentLayer artifactId="abc23456" rootId="root" ownerName="Robin" comments="anyone" canShare signedIn={false} isOwner={false} version={2} accent="#f80" ground="#000" />,
    ))
    await mount(adminProps)
    await openMenu()
    await act(async () => item('comments')!.click())
    // The layer's panel toggle now reads Show, because the menu hid the pins.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-comment-button]')!.click())
    const toggle = document.querySelector<HTMLButtonElement>('[data-comment-pins-toggle]')!
    expect(toggle.textContent).toBe('Show comments')
    await act(async () => toggle.click())
    await openMenu()
    expect(item('comments')!.textContent).toBe('Hide comments')
    await act(async () => layerRoot.unmount())
  })
})
