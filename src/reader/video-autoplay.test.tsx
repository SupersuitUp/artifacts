import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { VideoAutoplay } from './video-autoplay.js'

type Entry = { target: Element; isIntersecting: boolean }
let fire: (entries: Entry[]) => void = () => {}
const observed: Element[] = []
beforeEach(() => {
  observed.length = 0
  ;(globalThis as any).IntersectionObserver = class {
    constructor(cb: (e: Entry[]) => void) { fire = cb }
    observe(el: Element) { observed.push(el) }
    disconnect() {}
  }
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

describe('VideoAutoplay', () => {
  it('loads and plays a video only when it nears the screen, and pauses it when it leaves', async () => {
    document.body.innerHTML = '<video data-artifact-video preload="metadata"></video><video data-artifact-video preload="metadata"></video><div id="r"></div>'
    const [a, b] = Array.from(document.querySelectorAll('video'))
    const play = vi.fn(async () => {}), pause = vi.fn()
    for (const v of [a, b]) Object.assign(v, { play, pause })
    await act(async () => { createRoot(document.getElementById('r')!).render(<VideoAutoplay />) })
    expect(observed).toEqual([a, b])
    expect(play).not.toHaveBeenCalled()
    act(() => fire([{ target: a, isIntersecting: true }]))
    expect(play).toHaveBeenCalledTimes(1)
    expect(a.preload).toBe('auto')
    expect(b.preload).toBe('metadata')
    act(() => fire([{ target: a, isIntersecting: false }]))
    expect(pause).toHaveBeenCalledTimes(1)
  })
})
