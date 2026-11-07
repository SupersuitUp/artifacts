// The arithmetic of a zoomed picture, apart from the gestures that drive it, so it can be proved
// without a finger. A view is the picture's scale and how far its centre sits from the screen's.
// Scale 1 is the picture fitted to the screen.
export type Size = { w: number; h: number }
export type Point = { x: number; y: number }
export type View = { s: number; x: number; y: number }

export const ONE: View = { s: 1, x: 0, y: 0 }

const MIN_MAX_SCALE = 4
const MAX_MAX_SCALE = 12

/** The size a picture draws at when fitted to the screen. A small picture is blown up to fill it. */
export function fitted(natural: Size, stage: Size): Size {
  if (!natural.w || !natural.h) return stage
  const k = Math.min(stage.w / natural.w, stage.h / natural.h)
  return { w: natural.w * k, h: natural.h * k }
}

/** How far a picture may zoom: far enough to read a large screenshot at twice its own pixels. */
export function maxScale(natural: Size, shown: Size): number {
  const pixels = shown.w ? (2 * natural.w) / shown.w : 0
  return Math.min(MAX_MAX_SCALE, Math.max(MIN_MAX_SCALE, pixels))
}

/** `v` with its offset held so the zoomed picture never leaves a gap it could cover. */
export function clampView(v: View, shown: Size, stage: Size): View {
  const reach = (size: number, room: number) => Math.max(0, (size * v.s - room) / 2)
  const hold = (n: number, r: number) => (r === 0 ? 0 : Math.min(r, Math.max(-r, n)))
  return { s: v.s, x: hold(v.x, reach(shown.w, stage.w)), y: hold(v.y, reach(shown.h, stage.h)) }
}

/** `v` zoomed by `factor` about `p`, a point measured from the screen's centre. The picture point
 *  under `p` stays under `p`, so a pinch zooms what the fingers are on. */
export function zoomAt(v: View, factor: number, p: Point, shown: Size, stage: Size, max: number): View {
  const s = Math.min(max, Math.max(1, v.s * factor))
  if (s === 1) return ONE
  const k = s / v.s
  return clampView({ s, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }, shown, stage)
}
