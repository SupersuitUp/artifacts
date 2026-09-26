import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ArtifactMarkdown } from '../artifacts/render.js'

// The widget in a browser: it reads the page's notes once, draws each under its heading, sets
// aside notes whose heading is gone, and posts a new note as { slug, heading, note }.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MD = '## Sales\n\nWords.\n\n## Ops\n\nMore.\n\n```notes\n```\n'
const note = (id: string, slug: string, heading: string, text: string, name = 'Sam', mine = false) =>
  ({ id, name, value: { slug, heading, note: text }, at: '2026-09-25T00:00:00Z', mine })

function view(shared: unknown[], extra: Record<string, unknown> = {}) {
  return { reader: { firstName: 'Jordan' }, canWrite: true, slots: { notes: { shape: 'many', visibility: 'shared', mine: [], shared } }, ...extra }
}

let root: Root
let el: HTMLDivElement
let fetchMock: ReturnType<typeof vi.fn>
const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

async function mount(first: unknown, status = 200) {
  fetchMock = vi.fn(() => ok(first, status))
  vi.stubGlobal('fetch', fetchMock)
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => { root.render(<ArtifactMarkdown markdown={MD} notes={{ artifactId: 'abc23456', accent: '#c9a96e' }} />) })
  await act(async () => {})
}

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals() })

describe('notes widget in the browser', () => {
  it('reads the page\'s state once and shows shared notes under their heading, with first names', async () => {
    await mount(view([note('n1', 'sales', 'Sales', 'Pipeline review goes here'), note('n2', 'ops', 'Ops', 'Weekly close', 'Riley')]))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/artifacts/abc23456/state')
    const sales = el.querySelector('[data-heading-notes="sales"]')!
    const ops = el.querySelector('[data-heading-notes="ops"]')!
    expect(sales.textContent).toContain('Pipeline review goes here')
    expect(sales.textContent).toContain('Sam')
    expect(sales.textContent).not.toContain('Weekly close')
    expect(ops.textContent).toContain('Weekly close')
    expect(ops.textContent).toContain('Riley')
    expect(sales.closest('[data-nospeak]')).not.toBeNull()
    expect(el.querySelector('[data-note-toggle="sales"]')!.textContent).toContain('1')
  })

  it('shows a note whose heading was renamed under "notes on earlier versions", with the heading it was left under', async () => {
    await mount(view([note('n3', 'marketing', 'Marketing', 'Old section thought')]))
    const earlier = el.querySelector('[data-artifact-notes]')!
    expect(earlier.textContent).toMatch(/notes on earlier versions/i)
    expect(earlier.textContent).toContain('Old section thought')
    expect(earlier.textContent).toContain('Marketing')
    expect(el.querySelector('[data-heading-notes="sales"]')?.textContent ?? '').not.toContain('Old section thought')
  })

  it('posting appends { slug, heading, note } to the notes slot and shows the result', async () => {
    await mount(view([]))
    await act(async () => { (el.querySelector('[data-note-toggle="ops"]') as HTMLButtonElement).click() })
    const box = el.querySelector('[data-heading-notes="ops"] textarea') as HTMLTextAreaElement
    expect(box).not.toBeNull()
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => { setValue.call(box, '  Add the close checklist  '); box.dispatchEvent(new Event('input', { bubbles: true })) })
    fetchMock.mockImplementationOnce(() => ok(view([note('n9', 'ops', 'Ops', 'Add the close checklist', 'Jordan', true)])))
    await act(async () => { (el.querySelector('[data-heading-notes="ops"] form') as HTMLFormElement).requestSubmit() })
    await act(async () => {})
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/artifacts/abc23456/state')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ slot: 'notes', op: 'append', value: { slug: 'ops', heading: 'Ops', note: 'Add the close checklist' } })
    expect(el.querySelector('[data-heading-notes="ops"]')!.textContent).toContain('Add the close checklist')
    expect(el.querySelector('[data-heading-notes="ops"] textarea')).toBeNull()
  })

  it('a reader who may not write is offered sign-in, not a box', async () => {
    await mount({ error: 'sign in to answer', signIn: 'https://accounts.example.com/artifact/sign-in?to=x' }, 401)
    await act(async () => { (el.querySelector('[data-note-toggle="sales"]') as HTMLButtonElement).click() })
    const panel = el.querySelector('[data-heading-notes="sales"]')!
    expect(panel.querySelector('textarea')).toBeNull()
    expect(panel.querySelector('a')!.getAttribute('href')).toBe('https://accounts.example.com/artifact/sign-in?to=x')
  })

  it('a host that keeps no answers hides the controls', async () => {
    await mount({ error: 'this host keeps no answers' }, 501)
    expect(el.querySelector('[data-note-toggle]')).toBeNull()
  })

  it('a reader can remove their own note', async () => {
    await mount(view([note('n5', 'sales', 'Sales', 'mine', 'You', true)]))
    fetchMock.mockImplementationOnce(() => ok(view([])))
    await act(async () => { (el.querySelector('[data-heading-notes="sales"] [data-note-remove]') as HTMLButtonElement).click() })
    await act(async () => {})
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({ slot: 'notes', op: 'remove', entry: 'n5' })
    expect(el.querySelector('[data-heading-notes="sales"]')?.textContent ?? '').not.toContain('mine')
  })
})
