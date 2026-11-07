import { clampView, fitted, maxScale, ONE, zoomAt } from './media-zoom.js'

const stage = { w: 400, h: 800 }

describe('fitted', () => {
  it('blows a small image up to fill the screen, keeping its shape', () => {
    expect(fitted({ w: 100, h: 50 }, stage)).toEqual({ w: 400, h: 200 })
  })
  it('shrinks a large image to fit, keeping its shape', () => {
    expect(fitted({ w: 1000, h: 4000 }, stage)).toEqual({ w: 200, h: 800 })
  })
  it('fills the stage when the size is unknown, as with an SVG that declares none', () => {
    expect(fitted({ w: 0, h: 0 }, stage)).toEqual(stage)
  })
})

describe('maxScale', () => {
  it('reaches well past one image pixel to one screen pixel on a large screenshot', () => {
    expect(maxScale({ w: 2000, h: 1000 }, { w: 400, h: 200 })).toBe(10)
  })
  it('still zooms at least 4x on a small image', () => {
    expect(maxScale({ w: 100, h: 50 }, { w: 400, h: 200 })).toBe(4)
  })
  it('stops at 12x', () => {
    expect(maxScale({ w: 9000, h: 4500 }, { w: 400, h: 200 })).toBe(12)
  })
})

describe('clampView', () => {
  const shown = { w: 400, h: 200 }
  it('keeps a zoomed image covering the screen edge to edge', () => {
    expect(clampView({ s: 2, x: 900, y: 0 }, shown, stage).x).toBe(200)
    expect(clampView({ s: 2, x: -900, y: 0 }, shown, stage).x).toBe(-200)
  })
  it('centres an axis the zoomed image does not fill', () => {
    expect(clampView({ s: 2, x: 0, y: 300 }, shown, stage).y).toBe(0)
  })
})

describe('zoomAt', () => {
  const shown = { w: 400, h: 800 }
  it('keeps the point under the fingers where it was', () => {
    const p = { x: 100, y: -50 }
    const v = zoomAt(ONE, 2, p, shown, stage, 8)
    // The image point at p sat at p/1; after zooming it must sit at p again.
    expect(v).toEqual({ s: 2, x: -100, y: 50 })
  })
  it('never zooms below the fitted size, and returns to centre there', () => {
    expect(zoomAt({ s: 2, x: 50, y: 50 }, 0.1, { x: 0, y: 0 }, shown, stage, 8)).toEqual(ONE)
  })
  it('never zooms past the limit', () => {
    expect(zoomAt(ONE, 100, { x: 0, y: 0 }, shown, stage, 8).s).toBe(8)
  })
})
