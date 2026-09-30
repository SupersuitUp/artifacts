import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { CodeCopy } from './code-copy.js'

const PRE = (code: string) =>
  `<pre data-artifact-code><code>${code}</code></pre><div id="r"></div>`

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true })

const mount = async () => {
  await act(async () => { createRoot(document.getElementById('r')!).render(<CodeCopy />) })
}

describe('CodeCopy', () => {
  it('puts one copy button on every code block and copies that block', async () => {
    document.body.innerHTML =
      '<pre data-artifact-code><code>first</code></pre>' +
      '<pre data-artifact-code><code>second</code></pre><div id="r"></div>'
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-artifact-copy]'))
    expect(buttons).toHaveLength(2)
    await act(async () => { buttons[1].click() })
    expect(writeText).toHaveBeenCalledWith('second')
  })

  it('copies the code and NOT the button label, which lives inside the same pre', async () => {
    // The button is appended into the <pre> so it can be positioned against it, which puts its
    // own text inside pre.textContent. Reading the <code> is what keeps "Copy" out of the paste.
    document.body.innerHTML = PRE('paste me')
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-artifact-copy]')!.click() })
    expect(writeText).toHaveBeenCalledWith('paste me')
    expect(writeText.mock.calls[0][0]).not.toContain('Copy')
  })

  it('falls back when there is no clipboard API, which is every page served over plain http', async () => {
    document.body.innerHTML = PRE('offline text')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const exec = vi.fn(() => true)
    ;(document as any).execCommand = exec
    await mount()
    const btn = document.querySelector<HTMLButtonElement>('[data-artifact-copy]')!
    await act(async () => { btn.click() })
    expect(exec).toHaveBeenCalledWith('copy')
    expect(btn.textContent).toBe('Copied')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('adds nothing twice and removes what it added when it unmounts', async () => {
    document.body.innerHTML = PRE('x')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
    let root: ReturnType<typeof createRoot>
    await act(async () => { root = createRoot(document.getElementById('r')!); root.render(<CodeCopy />) })
    await act(async () => { root!.render(<CodeCopy />) })
    expect(document.querySelectorAll('[data-artifact-copy]')).toHaveLength(1)
    await act(async () => { root!.unmount() })
    expect(document.querySelectorAll('[data-artifact-copy]')).toHaveLength(0)
  })
})
