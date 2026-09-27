'use client'

// The page's history, opened from the "Version N" line under the summary. The list renders
// through a portal on document.body, OUTSIDE the text flow, like the definition layer, so opening
// it cannot reflow a word of the page: on a phone it is a sheet pinned to the bottom, above the
// narration bar; on a desk it is a panel pinned to the right of the window. Escape, the close
// button, or a tap outside closes it.
//
// It exists so an author never hand-writes a "Version history" section at the end of the
// markdown again (2026-09-27): the store already keeps every version, and each one carries
// the one-line note it was published with.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatUpdated } from '../artifacts/updated-at.js'

export type HistoryItem = { version: number; at: string; note?: string; current?: boolean }

const PHONE = '(max-width: 639px)'
const MARGIN = 16
const VARS = ['--a-ground', '--a-ink', '--a-accent', '--a-line'] as const

export function VersionHistory({ items, base, viewing }: {
  /** Newest first, current included. */
  items: HistoryItem[]
  /** The current page's path, e.g. "/abc23456"; a past version lives at `${base}/v/<n>`. */
  base: string
  /** The version this page shows. */
  viewing: number
}) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const [bottom, setBottom] = useState(MARGIN)
  const [vars, setVars] = useState<Record<string, string>>({})
  const [zone, setZone] = useState('UTC')
  const button = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  const measure = useCallback(() => {
    const el = button.current
    if (!el) return
    const cs = getComputedStyle(el)
    setVars({ ...Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim()]).filter(([, x]) => x)), fontFamily: cs.fontFamily })
    const isPhone = window.matchMedia ? window.matchMedia(PHONE).matches : window.innerWidth < 640
    setPhone(isPhone)
    const bar = document.querySelector('[data-artifact-player]')?.getBoundingClientRect()
    setBottom((bar && bar.top < window.innerHeight ? window.innerHeight - bar.top : 0) + MARGIN)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    button.current?.focus()
  }, [])

  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])

  useEffect(() => {
    if (!open) return
    measure()
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || button.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure, close])

  const style: CSSProperties = {
    ...(vars as CSSProperties),
    zIndex: 60,
    boxSizing: 'border-box',
    borderRadius: 12,
    background: 'var(--a-ground, #fff)',
    color: 'var(--a-ink, #111)',
    border: '1px solid var(--a-line, rgba(127,127,127,0.3))',
    boxShadow: '0 16px 40px rgba(0,0,0,0.3)',
    fontSize: 15,
    lineHeight: 1.45,
    fontStyle: 'normal',
    textAlign: 'left',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    outline: 'none',
    ...(phone
      ? { position: 'fixed', left: MARGIN, right: MARGIN, bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))`, maxHeight: '65vh' }
      : { position: 'fixed', top: 80, right: 24, width: 380, maxHeight: 'calc(100vh - 120px)' }),
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        data-version-history
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ font: 'inherit', color: 'inherit', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '0.2em' }}
      >
        History
      </button>
      {/* The list is also in the server markup, hidden, so the notes are there before any script
          runs and a reader with scripts off can still find every version. */}
      <span hidden data-version-list>
        {items.map((v) => (
          <a key={v.version} href={v.current ? base : `${base}/v/${v.version}`}>
            {`Version ${v.version}${v.note ? `: ${v.note}` : ''}`}
          </a>
        ))}
      </span>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div ref={panel} data-version-panel role="dialog" aria-label="Version history" tabIndex={-1} style={style}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 8px' }}>
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.6 }}>
                  Version history
                </span>
                <button type="button" aria-label="Close" onClick={close}
                  style={{ font: 'inherit', fontSize: 20, lineHeight: 1, color: 'inherit', background: 'none', border: 0, padding: 4, cursor: 'pointer', opacity: 0.6 }}>
                  ×
                </button>
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: '0 8px 10px' }}>
                {items.map((v) => {
                  const here = v.version === viewing
                  return (
                    <li key={v.version}>
                      <a
                        href={v.current ? base : `${base}/v/${v.version}`}
                        aria-current={here ? 'page' : undefined}
                        style={{
                          display: 'block', padding: '10px 10px', borderRadius: 8, color: 'inherit', textDecoration: 'none',
                          background: here ? 'color-mix(in srgb, var(--a-accent, #888) 14%, transparent)' : undefined,
                        }}
                      >
                        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <strong style={{ fontWeight: 600 }}>{`Version ${v.version}`}</strong>
                          {v.current ? <span style={{ fontSize: 12, color: 'var(--a-accent)' }}>current</span> : null}
                          <time dateTime={v.at} style={{ fontSize: 12, opacity: 0.6 }}>{formatUpdated(v.at, zone)}</time>
                        </span>
                        {v.note ? <span style={{ display: 'block', marginTop: 2, fontSize: 14, opacity: 0.85 }}>{v.note}</span> : null}
                      </a>
                    </li>
                  )
                })}
              </ol>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
