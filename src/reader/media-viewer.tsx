'use client'

// Tap any image or video on a page and it fills the screen: pinch to zoom, drag to look around,
// arrows and swipes to move through every picture and video on the page in order.
//
// A phone cannot read a screenshot at the width of a column, and until now the page itself was the
// only thing to pinch, which zooms the words and the bars with it. The viewer sits over the page in
// a portal on <body>, outside the comment layer's root, so the comment gestures never see it.
//
// It adds nothing to the server render: the page is a plain page with this component disabled.
// All styles are inline because a host's Tailwind build decides which classes exist.
//
// iOS Safari is the hard target. `touch-action: none` alone does not always hold there, so the
// viewer also cancels touchmove and Safari's gesture events; those are what keep a pinch on the
// picture instead of on the page behind it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { clampView, fitted, maxScale, ONE, zoomAt, type Point, type Size, type View } from './media-zoom.js'

const ITEMS = 'img[data-artifact-image], [data-artifact-figure] img, video[data-artifact-media]'
const EXPAND = 'data-artifact-expand'
/** A press that travelled this far was a drag (a comment box, a scroll), never a tap. */
const TAP_PX = 10
const DOUBLE_TAP_MS = 300
const SWIPE_PX = 60
const FLICK_PX = 24
const FLICK_MS = 250
const CLOSE_PX = 90
const TAP_ZOOM = 2.5
const KEY_ZOOM = 1.5
const WHEEL_ZOOM = 0.01

type Item = { el: HTMLImageElement | HTMLVideoElement; video: boolean; src: string; alt: string; controls: boolean }

const isVideo = (el: Element): el is HTMLVideoElement => el.tagName === 'VIDEO'
const scrubbing = (t: EventTarget | null) => t instanceof Element && !!t.closest('video[controls]')

/** Every picture and video on the page, in page order. An image inside a link belongs to the link. */
function pageItems(): Item[] {
  return Array.from(document.querySelectorAll<HTMLImageElement | HTMLVideoElement>(ITEMS))
    .filter((el) => !el.closest('a[href], button'))
    .map((el) => ({
      el,
      video: isVideo(el),
      src: el.currentSrc || el.getAttribute('src') || '',
      alt: (isVideo(el) ? el.getAttribute('aria-label') : el.getAttribute('alt')) ?? '',
      controls: isVideo(el) && el.controls,
    }))
}

const round: CSSProperties = {
  width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  border: 'none', borderRadius: 999, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer',
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function MediaViewer() {
  const [open, setOpen] = useState<{ items: Item[]; at: number } | null>(null)

  useEffect(() => {
    let down: { x: number; y: number } | null = null
    const onDown = (e: Event) => { const p = e as PointerEvent; down = { x: p.clientX, y: p.clientY } }
    const show = (el: Element) => {
      const items = pageItems()
      const at = items.findIndex((i) => i.el === el)
      if (at >= 0) setOpen({ items, at })
      return at >= 0
    }
    const target = (e: Event) => {
      const t = e.target
      if (!(t instanceof Element)) return null
      const expand = t.closest(`[${EXPAND}]`)
      if (expand) return expand.parentElement?.querySelector('video') ?? null
      if (scrubbing(t)) return null
      return t.closest(ITEMS)
    }
    const onClick = (e: MouseEvent) => {
      // A second copy of this component on the page has already taken the click.
      if (e.defaultPrevented) return
      const was = down
      down = null
      if (was && Math.hypot(e.clientX - was.x, e.clientY - was.y) > TAP_PX) return
      const el = target(e)
      if (el && show(el)) e.preventDefault()
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented) return
      const el = target(e)
      if (el && show(el)) e.preventDefault()
    }
    const added: Element[] = []
    const dressed: HTMLElement[] = []
    for (const { el, controls } of pageItems()) {
      if (controls) {
        const box = el.parentElement
        if (!box || box.querySelector(`[${EXPAND}]`)) continue
        box.style.position = 'relative'
        const b = document.createElement('button')
        b.type = 'button'
        b.setAttribute(EXPAND, 'true')
        b.setAttribute('aria-label', 'Open this video full screen')
        b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>'
        Object.assign(b.style, { position: 'absolute', top: '8px', right: '8px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', border: 'none', borderRadius: '999px', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer' })
        box.appendChild(b)
        added.push(b)
        continue
      }
      el.style.cursor = 'zoom-in'
      el.tabIndex = 0
      el.setAttribute('role', 'button')
      el.setAttribute('aria-haspopup', 'dialog')
      dressed.push(el)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
      for (const b of added) b.remove()
      for (const el of dressed) { el.style.cursor = ''; el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-haspopup') }
    }
  }, [])

  const close = useCallback(() => setOpen(null), [])
  return open ? createPortal(<Viewer items={open.items} start={open.at} onClose={close} />, document.body) : null
}

type Press = { x: number; y: number; t: number; view: View; axis: 'x' | 'y' | null; pinched: boolean }
type Pinch = { dist: number; mid: Point; view: View }

function Viewer({ items, start, onClose }: { items: Item[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start)
  const dir = useRef(0)
  const item = items[at]
  const shell = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const media = useRef<HTMLImageElement & HTMLVideoElement>(null)
  const view = useRef<View>(ONE)
  const points = useRef(new Map<number, Point>())
  const press = useRef<Press | null>(null)
  const pinch = useRef<Pinch | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const multiple = items.length > 1

  const stageSize = (): Size => ({ w: stage.current?.clientWidth || window.innerWidth, h: stage.current?.clientHeight || window.innerHeight })
  const natural = (): Size => {
    const m: HTMLImageElement | HTMLVideoElement | null = media.current
    if (!m) return { w: 0, h: 0 }
    return isVideo(m) ? { w: m.videoWidth, h: m.videoHeight } : { w: m.naturalWidth, h: m.naturalHeight }
  }
  const shownSize = () => fitted(natural(), stageSize())
  /** A window point, measured from the screen's centre. */
  const centred = (x: number, y: number): Point => {
    const r = stage.current?.getBoundingClientRect()
    const s = stageSize()
    return { x: x - (r?.left ?? 0) - s.w / 2, y: y - (r?.top ?? 0) - s.h / 2 }
  }
  const paint = (v: View, animate = false) => {
    if (!media.current) return
    media.current.style.transition = animate ? 'transform 0.2s ease-out' : 'none'
    media.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`
    if (shell.current) shell.current.style.background = '#000'
  }
  const set = (v: View, animate = false) => { view.current = v; paint(v, animate) }
  const zoomBy = (factor: number, p: Point, animate = false) =>
    set(zoomAt(view.current, factor, p, shownSize(), stageSize(), maxScale(natural(), shownSize())), animate)
  const go = useCallback((d: number) => {
    setAt((n) => {
      const to = Math.min(items.length - 1, Math.max(0, n + d))
      if (to !== n) dir.current = d
      return to
    })
  }, [items.length])

  // Each item opens fitted, sliding in from the side the reader moved toward.
  useLayoutEffect(() => {
    view.current = ONE
    paint(ONE)
    const m = media.current
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (dir.current && m && !still) m.animate?.([{ opacity: 0, transform: `translateX(${dir.current * 48}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' })
    dir.current = 0
    // The next and previous pictures are ready before the reader asks for them.
    for (const n of [items[at - 1], items[at + 1]]) if (n && !n.video) new Image().src = n.src
    // A clip with sound moves to the viewer and comes back at the second it reached.
    const src = items[at]
    if (!src.controls) return
    const inline = src.el as HTMLVideoElement
    inline.pause?.()
    const shown = m as HTMLVideoElement | null
    return () => { if (shown && shown.currentTime) inline.currentTime = shown.currentTime }
  // `paint` reads only refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, items])

  useEffect(() => {
    const root = document.documentElement
    const was = root.style.overflow
    root.style.overflow = 'hidden'
    const before = document.activeElement as HTMLElement | null
    shell.current?.focus()
    return () => { root.style.overflow = was; before?.focus?.() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act: Record<string, () => void> = {
        Escape: onClose,
        ArrowRight: () => go(1),
        ArrowLeft: () => go(-1),
        '+': () => zoomBy(KEY_ZOOM, { x: 0, y: 0 }, true),
        '=': () => zoomBy(KEY_ZOOM, { x: 0, y: 0 }, true),
        '-': () => zoomBy(1 / KEY_ZOOM, { x: 0, y: 0 }, true),
        '0': () => set(ONE, true),
      }
      if (e.key === 'Tab') {
        const stops = Array.from(shell.current?.querySelectorAll<HTMLElement>('button') ?? [])
        const now = stops.indexOf(document.activeElement as HTMLElement)
        stops[(now + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const run = act[e.key]
      if (!run) return
      // Capture on window, and stopped: Escape closes this before a comment card under it.
      e.preventDefault()
      e.stopPropagation()
      run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, onClose])

  useEffect(() => {
    const el = shell.current
    const box = stage.current
    if (!el || !box) return
    const noTouch = (e: Event) => { if (!scrubbing(e.target)) e.preventDefault() }
    const noGesture = (e: Event) => e.preventDefault()
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = centred(e.clientX, e.clientY)
      // A trackpad pinch arrives as a wheel with ctrl held.
      if (e.ctrlKey || view.current.s === 1) return zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM), p)
      set(clampView({ ...view.current, x: view.current.x - e.deltaX, y: view.current.y - e.deltaY }, shownSize(), stageSize()))
    }
    el.addEventListener('touchmove', noTouch, { passive: false })
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(g, noGesture)
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('touchmove', noTouch)
      for (const g of ['gesturestart', 'gesturechange', 'gestureend']) el.removeEventListener(g, noGesture)
      box.removeEventListener('wheel', onWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tap = (x: number, y: number, mouse: boolean) => {
    const p = centred(x, y)
    const v = view.current
    const shown = shownSize()
    // Off the picture a mouse closes the viewer. A finger does not: the arrows sit in that black,
    // and a near miss must not throw the reader back to the page (seen on an iPhone, 2026-11-06).
    if (Math.abs(p.x - v.x) > (shown.w * v.s) / 2 || Math.abs(p.y - v.y) > (shown.h * v.s) / 2) return mouse ? onClose() : undefined
    const t = Date.now()
    const last = lastTap.current
    const twice = !!last && t - last.t < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < TAP_PX * 3
    lastTap.current = twice ? null : { t, x, y }
    if (!mouse && !twice) return
    if (v.s > 1) set(ONE, true)
    else zoomBy(TAP_ZOOM, p, true)
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const held = Array.from(points.current.values())
    if (held.length === 1) press.current = { x: e.clientX, y: e.clientY, t: Date.now(), view: view.current, axis: null, pinched: false }
    if (held.length === 2) {
      if (press.current) press.current.pinched = true
      pinch.current = { dist: Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y), mid: { x: (held[0].x + held[1].x) / 2, y: (held[0].y + held[1].y) / 2 }, view: view.current }
    }
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!points.current.has(e.pointerId)) return
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const held = Array.from(points.current.values())
    const two = pinch.current
    if (held.length >= 2 && two) {
      const mid = { x: (held[0].x + held[1].x) / 2, y: (held[0].y + held[1].y) / 2 }
      const dist = Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y)
      const shown = shownSize()
      const v = zoomAt(two.view, dist / (two.dist || 1), centred(two.mid.x, two.mid.y), shown, stageSize(), maxScale(natural(), shown))
      // Two fingers moving together drag the picture while they zoom it.
      set(clampView({ ...v, x: v.x + mid.x - two.mid.x, y: v.y + mid.y - two.mid.y }, shown, stageSize()))
      return
    }
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (view.current.s > 1 || p.pinched) {
      set(clampView({ ...p.view, x: p.view.x + dx, y: p.view.y + dy }, shownSize(), stageSize()))
      return
    }
    if (!p.axis && Math.hypot(dx, dy) > TAP_PX) p.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (p.axis === 'x') {
      // Past either end the picture drags heavily, and lets go back to where it was.
      const free = (dx < 0 && at < items.length - 1) || (dx > 0 && at > 0)
      paint({ ...ONE, x: free ? dx : dx * 0.3 })
    } else if (p.axis === 'y') {
      paint({ ...ONE, y: dy })
      if (shell.current && dy > 0) shell.current.style.background = `rgba(0,0,0,${Math.max(0.4, 1 - dy / 400)})`
    }
  }

  const onEnd = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!points.current.delete(e.pointerId)) return
    const left = Array.from(points.current.values())
    if (left.length === 1) {
      // One finger stays down after a pinch: it carries on panning from here.
      pinch.current = null
      press.current = { x: left[0].x, y: left[0].y, t: Date.now(), view: view.current, axis: null, pinched: true }
      return
    }
    if (left.length) return
    const p = press.current
    press.current = null
    pinch.current = null
    if (!p || cancelled) return set(view.current, true)
    if (p.pinched) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    const ms = Date.now() - p.t
    if (view.current.s > 1 && p.axis === null && Math.hypot(dx, dy) > TAP_PX) return
    if (p.axis === 'x') {
      const far = Math.abs(dx) > SWIPE_PX || (Math.abs(dx) > FLICK_PX && ms < FLICK_MS)
      const d = dx < 0 ? 1 : -1
      if (far && items[at + d]) return go(d)
      return set(ONE, true)
    }
    if (p.axis === 'y') return dy > CLOSE_PX ? onClose() : set(ONE, true)
    tap(e.clientX, e.clientY, e.pointerType === 'mouse')
  }

  const mediaStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'contain', display: 'block', transformOrigin: 'center', userSelect: 'none', WebkitUserSelect: 'none', willChange: 'transform' }
  const edge = (side: 'top' | 'bottom' | 'left' | 'right', px: number) => `calc(env(safe-area-inset-${side}, 0px) + ${px}px)`
  const arrow = (side: 'left' | 'right'): CSSProperties => ({ ...round, position: 'absolute', top: '50%', marginTop: -22, [side]: edge(side, 10) })

  return (
    <div
      ref={shell} data-artifact-viewer data-nospeak role="dialog" aria-modal="true" aria-label="Full screen view" tabIndex={-1}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: '#000', color: '#fff', outline: 'none', overscrollBehavior: 'contain', fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <div
        ref={stage} data-artifact-viewer-stage
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={(e) => onEnd(e, true)}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none' }}
      >
        {item.video ? (
          <video
            key={at} ref={media} src={item.src} aria-label={item.alt} autoPlay playsInline
            muted={!item.controls} loop={!item.controls} controls={item.controls}
            {...(item.controls ? { 'data-artifact-media': item.src.split(/[?#]/)[0].split('/').pop() } : {})}
            onLoadedMetadata={(e) => { if (item.controls) e.currentTarget.currentTime = (item.el as HTMLVideoElement).currentTime }}
            style={mediaStyle}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={at} ref={media} src={item.src} alt={item.alt} draggable={false} style={mediaStyle} />
        )}
      </div>
      {multiple ? (
        // Centred: a clip's own buttons hold the top left corner on iOS.
        <div style={{ position: 'absolute', top: edge('top', 22), left: 0, right: 0, textAlign: 'center', fontSize: 14, opacity: 0.85, pointerEvents: 'none' }}>{`${at + 1} of ${items.length}`}</div>
      ) : null}
      <button type="button" aria-label="Close" onClick={onClose} style={{ ...round, position: 'absolute', top: edge('top', 10), right: edge('right', 10) }}>
        <Icon d="M6 6l12 12M18 6L6 18" />
      </button>
      {items[at - 1] ? <button type="button" aria-label="Previous" onClick={() => go(-1)} style={arrow('left')}><Icon d="M15 5l-7 7 7 7" /></button> : null}
      {items[at + 1] ? <button type="button" aria-label="Next" onClick={() => go(1)} style={arrow('right')}><Icon d="M9 5l7 7-7 7" /></button> : null}
      {item.alt ? (
        // A clip's own controls hold the bottom of the screen, so its caption sits above them.
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: edge('bottom', item.controls ? 76 : 16), textAlign: 'center', fontSize: 14, lineHeight: 1.4, pointerEvents: 'none', textShadow: '0 1px 3px #000' }}>{item.alt}</div>
      ) : null}
    </div>
  )
}
