'use client'

// Opens a defined term's definition. ONE controller per page, listening on the document, so the
// terms themselves stay plain server-rendered spans: nothing in a paragraph is a React island that
// could re-render under the read-along's word spans, and nothing in a paragraph opens or closes.
//
// The definition renders through a portal on document.body, OUTSIDE the text flow, so opening it
// cannot reflow the page (earned 2026-09-27 on a sibling site: a definition toggled as
// a child of the word re-ran the paragraph's line breaking). On a phone it is a sheet pinned to
// the bottom, above the narration bar; on a desk it sits under the word, clamped in the window.
// Mouse hover shows it; a click, a tap, Enter or Space pins it; Escape or a tap elsewhere closes.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

const WIDTH = 320
const GAP = 10
const MARGIN = 16
const PHONE = '(max-width: 639px)'
// The theme lives on a wrapper, not on body, so the portal carries the values it needs.
const VARS = ['--a-ground', '--a-ink', '--a-accent'] as const

type Open = { el: HTMLElement; term: string; text: string; href?: string; pinned: boolean }
type Place = { phone: true; bottom: number } | { phone: false; top: number; left: number; width: number }

function openFor(el: HTMLElement, pinned: boolean): Open | null {
  const note = document.getElementById(el.getAttribute('aria-describedby') ?? '')
  const text = note?.dataset.definition
  if (!text) return null
  return { el, term: el.dataset.definedTerm ?? el.textContent ?? '', text, href: note?.dataset.href, pinned }
}

export function DefinitionLayer() {
  const [open, setOpen] = useState<Open | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [vars, setVars] = useState<Record<string, string>>({})
  const sheet = useRef<HTMLDivElement | null>(null)
  const openRef = useRef<Open | null>(null)
  openRef.current = open

  const show = useCallback((next: Open | null) => {
    const prev = openRef.current
    if (prev && prev.el !== next?.el) prev.el.setAttribute('aria-expanded', 'false')
    if (next) next.el.setAttribute('aria-expanded', next.pinned ? 'true' : 'false')
    openRef.current = next
    setOpen(next)
  }, [])

  const measure = useCallback(() => {
    const o = openRef.current
    if (!o) return setPlace(null)
    const cs = getComputedStyle(o.el)
    // The body font is not always the page's: the brand sets it on a wrapper, so carry it too.
    setVars({ ...Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim()]).filter(([, x]) => x)), fontFamily: cs.fontFamily })
    if (window.matchMedia ? window.matchMedia(PHONE).matches : window.innerWidth < 640) {
      const bar = document.querySelector('[data-artifact-player]')?.getBoundingClientRect()
      const clear = bar && bar.top < window.innerHeight ? window.innerHeight - bar.top : 0
      return setPlace({ phone: true, bottom: clear + MARGIN })
    }
    const rects = o.el.getClientRects()
    const r = rects.length ? rects[rects.length - 1] : o.el.getBoundingClientRect()
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN)
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN)
    setPlace({ phone: false, top: r.bottom + window.scrollY + GAP, left: left + window.scrollX, width })
  }, [])

  useEffect(() => {
    const termOf = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-defined-term]') as HTMLElement | null) : null)
    const toggle = (el: HTMLElement) => {
      const cur = openRef.current
      show(cur && cur.el === el && cur.pinned ? null : openFor(el, true))
    }
    const onClick = (e: MouseEvent) => {
      const el = termOf(e.target)
      if (el) toggle(el)
    }
    const onDown = (e: PointerEvent) => {
      const cur = openRef.current
      if (!cur?.pinned) return
      const t = e.target as Node
      if (termOf(t) === cur.el || sheet.current?.contains(t)) return
      show(null)
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || openRef.current?.pinned) return
      const el = termOf(e.target)
      if (el && openRef.current?.el !== el) show(openFor(el, false))
    }
    const onOut = (e: PointerEvent) => {
      const cur = openRef.current
      if (e.pointerType !== 'mouse' || !cur || cur.pinned) return
      if (termOf(e.target) === cur.el && termOf(e.relatedTarget) !== cur.el) show(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        const el = openRef.current.el
        show(null)
        el.focus?.()
        return
      }
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = termOf(e.target)
      if (!el) return
      e.preventDefault()
      toggle(el)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('keydown', onKey)
    }
  }, [show])

  useEffect(() => {
    measure()
    if (!open) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, measure])

  if (!open || !place) return null
  const style: CSSProperties = {
    ...(vars as CSSProperties),
    zIndex: 60,
    boxSizing: 'border-box',
    borderRadius: 10,
    padding: '12px 16px',
    background: 'var(--a-ink, #111)',
    color: 'var(--a-ground, #fff)',
    fontSize: 15,
    lineHeight: 1.45,
    fontStyle: 'normal',
    fontWeight: 400,
    letterSpacing: 'normal',
    textAlign: 'left',
    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
    pointerEvents: open.pinned ? 'auto' : 'none',
    ...(place.phone
      ? { position: 'fixed', left: MARGIN, right: MARGIN, bottom: `calc(${place.bottom}px + env(safe-area-inset-bottom, 0px))` }
      : { position: 'absolute', top: place.top, left: place.left, width: place.width }),
  }
  return createPortal(
    <div ref={sheet} data-definition-sheet role="note" aria-hidden={open.href ? undefined : true} style={style}>
      <span style={{ display: 'block', marginBottom: 4, fontSize: 11, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.6 }}>
        {open.term}
      </span>
      {open.text}
      {open.href ? (
        <a
          href={open.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', marginTop: 8, fontSize: 13, color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '0.2em', opacity: 0.85 }}
        >
          Read more
        </a>
      ) : null}
    </div>,
    document.body,
  )
}
