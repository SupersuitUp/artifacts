'use client'
// What a gated page does in the reader's browser: count how long they actually read, how far
// they got, and catch the moves that take the page away from here (save, print, a large copy,
// saving an image, opening the inspector). Each of those is stopped where a browser lets a page
// stop it, told to the reader in a line, and recorded under their name.
//
// HONEST LIMITS. A screenshot, a phone camera, or a reader who disables scripts cannot be seen
// by any web page. That is what the banner and the watermark are for: they make every copy
// carry the name of the person it was shown to.
import { useEffect, useRef, useState } from 'react'

const BEAT_MS = 15_000
/** A reader idle this long stops earning time, so a tab left open overnight is not "reading". */
const IDLE_MS = 60_000
/** Quoting a sentence is fine; lifting a section is not. */
export const COPY_LIMIT = 280

type Flag = 'save' | 'print' | 'copy' | 'image' | 'devtools'

export function ReaderWatch({ artifactId, endpoint, accent }: { artifactId: string; endpoint: string; accent: string }) {
  const [notice, setNotice] = useState<string | null>(null)
  const state = useRef({ session: '', lastActive: Date.now(), maxScroll: 0, pending: 0, lastBeat: Date.now() })

  useEffect(() => {
    const s = state.current
    s.session = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '')
    const send = (body: Record<string, unknown>, beacon = false) => {
      const payload = JSON.stringify({ id: artifactId, session: s.session, ...body })
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }))
        return
      }
      fetch(endpoint, { method: 'POST', body: payload, headers: { 'content-type': 'application/json' }, keepalive: true, credentials: 'same-origin' }).catch(() => {})
    }
    const scroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight
      const pct = h <= 0 ? 100 : Math.min(100, Math.round((window.scrollY / h) * 100))
      s.maxScroll = Math.max(s.maxScroll, pct)
    }
    const active = () => { s.lastActive = Date.now() }
    // Seconds actually read since the last beat: visible, and touched within the idle window.
    const accrue = () => {
      const now = Date.now()
      if (document.visibilityState === 'visible' && now - s.lastActive < IDLE_MS) s.pending += (now - s.lastBeat) / 1000
      s.lastBeat = now
    }
    const beat = (beacon = false) => {
      accrue()
      const add = Math.min(60, Math.round(s.pending))
      s.pending -= add
      send({ kind: 'beat', active: add, scroll: s.maxScroll }, beacon)
    }
    const flag = (kind: Flag, detail?: string, message?: string) => {
      send({ kind: 'flag', flag: kind, ...(detail ? { detail } : {}) })
      if (message) {
        setNotice(message)
        window.setTimeout(() => setNotice(null), 6000)
      }
    }

    scroll()
    send({ kind: 'beat', active: 0, scroll: s.maxScroll })
    const timer = window.setInterval(() => beat(), BEAT_MS)

    const onVisibility = () => { if (document.visibilityState === 'hidden') beat(true); else s.lastBeat = Date.now() }
    const onHide = () => beat(true)
    const onKey = (e: KeyboardEvent) => {
      active()
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 's') { e.preventDefault(); flag('save', 'keyboard', 'Saving is turned off for this page, and the attempt was recorded.') }
      else if (mod && k === 'p') { e.preventDefault(); flag('print', 'keyboard', 'Printing is turned off for this page, and the attempt was recorded.') }
      else if (e.key === 'F12' || (mod && e.altKey && k === 'i') || (mod && e.shiftKey && (k === 'i' || k === 'c'))) flag('devtools', 'keyboard')
    }
    const onBeforePrint = () => flag('print', 'menu', 'Printing is turned off for this page, and the attempt was recorded.')
    const onCopy = (e: ClipboardEvent) => {
      const text = String(window.getSelection() ?? '')
      if (text.length <= COPY_LIMIT) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', 'This passage is confidential and was not copied.')
      flag('copy', `${text.length} characters`, 'Copying more than a sentence or two is turned off for this page, and the attempt was recorded.')
    }
    const onContext = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('img')) { e.preventDefault(); flag('image', 'right-click', 'Saving images is turned off for this page, and the attempt was recorded.') }
    }
    const onDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('img')) { e.preventDefault(); flag('image', 'drag') }
    }

    window.addEventListener('scroll', () => { scroll(); active() }, { passive: true })
    for (const ev of ['mousemove', 'pointerdown', 'touchstart', 'wheel'] as const) window.addEventListener(ev, active, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeprint', onBeforePrint)
    document.addEventListener('copy', onCopy)
    document.addEventListener('contextmenu', onContext)
    document.addEventListener('dragstart', onDrag)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeprint', onBeforePrint)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('contextmenu', onContext)
      document.removeEventListener('dragstart', onDrag)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      for (const ev of ['mousemove', 'pointerdown', 'touchstart', 'wheel'] as const) window.removeEventListener(ev, active)
    }
  }, [artifactId, endpoint])

  return notice ? (
    <div
      role="status"
      data-nospeak
      className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[90vw] rounded-lg px-4 py-3 text-sm shadow-lg"
      style={{ background: '#111', color: '#fff', border: `1px solid ${accent}` }}
    >
      {notice}
    </div>
  ) : null
}
