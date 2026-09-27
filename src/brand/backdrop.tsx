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

const CSS = `
@keyframes a-bubble-v{0%,100%{transform:translateY(-50%)}50%{transform:translateY(50%)}}
@keyframes a-bubble-c{0%{transform:rotate(0deg)}50%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}
@keyframes a-bubble-h{0%,100%{transform:translateX(-50%) translateY(-10%)}50%{transform:translateX(50%) translateY(10%)}}
[data-artifact-backdrop] .a-bubble{position:absolute;width:80%;height:80%;top:10%;left:10%;border-radius:9999px;mix-blend-mode:hard-light;animation-timing-function:ease;animation-iteration-count:infinite}
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
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(40px)' }}>
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
