import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from '../artifacts/render.js'

// The checklist in a page and in a browser: the fence draws a known component with the ids and
// count the author wrote, its text stays escaped, ticks survive a reload by page and item id,
// blocked storage costs only the memory, and Send hands the owner the ticked ids.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MD = [
  '## Before the call', '',
  '```checklist',
  '- Update macOS {#update}',
  '  Apple menu > System Settings > General > [Software Update](https://support.apple.com/en-us/108382).',
  '- Install Chrome',
  '- Send us your GitHub username {#gh-send}',
  '```',
  '',
  'After the list.',
].join('\n')

const KEY = (id: string) => `artifact-checklist:abc23456:${id}`

describe('the checklist fence on the page', () => {
  const html = (md: string, props: Record<string, unknown> = {}) => renderToStaticMarkup(<ArtifactMarkdown markdown={md} {...props} />)

  it('draws the known component with every item, its id and the count, and no code block', () => {
    const out = html(MD, { checklist: { artifactId: 'abc23456' } })
    const ids = [...out.matchAll(/data-checklist-item="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['update', 'install-chrome', 'gh-send'])
    expect((out.match(/type="checkbox"/g) ?? []).length).toBe(3)
    expect(out).toContain('data-artifact-checklist')
    expect(out).toContain('>0 of 3 done</p>')
    expect(out).not.toContain('language-checklist')
    expect(out).not.toContain('<pre')
    expect(out).not.toContain('{#update}')
    // The description is markdown: its link is the page's own safe link.
    expect(out).toContain('href="https://support.apple.com/en-us/108382"')
    expect(out).toContain('rel="noopener noreferrer"')
    // Not read aloud: the narrator reads the prose, never the list.
    expect(out).toMatch(/<div data-nospeak="true" data-artifact-checklist/)
  })

  it('keeps raw HTML inside the fence escaped, in an item and in a description', () => {
    const out = html('```checklist\n- <b>bold</b> <script>alert(1)</script> {#x}\n  <img src=x onerror=alert(1)> <a href="javascript:alert(1)">go</a>\n```', { checklist: { artifactId: 'abc23456' } })
    expect(out).toContain('data-checklist-item="x"')
    for (const raw of ['<b>', '<script', '<img', '<a href="javascript']) expect(out).not.toContain(raw)
    expect(out).not.toMatch(/<[^>]*\sonerror=/)
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // And a markdown link to a script URL is not a link either.
    expect(html('```checklist\n- [go](javascript:alert(1))\n```')).not.toContain('href="javascript')
  })

  it('an sms: or tel: link opens the reader\'s Messages or Phone, in a checklist and in prose; javascript: stays dead', () => {
    const out = html('```checklist\n- Send us your username\n  [Text Sam](sms:+15555550100&body=My%20GitHub%20username%20is%20)\n```\n\n[Call](tel:+15555550100)')
    expect(out).toContain('href="sms:+15555550100&amp;body=My%20GitHub%20username%20is%20"')
    expect(out).toContain('href="tel:+15555550100"')
    expect(out).not.toMatch(/href="(sms|tel):[^"]*"[^>]*target=/)
    expect(html('[x](javascript:alert(1)) [y](data:text/html,hi)')).not.toMatch(/href="(javascript|data):/)
  })

  it('leaves a page with no checklist byte for byte as it was', () => {
    const md = '# Title\n\nWords with **bold**.\n\n```bash\nls -la\n```\n\n- a\n- b\n'
    expect(html(md, { checklist: { artifactId: 'abc23456', send: true, owner: 'Sam' } })).toBe(html(md))
    // A checkbox list in plain markdown stays GFM's own list, not the widget.
    expect(html('- [ ] one\n- [x] two')).not.toContain('data-artifact-checklist')
  })

  it('offers Send only when the page takes it and the host keeps answers', () => {
    const md = '```checklist\nsend: anyone\n- A\n```'
    expect(html(md, { checklist: { artifactId: 'abc23456', send: true, owner: 'Sam' } })).toContain('Send my progress to Sam')
    expect(html(md, { checklist: { artifactId: 'abc23456', send: false } })).not.toContain('data-checklist-send')
    expect(html(MD, { checklist: { artifactId: 'abc23456', send: true } })).not.toContain('data-checklist-send')
  })
})

describe('the checklist in a browser', () => {
  let root: Root
  let el: HTMLDivElement
  const mount = async (md = MD, checklist: Record<string, unknown> = { artifactId: 'abc23456' }) => {
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    await act(async () => { root.render(<ArtifactMarkdown markdown={md} checklist={checklist as never} />) })
    await act(async () => {})
  }
  const box = (id: string) => el.querySelector<HTMLInputElement>(`[data-checklist-item="${id}"] input[type="checkbox"]`)!
  const count = () => el.querySelector('[data-checklist-count]')!.textContent

  // Node 25 ships its own inert global localStorage, which shadows jsdom's (device-notes.test.ts):
  // each test gets a plain one, as a browser has.
  let localStorage: Storage
  const memoryStorage = (): Storage => {
    const m = new Map<string, string>()
    return {
      get length() { return m.size },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, String(v)) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
    }
  }
  beforeEach(() => { document.body.innerHTML = ''; localStorage = memoryStorage(); vi.stubGlobal('localStorage', localStorage) })
  afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('a tick is saved under the page and item id, shows in the count, and is there after a reload', async () => {
    await mount()
    expect(count()).toBe('0 of 3 done')
    await act(async () => { box('install-chrome').click() })
    expect(box('install-chrome').checked).toBe(true)
    expect(count()).toBe('1 of 3 done')
    expect(localStorage.getItem(KEY('install-chrome'))).toBe('1')
    act(() => root.unmount())
    await mount()
    expect(box('install-chrome').checked).toBe(true)
    expect(box('update').checked).toBe(false)
    expect(count()).toBe('1 of 3 done')
    await act(async () => { box('install-chrome').click() })
    expect(localStorage.getItem(KEY('install-chrome'))).toBeNull()
    expect(count()).toBe('0 of 3 done')
  })

  it('the row is the tap target: the label holds the box and the text, at least 44px tall', async () => {
    await mount()
    const label = el.querySelector('[data-checklist-item="update"] label')!
    expect((label as HTMLElement).style.minHeight).toBe('44px')
    expect(box('update').style.width).toBe('24px')
    expect(label.getAttribute('for')).toBe(box('update').id)
    await act(async () => { (label as HTMLLabelElement).click() })
    expect(box('update').checked).toBe(true)
  })

  it('still ticks, for the visit, when the browser blocks storage', async () => {
    const blocked = () => { throw new Error('SecurityError') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    await mount()
    await act(async () => { box('update').click() })
    expect(box('update').checked).toBe(true)
    expect(count()).toBe('1 of 3 done')
  })

  it('a page with no id (a past version) ticks for the visit and writes nothing', async () => {
    await mount(MD, {})
    await act(async () => { box('update').click() })
    expect(count()).toBe('1 of 3 done')
    expect(localStorage.length).toBe(0)
  })

  it('Send hands the owner the ticked ids through the state API, and says sign in when it must', async () => {
    const md = '```checklist\nsend: signed-in\n- A {#a}\n- B {#b}\n```'
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    vi.stubGlobal('fetch', fetchMock)
    await mount(md, { artifactId: 'abc23456', send: true, owner: 'Sam' })
    await act(async () => { box('b').click() })
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-checklist-send]')!.click() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/artifacts/abc23456/state')
    expect(JSON.parse(init.body as string)).toEqual({ slot: 'checklist', op: 'set', value: { done: ['b'] } })
    expect(el.querySelector('[data-checklist-sent]')!.textContent).toBe('Sent: 1 of 2 done.')

    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: 'sign in to answer', signIn: 'https://accounts.example.com/in' }), { status: 401 })))
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-checklist-send]')!.click() })
    expect(el.querySelector('a[href="https://accounts.example.com/in"]')!.textContent).toBe('Sign in to send')
  })
})
