import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MediaViewer } from './media-viewer.js'

const PAGE = `
  <img data-artifact-image src="/a.png" alt="First">
  <p>Words</p>
  <img data-artifact-image src="/b.png" alt="Second">
  <video data-artifact-video data-artifact-media="c.mp4" src="/c.mp4" aria-label="Third" muted loop></video>
  <span><video data-artifact-media="d.mp4" src="/d.mp4" aria-label="Fourth" controls></video></span>
  <a href="https://example.com"><img data-artifact-image src="/linked.png" alt="Linked"></a>
  <div id="r"></div>`

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom draws no media.
  HTMLMediaElement.prototype.pause = () => {}
  HTMLMediaElement.prototype.load = () => {}
})

let roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const r of roots) r.unmount() })
  roots = []
  document.body.innerHTML = ''
})

const mount = async (html = PAGE, times = 1) => {
  document.body.innerHTML = html
  await act(async () => {
    for (let i = 0; i < times; i++) {
      const host = document.body.appendChild(document.createElement('div'))
      const root = createRoot(host)
      roots.push(root)
      root.render(<MediaViewer />)
    }
  })
}

const dialog = () => document.querySelector<HTMLElement>('[data-artifact-viewer]')
const stage = () => document.querySelector<HTMLElement>('[data-artifact-viewer-stage]')!
const shown = () => stage().querySelector<HTMLElement>('img, video')!
const button = (label: string) => document.querySelector<HTMLButtonElement>(`[data-artifact-viewer] button[aria-label="${label}"]`)
const press = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const openFirst = () => press(document.querySelector('img')!)

const pointer = (type: string, id: number, x: number, y: number, pointerType = 'touch') => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
  Object.assign(e, { pointerId: id, pointerType })
  return e
}
const fire = (type: string, id: number, x: number, y: number, pointerType?: string) =>
  act(async () => { stage().dispatchEvent(pointer(type, id, x, y, pointerType)) })
const scale = () => Number(/scale\(([\d.]+)\)/.exec(shown().style.transform)?.[1] ?? 1)

/** Two fingers going from `gap` apart to `to` apart, around the middle of the 1024x768 window. */
const pinch = async (gap: number, to: number) => {
  await fire('pointerdown', 1, 512 - gap / 2, 384)
  await fire('pointerdown', 2, 512 + gap / 2, 384)
  await fire('pointermove', 1, 512 - to / 2, 384)
  await fire('pointermove', 2, 512 + to / 2, 384)
  await fire('pointerup', 1, 512 - to / 2, 384)
  await fire('pointerup', 2, 512 + to / 2, 384)
}
const swipe = async (dx: number, dy = 0) => {
  await fire('pointerdown', 1, 500, 400)
  await fire('pointermove', 1, 500 + dx / 2, 400 + dy / 2)
  await fire('pointermove', 1, 500 + dx, 400 + dy)
  await fire('pointerup', 1, 500 + dx, 400 + dy)
}

describe('opening', () => {
  it('blows the tapped image up full screen over the page', async () => {
    await mount()
    await press(document.querySelectorAll('img')[1])
    expect(dialog()!.style.position).toBe('fixed')
    expect(shown().getAttribute('src')).toBe('/b.png')
    expect(dialog()!.textContent).toContain('2 of 4')
    expect(dialog()!.textContent).toContain('Second')
  })

  it('takes every touch itself, so a pinch zooms the image and not the page', async () => {
    await mount()
    await openFirst()
    expect(stage().style.touchAction).toBe('none')
    // iOS Safari: these stop the page zooming and scrolling behind the viewer.
    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    stage().dispatchEvent(move)
    expect(move.defaultPrevented).toBe(true)
    const gesture = new Event('gesturestart', { bubbles: true, cancelable: true })
    stage().dispatchEvent(gesture)
    expect(gesture.defaultPrevented).toBe(true)
  })

  it('stops the page scrolling behind it and gives the scroll back', async () => {
    await mount()
    await openFirst()
    expect(document.documentElement.style.overflow).toBe('hidden')
    await press(button('Close')!)
    expect(dialog()).toBeNull()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('tells a screen reader that an image opens a dialog, and takes that back on unmount', async () => {
    await mount()
    const img = document.querySelector('img')!
    expect(img.getAttribute('aria-haspopup')).toBe('dialog')
    await act(async () => { for (const r of roots) r.unmount() })
    roots = []
    expect(img.hasAttribute('aria-haspopup')).toBe(false)
  })

  it('centres the counter, clear of the buttons iOS puts in the top left of a clip', async () => {
    await mount()
    await openFirst()
    const counter = Array.from(dialog()!.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === '1 of 4')!
    expect(counter.style.textAlign).toBe('center')
  })

  it('opens from the keyboard', async () => {
    await mount()
    const img = document.querySelector('img')!
    expect(img.tabIndex).toBe(0)
    await act(async () => { img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    expect(dialog()).not.toBeNull()
  })

  it('leaves an image inside a link to the link, and out of the sequence', async () => {
    await mount()
    const linked = document.querySelector('a img')!
    await press(linked)
    expect(dialog()).toBeNull()
    await openFirst()
    expect(dialog()!.textContent).toContain('1 of 4')
  })

  it('does not open after a drag, which draws a comment box on the image', async () => {
    await mount()
    const img = document.querySelector('img')!
    await act(async () => {
      img.dispatchEvent(pointer('pointerdown', 1, 10, 10, 'mouse'))
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 90, clientY: 90 }))
    })
    expect(dialog()).toBeNull()
  })

  it('opens one viewer when a page holds two bodies of markdown', async () => {
    await mount(PAGE, 2)
    await openFirst()
    expect(document.querySelectorAll('[data-artifact-viewer]')).toHaveLength(1)
  })

  it('opens an image a brand pack drew itself', async () => {
    await mount('<div data-artifact-figure><img src="/pack.png" alt="Drawn"></div>')
    await openFirst()
    expect(shown().getAttribute('src')).toBe('/pack.png')
  })

  it('opens a silent video by tapping it, as a looping muted picture', async () => {
    await mount()
    await press(document.querySelector('video')!)
    const v = shown() as HTMLVideoElement
    expect(v.tagName).toBe('VIDEO')
    expect(v.muted).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.controls).toBe(false)
    expect(v.hasAttribute('playsinline')).toBe(true)
  })

  it('captions a video with its own words, read from the page after the page was dressed', async () => {
    await mount()
    await press(document.querySelector('video')!)
    expect(dialog()!.textContent).toContain('Third')
    expect(dialog()!.textContent).not.toContain('Open full screen')
  })

  it('leaves tapping a video with sound to its own controls, and gives it an expand button', async () => {
    await mount()
    const v = document.querySelector<HTMLVideoElement>('video[controls]')!
    await press(v)
    expect(dialog()).toBeNull()
    await press(v.parentElement!.querySelector('[data-artifact-expand]')!)
    expect((shown() as HTMLVideoElement).controls).toBe(true)
    expect(dialog()!.textContent).toContain('4 of 4')
  })

  it('pauses a clip with sound on the page while the viewer plays it, so it is heard once', async () => {
    await mount()
    const pause = vi.fn()
    const v = document.querySelector<HTMLVideoElement>('video[controls]')!
    v.pause = pause
    await press(v.parentElement!.querySelector('[data-artifact-expand]')!)
    expect(pause).toHaveBeenCalled()
  })

  it('removes what it added to the page when it unmounts', async () => {
    await mount()
    await act(async () => { for (const r of roots) r.unmount() })
    roots = []
    expect(document.querySelector('[data-artifact-expand]')).toBeNull()
  })
})

describe('moving through the page', () => {
  it('has arrows through every image and video in page order, stopping at each end', async () => {
    await mount()
    await openFirst()
    expect(button('Previous')).toBeNull()
    await press(button('Next')!)
    expect(shown().getAttribute('src')).toBe('/b.png')
    await press(button('Next')!)
    expect(shown().getAttribute('src')).toBe('/c.mp4')
    await press(button('Next')!)
    expect(shown().getAttribute('src')).toBe('/d.mp4')
    expect(button('Next')).toBeNull()
    await press(button('Previous')!)
    expect(shown().getAttribute('src')).toBe('/c.mp4')
  })

  it('draws no arrows for a page with one image', async () => {
    await mount('<img data-artifact-image src="/a.png" alt="Only">')
    await openFirst()
    expect(button('Next')).toBeNull()
    expect(button('Previous')).toBeNull()
    expect(dialog()!.textContent).not.toContain('1 of 1')
  })

  it('moves with the arrow keys, and Escape closes it before anything else on the page', async () => {
    await mount()
    await openFirst()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
    expect(shown().getAttribute('src')).toBe('/b.png')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })) })
    expect(shown().getAttribute('src')).toBe('/a.png')
    const heard = vi.fn()
    document.addEventListener('keydown', heard)
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    document.removeEventListener('keydown', heard)
    expect(dialog()).toBeNull()
    expect(heard).not.toHaveBeenCalled()
  })

  it('swipes to the next and previous one', async () => {
    await mount()
    await openFirst()
    await swipe(-200)
    expect(shown().getAttribute('src')).toBe('/b.png')
    await swipe(200)
    expect(shown().getAttribute('src')).toBe('/a.png')
  })

  it('swipes down to close, and a small drag does nothing', async () => {
    await mount()
    await openFirst()
    await swipe(0, 30)
    expect(dialog()).not.toBeNull()
    await swipe(0, 200)
    expect(dialog()).toBeNull()
  })

  it('leaves a scrub on a video with controls to the controls', async () => {
    await mount()
    await press(document.querySelector('[data-artifact-expand]')!)
    await press(button('Previous')!)
    await press(button('Next')!)
    const v = shown()
    await act(async () => {
      v.dispatchEvent(pointer('pointerdown', 1, 500, 400))
      v.dispatchEvent(pointer('pointermove', 1, 300, 400))
      v.dispatchEvent(pointer('pointerup', 1, 300, 400))
    })
    expect(shown().getAttribute('src')).toBe('/d.mp4')
  })

  it('starts the next image at the fitted size', async () => {
    await mount()
    await openFirst()
    await pinch(100, 300)
    expect(scale()).toBeGreaterThan(1)
    await press(button('Next')!)
    expect(scale()).toBe(1)
  })
})

describe('the black around a picture', () => {
  const letterbox = () => {
    Object.defineProperty(shown(), 'naturalWidth', { value: 1000 })
    Object.defineProperty(shown(), 'naturalHeight', { value: 100 })
  }
  it('keeps the viewer open when a finger lands there, so a near miss on an arrow loses nothing', async () => {
    await mount()
    await openFirst()
    letterbox()
    await fire('pointerdown', 1, 512, 10); await fire('pointerup', 1, 512, 10)
    expect(dialog()).not.toBeNull()
  })
  it('closes the viewer on a mouse click, as a page behind a dialog does', async () => {
    await mount()
    await openFirst()
    letterbox()
    await fire('pointerdown', 1, 512, 10, 'mouse'); await fire('pointerup', 1, 512, 10, 'mouse')
    expect(dialog()).toBeNull()
  })
})

describe('zooming', () => {
  it('pinches in by how far the fingers spread', async () => {
    await mount()
    await openFirst()
    await pinch(100, 300)
    expect(scale()).toBeCloseTo(3, 5)
  })

  it('pinches back out to the fitted size and no further', async () => {
    await mount()
    await openFirst()
    await pinch(100, 300)
    await pinch(300, 20)
    expect(scale()).toBe(1)
  })

  it('pans a zoomed image rather than moving to the next one', async () => {
    await mount()
    await openFirst()
    await pinch(100, 300)
    const before = shown().style.transform
    await swipe(-200)
    expect(shown().getAttribute('src')).toBe('/a.png')
    expect(shown().style.transform).not.toBe(before)
  })

  it('double taps in on the image and back out', async () => {
    await mount()
    await openFirst()
    await fire('pointerdown', 1, 512, 384); await fire('pointerup', 1, 512, 384)
    await fire('pointerdown', 1, 512, 384); await fire('pointerup', 1, 512, 384)
    expect(scale()).toBeGreaterThan(1)
    await fire('pointerdown', 1, 512, 384); await fire('pointerup', 1, 512, 384)
    await fire('pointerdown', 1, 512, 384); await fire('pointerup', 1, 512, 384)
    expect(scale()).toBe(1)
  })

  it('zooms on one click with a mouse', async () => {
    await mount()
    await openFirst()
    await fire('pointerdown', 1, 512, 384, 'mouse'); await fire('pointerup', 1, 512, 384, 'mouse')
    expect(scale()).toBeGreaterThan(1)
  })

  it('zooms with a trackpad pinch, which reaches the page as a ctrl wheel', async () => {
    await mount()
    await openFirst()
    const wheel = new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, clientX: 512, clientY: 384, bubbles: true, cancelable: true })
    await act(async () => { stage().dispatchEvent(wheel) })
    expect(wheel.defaultPrevented).toBe(true)
    expect(scale()).toBeGreaterThan(1)
  })

  it('zooms from the keyboard', async () => {
    await mount()
    await openFirst()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true })) })
    expect(scale()).toBeGreaterThan(1)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', cancelable: true })) })
    expect(scale()).toBe(1)
  })
})
