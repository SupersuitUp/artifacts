// The `bubbles` backdrop: soft colour drifting behind a page under a veil of its ground. Drawn
// with plain CSS, so the package takes no animation library and the page needs no client
// script for it. Modelled on animate-ui's BubbleBackground, minus the cursor-follow, which
// would need one.
import type { Backdrop } from './pack.js'

/** The Freedom Glow's colours (a blue core and the spectrum it separates into), mixed most of
 *  the way to cream so a light page still reads as light. */
export const GLOW_PASTELS = ['150,190,255', '215,185,240', '160,225,220', '250,195,180', '250,215,160', '190,210,255']

// [animation, duration s, transform-origin] per bubble, after the original's six.
const MOTION: [string, number, string][] = [
  ['a-bubble-v', 30, 'center center'],
  ['a-bubble-c', 20, 'calc(50% - 400px) center'],
  ['a-bubble-c', 40, 'calc(50% + 400px) center'],
  ['a-bubble-h', 40, 'calc(50% - 200px) center'],
  ['a-bubble-c', 20, 'calc(50% - 800px) calc(50% + 200px)'],
  ['a-bubble-v', 35, 'calc(50% + 300px) calc(50% - 200px)'],
]

// Each bubble is blurred on its OWN layer and only `transform` animates, so the browser rasterises
// it once and slides the bitmap. The first version blurred a full-screen parent and hard-light
// blended every bubble, which re-rasterised the whole viewport each frame and stuttered on a
// phone (2026-09-26). The colours and layout are unchanged from that version on purpose: an
// attempt to also widen the palette was reverted the same night ("really not a fan").
const CSS = `
@keyframes a-bubble-v{0%,100%{transform:translate3d(0,-50%,0)}50%{transform:translate3d(0,50%,0)}}
@keyframes a-bubble-c{0%{transform:rotate(0deg)}50%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}
@keyframes a-bubble-h{0%,100%{transform:translate3d(-50%,-10%,0)}50%{transform:translate3d(50%,10%,0)}}
[data-artifact-backdrop] .a-bubble{position:absolute;width:80%;height:80%;top:10%;left:10%;border-radius:9999px;filter:blur(40px);will-change:transform;backface-visibility:hidden;animation-timing-function:ease;animation-iteration-count:infinite}
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
                background: `radial-gradient(circle at center, rgba(${c},0.8) 0, rgba(${c},0) 50%)`,
                animationName: name,
                animationDuration: `${secs}s`,
                animationDirection: i % 2 ? 'reverse' : 'normal',
                transformOrigin: origin,
              }}
            />
          )
        })}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: `color-mix(in srgb, var(--a-ground) ${veil}%, transparent)` }} />
    </div>
  )
}
