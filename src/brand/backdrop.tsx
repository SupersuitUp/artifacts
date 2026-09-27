// The `bubbles` backdrop: soft colour drifting behind a page under a veil of its ground. Drawn
// with plain CSS, so the package takes no animation library and the page needs no client
// script for it. Modelled on animate-ui's BubbleBackground, minus the cursor-follow, which
// would need one.
import type { Backdrop } from './pack.js'

/** The Freedom Glow: a blue core and the full spectrum it separates into, one bubble per colour.
 *  Saturated rather than pastel; the veil is what keeps a light page reading as light. */
export const GLOW_PASTELS = [
  '90,150,255', // blue
  '165,120,245', // violet
  '235,110,210', // magenta
  '255,120,150', // rose
  '255,150,110', // coral
  '255,195,90', // amber
  '170,225,100', // lime
  '90,215,170', // mint
  '80,200,240', // cyan
]

// [animation, duration s, transform-origin] per bubble, after animate-ui's six plus three more.
const MOTION: [string, number, string][] = [
  ['a-bubble-v', 30, 'center center'],
  ['a-bubble-c', 20, 'calc(50% - 400px) center'],
  ['a-bubble-c', 40, 'calc(50% + 400px) center'],
  ['a-bubble-h', 40, 'calc(50% - 200px) center'],
  ['a-bubble-c', 20, 'calc(50% - 800px) calc(50% + 200px)'],
  ['a-bubble-v', 35, 'calc(50% + 300px) calc(50% - 200px)'],
  ['a-bubble-h', 45, 'calc(50% + 200px) calc(50% + 300px)'],
  ['a-bubble-c', 30, 'calc(50% + 600px) calc(50% - 300px)'],
  ['a-bubble-v', 25, 'calc(50% - 300px) calc(50% + 400px)'],
]

// [top %, left %] per bubble: spread over the page so neighbours overlap at their edges only.
// Stacked in the middle, nine translucent hues average to grey.
const HOME: [number, number][] = [
  [-10, -15], [-15, 45], [15, 20], [30, -20], [35, 50], [55, 10], [65, 45], [80, -15], [85, 35],
]

// Only `transform` animates, on its own layer, so the browser moves finished bitmaps and never
// repaints. The first version put a 40px blur over the whole viewport and hard-light blended every
// bubble, which re-rasterised the full screen each frame and stuttered on a phone; the radial
// gradients already fade to nothing, so neither was buying softness.
const CSS = `
@keyframes a-bubble-v{0%,100%{transform:translate3d(0,-50%,0)}50%{transform:translate3d(0,50%,0)}}
@keyframes a-bubble-c{0%{transform:rotate(0deg)}50%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}
@keyframes a-bubble-h{0%,100%{transform:translate3d(-50%,-10%,0)}50%{transform:translate3d(50%,10%,0)}}
[data-artifact-backdrop] .a-bubble{position:absolute;width:70%;height:60%;border-radius:9999px;will-change:transform;backface-visibility:hidden;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
@media (prefers-reduced-motion: reduce){[data-artifact-backdrop] .a-bubble{animation:none!important}}
`

export function Bubbles({ backdrop }: { backdrop: Backdrop }) {
  const colors = backdrop.colors?.length ? backdrop.colors : GLOW_PASTELS
  const veil = Math.round((backdrop.veil ?? 0.4) * 100)
  return (
    <div
      data-artifact-backdrop="bubbles"
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', background: 'var(--a-ground)', pointerEvents: 'none' }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ position: 'absolute', inset: 0 }}>
        {colors.map((c, i) => {
          const [name, secs, origin] = MOTION[i % MOTION.length]
          return (
            <div
              key={i}
              className="a-bubble"
              style={{
                background: `radial-gradient(closest-side, rgba(${c},0.9) 0%, rgba(${c},0.6) 35%, rgba(${c},0.2) 70%, rgba(${c},0) 100%)`,
                animationName: name,
                animationDuration: `${secs}s`,
                animationDirection: i % 2 ? 'reverse' : 'normal',
                transformOrigin: origin,
                top: `${HOME[i % HOME.length][0]}%`,
                left: `${HOME[i % HOME.length][1]}%`,
              }}
            />
          )
        })}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: `color-mix(in srgb, var(--a-ground) ${veil}%, transparent)` }} />
    </div>
  )
}
