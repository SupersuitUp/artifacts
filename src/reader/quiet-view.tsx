'use client'
// The page's own word that a person looked at it. Silent: it renders nothing and never tells the
// reader (the publisher chose that). It waits until the page is actually on screen for two
// seconds, which a link preview fetcher never does because it never runs the page.
import { useEffect } from 'react'

const VIEW_AFTER_MS = 2000
const BEAT_MS = 15_000
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789'
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHA[b % 36]).join('')

function deviceId(): string {
  try {
    let d = localStorage.getItem('artifact_device')
    if (!d || !/^[a-z0-9]{16}$/.test(d)) { d = rand(16); localStorage.setItem('artifact_device', d) }
    return d
  } catch { return rand(16) }
}

export function QuietView({ id, rid, sig, token, endpoint }: { id: string; rid: string; sig: string; token: string; endpoint?: string }) {
  useEffect(() => {
    const url = endpoint ?? `/api/artifacts/${id}/seen`
    const session = rand(16)
    const device = deviceId()
    const base = { rid, sig, session, device }
    let beat: string | null = null
    let viewSent = false
    let wait: ReturnType<typeof setTimeout> | null = null
    let tick: ReturnType<typeof setInterval> | null = null
    let since = 0
    const post = async (body: Record<string, unknown>) => {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, ...body }), keepalive: true })
        return r.ok ? ((await r.json().catch(() => ({}))) as { beat?: string }) : null
      } catch { return null }
    }
    const visible = () => document.visibilityState === 'visible' && !(document as Document & { prerendering?: boolean }).prerendering
    const flush = (useBeacon: boolean) => {
      if (!beat || !since) return
      const seconds = Math.round((Date.now() - since) / 1000)
      since = 0
      if (seconds <= 0) return
      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url, new Blob([JSON.stringify({ ...base, event: 'beat', beat, seconds })], { type: 'application/json' }))
      } else void post({ event: 'beat', beat, seconds })
    }
    const startBeats = () => {
      since = Date.now()
      tick = setInterval(() => { flush(false); since = Date.now() }, BEAT_MS)
    }
    const arm = () => {
      if (!visible()) return
      if (beat) { if (!tick) startBeats(); return }
      // One render token, one view: once it is sent, a later show never sends another.
      if (viewSent || wait) return
      wait = setTimeout(async () => {
        wait = null
        if (!visible()) return
        viewSent = true
        const r = await post({ event: 'view', token })
        if (r?.beat && visible()) { beat = r.beat; startBeats() } else if (r?.beat) beat = r.beat
      }, VIEW_AFTER_MS)
    }
    const disarm = () => {
      if (wait) { clearTimeout(wait); wait = null }
      if (tick) { clearInterval(tick); tick = null; flush(true) }
    }
    const onVisibility = () => (visible() ? arm() : disarm())
    const onPlay = (e: Event) => {
      const el = e.target as HTMLElement | null
      const media = el?.getAttribute?.('data-artifact-media')
      if (media && beat) void post({ event: 'play', beat, media })
    }
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('prerenderingchange', onVisibility)
    document.addEventListener('play', onPlay, true)
    window.addEventListener('pagehide', disarm)
    arm()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('prerenderingchange', onVisibility)
      document.removeEventListener('play', onPlay, true)
      window.removeEventListener('pagehide', disarm)
      disarm()
    }
  }, [id, rid, sig, token, endpoint])
  return null
}
