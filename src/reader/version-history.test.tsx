import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { VersionHistory, type HistoryItem } from './version-history.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const items: HistoryItem[] = [
  { version: 3, at: '2026-09-27T15:04:00Z', note: 'Added the short version', current: true },
  { version: 2, at: '2026-09-26T09:30:00Z' },
  { version: 1, at: '2026-09-25T12:00:00Z', note: 'First draft' },
]

function mount(viewing = 3) {
  const line = document.createElement('p')
  document.body.appendChild(line)
  const root = createRoot(line)
  act(() => root.render(<VersionHistory items={items} base="/abc23456" viewing={viewing} />))
  const button = line.querySelector<HTMLButtonElement>('[data-version-history]')!
  return { line, button, cleanup: () => { act(() => root.unmount()); line.remove() } }
}
const panel = () => document.querySelector<HTMLElement>('[data-version-panel]')

let cleanup = () => {}
afterEach(() => cleanup())

describe('VersionHistory', () => {
  it('opens on document.body, outside the line it sits in, so the text never reflows', () => {
    const m = mount()
    cleanup = m.cleanup
    const before = m.line.textContent
    expect(panel()).toBeNull()
    act(() => m.button.click())
    const p = panel()!
    expect(p).not.toBeNull()
    expect(p.parentElement).toBe(document.body)
    expect(m.line.contains(p)).toBe(false)
    expect(m.line.textContent).toBe(before)
    expect(p.style.position).toBe('fixed')
    expect(m.button.getAttribute('aria-expanded')).toBe('true')
  })
  it('lists every version newest first, each with its minute and its note, and links the past ones', () => {
    const m = mount()
    cleanup = m.cleanup
    act(() => m.button.click())
    const rows = [...panel()!.querySelectorAll('li')]
    expect(rows.map((r) => r.querySelector('strong')!.textContent)).toEqual(['Version 3', 'Version 2', 'Version 1'])
    expect(rows[0].textContent).toContain('Added the short version')
    expect(rows[0].textContent).toContain('current')
    expect(rows[2].textContent).toContain('First draft')
    expect(rows[1].querySelector('time')!.textContent).toMatch(/September 26, 2026 at \d{1,2}:30/)
    expect(rows.map((r) => r.querySelector('a')!.getAttribute('href'))).toEqual(['/abc23456', '/abc23456/v/2', '/abc23456/v/1'])
  })
  it('marks the version being read', () => {
    const m = mount(2)
    cleanup = m.cleanup
    act(() => m.button.click())
    expect(panel()!.querySelector('[aria-current="page"]')!.getAttribute('href')).toBe('/abc23456/v/2')
  })
  it('Escape, the close button and a tap outside each close it', () => {
    const m = mount()
    cleanup = m.cleanup
    act(() => m.button.click())
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(panel()).toBeNull()
    act(() => m.button.click())
    act(() => panel()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
    expect(panel()).toBeNull()
    act(() => m.button.click())
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(panel()).toBeNull()
  })
})
