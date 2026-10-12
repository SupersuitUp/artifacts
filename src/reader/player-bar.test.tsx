// The player bar (0.33.1): no narrator line, 2x among the speeds, and a speed button whose
// footprint does not change with its label, so a tap never reflows the bar. jsdom has no layout,
// so this proves the structure that guarantees it (a fixed width, no wrapping, tabular figures, no
// menu inserted into the flow); the measured proof is a real-browser check, recorded in the
// CHANGELOG entry.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayerBar, RATES, nextRate } from './player-bar.js'

const props = { playing: false, onToggle: () => {}, accent: '#f80', ground: '#000', value: 0, max: 10, step: 0.1, onSeek: () => {}, progress: '0:00 / 0:10' }

let root: Root | null = null
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('PlayerBar', () => {
  it('names no narrator, even when an older caller passes a label', () => {
    const html = renderToStaticMarkup(<PlayerBar {...props} label="Read aloud by Freedom" rate={1} onRate={() => {}} />)
    expect(html).not.toContain('Read aloud')
    expect(html).not.toContain('Read by')
  })

  it('steps 1x, 1.25x, 1.5x, 2x and back to 1x', () => {
    expect(RATES).toEqual([1, 1.25, 1.5, 2])
    let r = 1
    const seen = [r]
    for (let i = 0; i < 4; i++) { r = nextRate(r); seen.push(r) }
    expect(seen).toEqual([1, 1.25, 1.5, 2, 1])
    // A rate set some other way still lands on the next step up.
    expect(nextRate(1.1)).toBe(1.25)
    expect(nextRate(3)).toBe(1)
  })

  it('GUARD: the speed button keeps one footprint across every speed, and a tap inserts nothing', async () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    root = createRoot(div)
    let rate = 1
    const draw = () => root!.render(<PlayerBar {...props} rate={rate} onRate={() => { rate = nextRate(rate); draw() }} />)
    await act(async () => { draw() })
    const shapes: string[] = []
    const nodes: number[] = []
    for (let i = 0; i < RATES.length; i++) {
      const btn = div.querySelector<HTMLButtonElement>('[data-artifact-rate]')!
      expect(btn.textContent).toBe(`${RATES[i]}x`)
      const cls = btn.className.split(/\s+/)
      // A fixed width that fits the longest label, never wrapping, with even-width digits.
      expect(cls).toEqual(expect.arrayContaining(['w-14', 'shrink-0', 'whitespace-nowrap', 'tabular-nums', 'text-center']))
      expect(cls.some((c) => /^px-/.test(c))).toBe(false)
      shapes.push(btn.className)
      nodes.push(div.querySelectorAll('*').length)
      await act(async () => { btn.click() })
    }
    expect(new Set(shapes).size).toBe(1)
    // No menu or popover joins the bar when the speed changes.
    expect(new Set(nodes).size).toBe(1)
    expect(div.querySelector<HTMLButtonElement>('[data-artifact-rate]')!.textContent).toBe('1x')
  })
})
