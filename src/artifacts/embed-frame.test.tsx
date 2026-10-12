import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EmbedFrame } from './embed-frame.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('EmbedFrame', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
  const mount = () => {
    host = document.createElement('div'); document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<EmbedFrame src="https://example.com/simulator/embed?scenario=a&fit=content" title="A demo" height="760px" />))
    return host.querySelector('iframe') as HTMLIFrameElement
  }
  const say = (source: unknown, origin: string, data: unknown) => act(() => {
    const e = new MessageEvent('message', { data, origin })
    Object.defineProperty(e, 'source', { value: source })
    window.dispatchEvent(e)
  })

  it('opens at the block\'s height and takes the height its own player reports', () => {
    const f = mount()
    expect(f.style.height).toBe('760px')
    say(f.contentWindow, 'https://example.com', { type: 'embed:fit', height: 512 })
    expect(f.style.height).toBe('512px')
    say(f.contentWindow, 'https://example.com', { type: 'embed:fit', height: 640 })
    expect(f.style.height).toBe('640px')
  })
  it('ignores another frame, another origin and another message', () => {
    const f = mount()
    say(window, 'https://example.com', { type: 'embed:fit', height: 300 })
    say(f.contentWindow, 'https://evil.example', { type: 'embed:fit', height: 300 })
    say(f.contentWindow, 'https://example.com', { type: 'something:else', height: 300 })
    expect(f.style.height).toBe('760px')
  })
})
