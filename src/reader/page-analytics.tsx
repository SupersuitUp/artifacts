'use client'
// The host's product analytics on a page: PostHog, with session replay, heatmaps, autocapture and
// scroll depth on leave, plus the reading this package knows about and PostHog cannot: which
// section was read and for how long, and the narration played, paused and finished.
//
// The server decides whether this mounts at all and as whom (analytics-plan.ts). posthog-js is
// imported only here, after mount, so a host with no key never downloads it.
//
// Text fields are masked in replays (PostHog's default). A gated page masks ALL text too, because
// its body is confidential and a replay is a copy of it held by a third party: the replay still
// shows where the reader went, how far and how fast, without the words.
import { useEffect } from 'react'
import type { AnalyticsPlan } from './analytics-plan.js'
import { currentSection } from '../artifacts/toc-spy.js'

/** Sections read for less than this are passed over, not read. */
export const MIN_SECTION_SECONDS = 2

type Capture = (event: string, props?: Record<string, unknown>) => void

/** Times the section being read, by the contents rail's own rule, and reports each one as the
 *  reader leaves it. Only visible time counts. Returns a stop function that flushes the last one. */
export function trackSections(ids: string[], capture: Capture, doc: Document = document, now: () => number = Date.now): { check: () => void; stop: () => void } {
  let current: string | undefined
  let since: number | null = null
  const visible = () => doc.visibilityState === 'visible'
  const flush = () => {
    if (!current || since === null) return
    const seconds = Math.round((now() - since) / 1000)
    if (seconds >= MIN_SECTION_SECONDS) {
      const heading = doc.getElementById(current)?.textContent?.trim() ?? ''
      capture('section_viewed', { section_id: current, heading, seconds })
    }
    since = null
  }
  const check = () => {
    if (!visible()) { flush(); return }
    const next = currentSection(ids, doc)
    if (next !== current) { flush(); current = next }
    if (since === null) since = now()
  }
  return { check, stop: flush }
}

/** The narration's events: play, pause with where it stopped, complete. */
export function narrationEvent(type: string, audio: { currentTime: number; duration: number; ended?: boolean }): [string, Record<string, unknown>] | null {
  const at = { position_seconds: Math.round(audio.currentTime), duration_seconds: Number.isFinite(audio.duration) ? Math.round(audio.duration) : null }
  if (type === 'play') return ['narration_play', at]
  if (type === 'pause' && !audio.ended) return ['narration_pause', at]
  if (type === 'ended') return ['narration_complete', at]
  return null
}

export function PageAnalytics({ plan, rootId = 'artifact-narration-root' }: { plan: AnalyticsPlan; rootId?: string }) {
  const { key, host, pageId, kind, tenant } = plan
  const identity = plan.identity ? JSON.stringify(plan.identity) : ''
  useEffect(() => {
    let cancelled = false
    let cleanup = () => {}
    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return
      posthog.init(key, {
        api_host: host,
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        enable_heatmaps: true,
        disable_session_recording: false,
        session_recording: { maskAllInputs: true, ...(kind === 'gated' ? { maskTextSelector: '*' } : {}) },
      })
      posthog.register({ artifact_id: pageId, page_kind: kind, ...(tenant ? { tenant } : {}) })
      if (identity) {
        const who = JSON.parse(identity) as NonNullable<AnalyticsPlan['identity']>
        posthog.identify(who.distinctId, { ...(who.email ? { email: who.email } : {}), ...(who.name ? { name: who.name } : {}) })
      }
      const capture: Capture = (e, p) => posthog.capture(e, p)

      const root = document.getElementById(rootId)
      const ids = root ? Array.from(root.querySelectorAll<HTMLElement>('h2[id], h3[id]'), (h) => h.id) : []
      const sections = ids.length ? trackSections(ids, capture) : null
      let frame = 0
      const onScroll = () => { if (sections && !frame) frame = requestAnimationFrame(() => { frame = 0; sections.check() }) }
      const onVisibility = () => sections?.check()
      const onHide = () => sections?.stop()
      const onMedia = (e: Event) => {
        const el = e.target as HTMLAudioElement | null
        if (!el?.hasAttribute?.('data-artifact-narration')) return
        const ev = narrationEvent(e.type, el)
        if (ev) capture(...ev)
      }
      sections?.check()
      window.addEventListener('scroll', onScroll, { passive: true })
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', onHide)
      for (const t of ['play', 'pause', 'ended']) document.addEventListener(t, onMedia, true)
      cleanup = () => {
        sections?.stop()
        if (frame) cancelAnimationFrame(frame)
        window.removeEventListener('scroll', onScroll)
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pagehide', onHide)
        for (const t of ['play', 'pause', 'ended']) document.removeEventListener(t, onMedia, true)
      }
    }).catch(() => { /* analytics never costs a reader their page */ })
    return () => { cancelled = true; cleanup() }
  }, [key, host, pageId, kind, tenant, identity, rootId])
  return null
}
