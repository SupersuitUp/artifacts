import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QuietView } from './quiet-view.js'

let visibility: 'visible' | 'hidden' = 'visible'
let prerendering = false
const posts: { url: string; body: Record<string, unknown> }[] = []
const roots: Root[] = []

function render(el: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(el))
  return { container }
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  posts.length = 0
  visibility = 'visible'
  prerendering = false
  document.body.innerHTML = ''
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  Object.defineProperty(document, 'prerendering', { configurable: true, get: () => prerendering })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { posts.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ beat: 'b'.repeat(16) }), { status: 200 }) }))
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: vi.fn(() => true) })
})
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const props = { id: 'abcd2345', rid: 'r0r0r0r0r0r0', sig: '0'.repeat(16), token: 'tok' }
const hide = () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) }
const show = () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) }

describe('QuietView', () => {
  it('renders nothing on the page', () => {
    const { container } = render(<QuietView {...props} />)
    expect(container.innerHTML).toBe('')
  })
  it('a page shown for two seconds sends exactly one view', async () => {
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(1999)
    expect(posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(posts.filter((p) => p.body.event === 'view')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(posts.filter((p) => p.body.event === 'view')).toHaveLength(1)
    expect(posts[0].url).toBe('/api/artifacts/abcd2345/seen')
    expect(posts[0].body).toMatchObject({ rid: props.rid, token: 'tok' })
  })
  it('a page rendered in a background tab never sends a view', async () => {
    visibility = 'hidden'
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(posts).toHaveLength(0)
  })
  it('a hidden prerender never sends a view, until it is shown', async () => {
    prerendering = true
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(posts).toHaveLength(0)
    prerendering = false
    document.dispatchEvent(new Event('prerenderingchange'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(posts.filter((p) => p.body.event === 'view')).toHaveLength(1)
  })
  it('a page opened in the background counts its two seconds from when it is shown', async () => {
    visibility = 'hidden'
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(1500)
    show()
    await vi.advanceTimersByTimeAsync(1999)
    expect(posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(posts).toHaveLength(1)
  })
  it('hiding before two seconds resets the wait', async () => {
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(1500)
    hide()
    await vi.advanceTimersByTimeAsync(5000)
    show()
    await vi.advanceTimersByTimeAsync(1500)
    expect(posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(posts).toHaveLength(1)
  })
  it('sends a beat every fifteen seconds while visible, and one by beacon on hide', async () => {
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(2000 + 15_000)
    expect(posts.find((p) => p.body.event === 'beat')?.body).toMatchObject({ beat: 'b'.repeat(16), seconds: 15 })
    await vi.advanceTimersByTimeAsync(4000)
    hide()
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1)
  })
  it('a play on a tracked video is sent once the view is in', async () => {
    document.body.innerHTML = '<video data-artifact-media="river.mp4"></video>'
    render(<QuietView {...props} />)
    await vi.advanceTimersByTimeAsync(2000)
    document.querySelector('video')!.dispatchEvent(new Event('play'))
    await vi.advanceTimersByTimeAsync(0)
    expect(posts.find((p) => p.body.event === 'play')?.body).toMatchObject({ media: 'river.mp4', beat: 'b'.repeat(16) })
  })
})
