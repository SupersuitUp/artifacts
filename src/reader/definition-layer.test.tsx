import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from '../artifacts/render.js'
import { DefinitionLayer } from './definition-layer.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const md = 'Your Agentic Edge grows.'
const definitions = [{ term: 'Agentic Edge', text: 'The compounded context only you could have produced.', href: 'https://example.com/edge' }]

function mount() {
  const page = document.createElement('div')
  page.innerHTML = renderToStaticMarkup(<ArtifactMarkdown markdown={md} definitions={definitions} />)
  document.body.appendChild(page)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<DefinitionLayer />))
  const term = page.querySelector<HTMLElement>('[data-defined-term]')!
  return { page, term, cleanup: () => { act(() => root.unmount()); page.remove(); host.remove() } }
}
const sheet = () => document.querySelector('[data-definition-sheet]')

let cleanup = () => {}
afterEach(() => cleanup())

describe('DefinitionLayer', () => {
  it('a tap opens the definition on document.body, outside the paragraph, and the paragraph is untouched', () => {
    const m = mount(); cleanup = m.cleanup
    const p = m.term.closest('p')!
    const before = p.innerHTML.replace(' aria-expanded="false"', '')
    act(() => m.term.click())
    expect(sheet()?.textContent).toContain('The compounded context only you could have produced.')
    expect(sheet()?.parentElement).toBe(document.body)
    expect(p.contains(sheet())).toBe(false)
    expect(m.term.getAttribute('aria-expanded')).toBe('true')
    expect(p.innerHTML.replace(' aria-expanded="true"', '')).toBe(before)
    expect(sheet()?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/edge')
  })
  it('a second tap, Escape, or a tap elsewhere closes it', () => {
    const m = mount(); cleanup = m.cleanup
    act(() => m.term.click())
    act(() => m.term.click())
    expect(sheet()).toBeNull()
    act(() => m.term.click())
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(sheet()).toBeNull()
    act(() => m.term.click())
    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(sheet()).toBeNull()
    expect(m.term.getAttribute('aria-expanded')).toBe('false')
  })
  it('Enter on the focused term opens it, for a keyboard', () => {
    const m = mount(); cleanup = m.cleanup
    act(() => { m.term.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(sheet()).not.toBeNull()
  })
})
