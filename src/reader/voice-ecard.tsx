'use client'
// The voice eCard, in the reader's browser: an envelope floating over a scene, opened by a hover on
// a desktop or a tap on a phone; the folded card rises out of it, slides so its spine lands mid
// screen while the cover swings open, and zooms to a spread whose inside-right page holds the
// letter, read along word by word to the sender's voice.
//
// PORTED FROM BlessOut's components/BlessingDetailPage.tsx (2026-07-16) with its geometry and
// phase timings (voice-ecard.ts) and its stylesheet (voice-ecard-css.ts), behaviour for behaviour:
// idle → rising (800) → opening (950) → zooming (700) → open → closing (450); the scene recedes and
// returns; the close medallion on the open card's corner; Esc closes; a portrait phone gets the tilt
// hint; the card art is warmed while the envelope idles; geometry re-lays out on every resize and
// rotation, again at 350 ms and 900 ms for iOS. The letter is BlessOut's KaraokeScript look on the
// package's own karaoke rules (readAlong → litWordIndex, begunCount), never a second copy.
//
// ADDED here: reduced motion fades instead of flying; the envelope opens from a keyboard; the
// sender's brand mark as a wax seal; a "Reply with your voice" control that opens the page's own
// comment card (NOTE_AT, so the recorder, the upload and the per-reader rules are the comment
// layer's); a play that reaches the last word tells the quiet view (LISTENED) so the send counts as
// listened; the letter shrinks to fit but never below readable, and scrolls past that.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CLOSE_MS, FADE_MS, WRAP_FRONT, cardBox, closeSpot, letterFromText, letterParagraphs, nextPhase, reachedLastWord, readAlong,
  spreadGeom, tiltHint, viewportSize, wordState, type Box, type VoiceEcardPhase, type VoiceEcardTiming,
} from '../artifacts/voice-ecard.js'
import { LISTENED, NOTE_AT } from './page-bridge.js'
import { VOICE_ECARD_CSS } from './voice-ecard-css.js'

export type VoiceEcardProps = {
  /** The id of the element the comment layer reads (the letter's block lives inside it). */
  rootId: string
  to: string
  from: string
  /** The letter as text, when it has no timings (and the envelope's peek either way). */
  letter: string
  words?: VoiceEcardTiming[]
  /** The envelope's paper and liner, and the letter's paper: CSS image values (url(...) or a gradient). */
  envelope: string
  liner: string
  paper: string
  cover?: string
  inner?: string
  background?: string
  cinemagraph?: string
  audio?: string
  /** The recording's stored name, as play tracking names it. */
  media?: string
  /** The foil colour (gold by default, the page's accent on `envelope: brand`) and the navy ink. */
  foil: string
  navy: string
  /** The letter's face and whether it is set in italic (every face but a script is). */
  face: string
  italic: boolean
  /** The face of the helper words over the flap. */
  title: string
  /** The sender's brand mark, drawn as a wax seal on the flap. */
  seal?: ReactNode
  /** Whether to draw "Made with Supersuit". */
  mark: boolean
  /** Whether the open card offers "Reply with your voice" (the page takes shared comments). */
  reply: boolean
  /** The block id the reply pins to: `b-<kind>-<8 hex>`. */
  blockId: string
  /** The date line under the letter. */
  dateLine?: string
}

const isTouch = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768)
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The smallest the letter is drawn before it scrolls instead: below this a phone reader squints. */
export const MIN_LETTER_ZOOM = 0.72

function PlayIcon() { return <svg viewBox="0 0 14 14" aria-hidden><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg> }
function StopIcon() { return <svg viewBox="0 0 14 14" aria-hidden><rect x="2.5" y="2.5" width="9" height="9" rx="1" fill="currentColor" /></svg> }
function MicIcon() { return <svg viewBox="0 0 14 14" aria-hidden><rect x="4.5" y="1" width="5" height="8" rx="2.5" fill="currentColor" /><path d="M2.5 6.5a4.5 4.5 0 0 0 9 0M7 11v2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg> }
function CloseIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg> }

export function VoiceEcard(p: VoiceEcardProps) {
  const [phase, setPhase] = useState<VoiceEcardPhase>('idle')
  const [from, setFrom] = useState<Box | null>(null)
  const [flown, setFlown] = useState(false)
  const [flap, setFlap] = useState(false)
  const [touch, setTouch] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [calm, setCalm] = useState(false)
  // Bumped on every resize and rotation so the open geometry re-lays out instead of going stale.
  const [tick, setTick] = useState(0)
  const letterRef = useRef<HTMLDivElement>(null)
  const envRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTouch(isTouch()); setCalm(reduced()) }, [])

  // Re-lay-out on rotation, toolbar show/hide and resize. iOS Safari fires these BEFORE its
  // viewport metrics update, so measure again once it settles (350 ms and 900 ms).
  useEffect(() => {
    let raf = 0
    let quiet: ReturnType<typeof setTimeout> | undefined
    const settles: ReturnType<typeof setTimeout>[] = []
    const bump = () => setTick((t) => t + 1)
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(bump)
      settles.splice(0).forEach(clearTimeout)
      settles.push(setTimeout(bump, 350), setTimeout(bump, 900))
      setTouch(isTouch())
      // The envelope hides while the window is being dragged, and comes back 150 ms after.
      setResizing(true)
      clearTimeout(quiet)
      quiet = setTimeout(() => setResizing(false), 150)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      settles.forEach(clearTimeout)
      clearTimeout(quiet)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [])

  // Warm the card art while the envelope idles, so the fold never opens over an unloaded image.
  useEffect(() => {
    for (const src of [p.cover, p.inner]) if (src) { const img = new window.Image(); img.src = src }
  }, [p.cover, p.inner])

  // The scene is the page: nothing scrolls behind it.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // While the card is out, the page menu's button steps aside for the close medallion.
  useEffect(() => {
    const el = document.documentElement
    if (phase === 'idle') el.removeAttribute('data-voice-ecard-open')
    else el.setAttribute('data-voice-ecard-open', phase)
    return () => el.removeAttribute('data-voice-ecard-open')
  }, [phase])

  // A tap outside the envelope closes its flap again.
  useEffect(() => {
    const away = (e: Event) => { if (envRef.current && !envRef.current.contains(e.target as Node)) setFlap(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('touchstart', away, { passive: true })
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away) }
  }, [])

  const open = useCallback(() => {
    if (phase !== 'idle') return
    const r = letterRef.current?.getBoundingClientRect()
    const box = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : { top: 0, left: 0, width: 1, height: 1 }
    setFrom(box)
    if (reduced() || !r) {
      // No flight: the open card fades in where it ends (the CSS fades it; BlessOut jumped).
      setFlown(true)
      setPhase('open')
      return
    }
    setFlown(false)
    setPhase('rising')
  }, [phase])
  const close = useCallback(() => setPhase((ph) => (ph === 'open' ? 'closing' : ph)), [])

  // The letter, or the flap over it: on a phone the first tap opens the flap and the second takes
  // the card out; with a mouse the hover already opened it.
  // Decided by the press itself, never by guessing the device: a finger's first tap opens the flap,
  // a mouse (whose hover already opened it) or a second tap takes the card out.
  const pointer = useRef<string>('mouse')
  const onPress = (e: React.PointerEvent) => { pointer.current = e.pointerType || 'mouse' }
  const onLetter = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (pointer.current === 'touch' && !flap) { setFlap(true); return }
    open()
  }

  // The timers between phases.
  useEffect(() => {
    if (phase === 'rising') {
      // One frame at the letter's box, then fly.
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setFlown(true)))
      const n = nextPhase('rising')!
      const t = setTimeout(() => setPhase(n.next), n.after)
      return () => { cancelAnimationFrame(raf); clearTimeout(t) }
    }
    if (phase === 'opening' || phase === 'zooming') {
      const n = nextPhase(phase)!
      const t = setTimeout(() => setPhase(n.next), n.after)
      return () => clearTimeout(t)
    }
    if (phase === 'closing') {
      const t = setTimeout(() => { setPhase('idle'); setFrom(null); setFlown(false); setFlap(false) }, calm ? FADE_MS : CLOSE_MS)
      return () => clearTimeout(t)
    }
  }, [phase, calm])

  // Esc closes the open card.
  useEffect(() => {
    if (phase !== 'open') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, close])

  const geom = useMemo(() => (typeof window === 'undefined' ? null : spreadGeom(viewportSize(window))), [tick, phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const flyer: CSSProperties | undefined = from && geom && phase !== 'idle' ? cardBox(phase, from, flown, geom) : undefined
  const foldOpen = phase === 'opening' || phase === 'zooming' || phase === 'open' || phase === 'closing'
  const pageBox: CSSProperties | undefined = phase === 'open' && geom ? { top: geom.pTop, left: geom.spineX, width: geom.pw, height: geom.ph } : undefined
  const closeBox: CSSProperties | undefined = phase === 'open' && geom ? closeSpot(geom) : undefined
  const tilt = phase === 'open' && typeof window !== 'undefined' && tiltHint(phase, viewportSize(window))

  const vars = {
    '--ve-env': p.envelope, '--ve-liner': p.liner, '--ve-paper': p.paper, '--ve-foil': p.foil, '--ve-navy': p.navy,
    '--ve-face': p.face, '--ve-face-style': p.italic ? 'italic' : 'normal', '--ve-title': p.title,
  } as CSSProperties
  const peek = p.words?.length ? p.words.map((w) => w.w).join(' ') : p.letter
  const helper = touch ? 'Tap me' : 'Hover over me'

  return (
    <div className="ve-root" data-voice-ecard data-phase={phase} style={vars}>
      <style dangerouslySetInnerHTML={{ __html: VOICE_ECARD_CSS }} />
      <div className="ve-bg" aria-hidden>
        {p.cinemagraph ? (
          <div className="ve-cinemagraph"><div className="ve-cinemagraph-inner">
            <iframe src={`https://media.flixel.com/cinemagraph/${p.cinemagraph}?hd=true`} allow="autoplay" tabIndex={-1} title="" style={{ pointerEvents: 'none' }} />
          </div></div>
        ) : p.background ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.background} alt="" draggable={false} />
        ) : null}
      </div>
      <div className="ve-night" aria-hidden />

      {phase !== 'idle' && flyer ? (
        <div aria-hidden className={`ve-card3d ${phase === 'rising' ? 've-rising' : phase === 'opening' ? 've-opening' : phase === 'zooming' || phase === 'open' ? 've-zooming' : 've-closing'}`} style={flyer}>
          <div className="ve-base" />
          <div className={`ve-fold${foldOpen ? ' is-open' : ''}`}>
            <div className="ve-front" style={p.cover ? { backgroundImage: `url(${JSON.stringify(p.cover)})`, ...WRAP_FRONT } : { backgroundImage: p.envelope, backgroundSize: 'cover' }}>
              {p.cover ? null : (
                <div className="ve-cover-fallback"><p><strong>To: {p.to}</strong></p><p><strong>From: {p.from}</strong></p></div>
              )}
            </div>
            <div className="ve-back" style={p.inner ? { backgroundImage: `url(${JSON.stringify(p.inner)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
          </div>
        </div>
      ) : null}

      {phase !== 'open' ? (
        <div className="ve-stage">
          <div className={`ve-hover${flap ? ' is-open' : ''}${phase === 'rising' || phase === 'opening' || phase === 'zooming' ? ' ve-receding' : ''}${phase === 'closing' ? ' ve-returning' : ''}${resizing ? ' ve-resizing' : ''}`}
            onPointerDownCapture={onPress} onClick={() => { if (pointer.current === 'touch') setFlap((f) => !f) }}>
            <div className="ve-container">
              <div className={`ve-li${flap ? ' is-open' : ''}`} ref={envRef} role="button" tabIndex={0}
                aria-label={`A card for ${p.to} from ${p.from}. Open it.`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}>
                <div className="ve-mail">
                  <div className="ve-env-back"><div className="ve-env-inner" /></div>
                  <div ref={letterRef} className="ve-letter" onClick={onLetter} style={{ visibility: phase !== 'idle' ? 'hidden' : undefined }}>
                    <p className="ve-to"><strong>To: {p.to}</strong></p>
                    <p className="ve-from"><strong>From: {p.from}</strong></p>
                    <p className="ve-preview">{peek.length > 500 ? `${peek.slice(0, 500)}...` : peek}</p>
                  </div>
                  <div className="ve-top-fold" onClick={onLetter}><span className="ve-hover-text">{helper}</span></div>
                  <div className="ve-top-fold-back" onClick={onLetter} />
                  <div className="ve-right-fold" onClick={onLetter} />
                  <div className="ve-left-fold" onClick={onLetter} />
                  {p.seal ? <div className="ve-seal" aria-hidden>{p.seal}</div> : null}
                </div>
              </div>
            </div>
          </div>
          {p.mark && phase === 'idle' ? <a className="ve-made" href="https://supersuit.co" target="_blank" rel="noopener">Made with Supersuit</a> : null}
        </div>
      ) : null}

      <div id={p.rootId} role={phase === 'open' ? 'dialog' : undefined} aria-modal={phase === 'open' ? true : undefined} aria-label={phase === 'open' ? `A card for ${p.to} from ${p.from}` : undefined}>
        {phase === 'open' && pageBox ? (
          <div className="ve-page-host" style={pageBox} data-voice-ecard-page>
            <Letter {...p} />
          </div>
        ) : null}
      </div>
      {phase === 'open' && closeBox ? (
        <button type="button" className="ve-close" style={closeBox} onClick={close} aria-label="Close card"><CloseIcon /></button>
      ) : null}
      {tilt ? (
        <div className="ve-tilt" aria-hidden><span className="ve-tilt-phone" />Tilt your phone to see the whole card</div>
      ) : null}
    </div>
  )
}

/** The inside-right page: who it is to and from, the voice, the letter following it, the reply. */
function Letter(p: VoiceEcardProps) {
  const audio = useRef<HTMLAudioElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const litRef = useRef<HTMLSpanElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(0)
  const heard = useRef(false)
  const words = p.words ?? []
  const paras = useMemo(() => (words.length ? letterParagraphs(words) : letterFromText(p.letter)), [words, p.letter])
  const at = readAlong(words, now, playing)

  // The frame clock, not timeupdate (four times a second is too coarse to land on a word).
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const t = audio.current?.currentTime ?? 0
      setNow(t)
      // Heard to the end: the play counts as listened, once for this opening.
      if (!heard.current && (words.length ? reachedLastWord(words, t) : false) && p.media) {
        heard.current = true
        window.dispatchEvent(new CustomEvent(LISTENED, { detail: { media: p.media } }))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, words, p.media])

  // Keep the lit word in the middle third without yanking the page around.
  useEffect(() => {
    const el = litRef.current
    const host = pageRef.current?.parentElement
    if (!playing || !el || !host || host.scrollHeight <= host.clientHeight + 1) return
    const r = el.getBoundingClientRect(), h = host.getBoundingClientRect()
    if (r.top < h.top + h.height / 3 || r.bottom > h.bottom - h.height / 3) el.scrollIntoView?.({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
  }, [at.lit, playing])

  // The letter fits its page: the largest zoom that fits, found by halving (zoom reflows text, so
  // one ratio overshoots), never below MIN_LETTER_ZOOM; past that the page scrolls.
  useEffect(() => {
    const el = pageRef.current
    const host = el?.parentElement
    if (!el || !host) return
    const style = el.style as CSSStyleDeclaration & { zoom: string }
    const fit = () => {
      const fits = (z: number) => { style.zoom = String(z); return el.scrollHeight * z <= host.clientHeight + 1 }
      if (fits(1)) return
      let lo = MIN_LETTER_ZOOM, hi = 1
      if (!fits(lo)) return
      for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
      style.zoom = String(lo)
    }
    fit()
    document.fonts?.ready?.then(fit).catch(() => {})
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    ro?.observe(host)
    return () => ro?.disconnect()
  }, [paras])

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (playing) { a.pause(); a.currentTime = 0; setPlaying(false); setNow(0); return }
    heard.current = false
    void a.play()?.catch?.(() => setPlaying(false))
    setPlaying(true)
  }
  const reply = () => {
    // The voice stops first, so the reader's microphone never records the sender's recording.
    if (playing) { audio.current?.pause(); setPlaying(false) }
    // The page's own comment card opens at this second of the recording, recorder and all.
    window.dispatchEvent(new CustomEvent(NOTE_AT, { detail: { block: p.blockId, at: Math.floor(audio.current?.currentTime ?? 0) } }))
  }

  return (
    <div ref={pageRef} className="ve-page" data-block={p.blockId} data-boxable>
      <div className="ve-frame" aria-hidden data-nospeak><i /><i /><i /><i /></div>
      <div className="ve-names" data-nospeak>
        <p><span>To:</span> <b>{p.to}</b></p>
        <p><span>From:</span> <b>{p.from}</b></p>
      </div>
      {p.audio || p.reply ? (
        <div className="ve-controls" data-nospeak data-comment-ui>
          {p.audio ? (
            <button type="button" className="ve-btn ve-listen" onClick={toggle} aria-pressed={playing}>
              {playing ? <><StopIcon /> Stop listening</> : <><PlayIcon /> Listen to the letter</>}
            </button>
          ) : null}
          {p.reply ? <button type="button" className="ve-btn ve-reply" onClick={reply} data-voice-reply><MicIcon /> Reply with your voice</button> : null}
        </div>
      ) : null}
      <blockquote className={`ve-script${playing && words.length ? ' ve-following' : ''}`} data-voice-ecard-letter>
        {paras.map((para, i) => (
          <p key={i} className="ve-para">
            {para.map(({ word, index }) => {
              const s = words.length ? wordState(index, at, playing) : null
              return (
                <span key={index} ref={index === at.lit ? litRef : undefined} className={`ve-word${s ? ` ve-${s}` : ''}`} data-word={index}>
                  {word}{' '}
                </span>
              )
            })}
          </p>
        ))}
      </blockquote>
      <div className="ve-foot" data-nospeak>
        <span>{p.dateLine ?? ''}</span>
        {p.mark ? <a href="https://supersuit.co" target="_blank" rel="noopener">Made with Supersuit</a> : null}
      </div>
      {p.audio ? (
        <audio ref={audio} src={p.audio} preload="metadata" data-artifact-media={p.media}
          onEnded={() => {
            setPlaying(false)
            // A recording with no timings counts as heard when it ends.
            if (!heard.current && !words.length && p.media) { heard.current = true; window.dispatchEvent(new CustomEvent(LISTENED, { detail: { media: p.media } })) }
          }} />
      ) : null}
    </div>
  )
}
