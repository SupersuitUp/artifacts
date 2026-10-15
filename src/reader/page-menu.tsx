'use client'
// The page menu: one small round "⋯" button fixed in the top right of every artifact page, the
// same on every page and every host. Tapping it opens a short menu whose first line says who the
// reader is to this page ("Signed in as Robin · admin of this hub"), and whose items depend on
// that role. Items a role cannot use are absent, never greyed out.
//
// Release 1 (0.30.0): Share, Show / Hide comments, Sign in / Sign out, Version history and Copy
// the markdown. Release 2 (0.31.0): Share settings and Comment settings for the owner and the
// hub's admins, each opening a sheet (settings-sheet.tsx) that changes the page without a republish. The server decides every item (routes/artifacts.tsx) and passes only what this
// reader may have: the markdown source and the history list never reach a reader who may not use
// them, so nothing here has to hide anything.
//
// Rendered as a hidden marker on the server and on the first client render, so the markup always
// hydrates; after mount the button and its menu are portalled onto document.body carrying the
// page's theme variables, like the comment layer, so nothing on the page can paint over them. On
// a phone the menu is a sheet from the bottom; on a desk a popover under the button. A tap
// outside, Escape, or choosing an item closes it.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { themeVarsAround } from './theme-vars.js'
import { HistoryPanel, VersionList, type HistoryItem } from './version-history.js'
import { PINS_STATE, requestPins, signInBack } from './page-bridge.js'
import { REOPEN_KEY, SettingsSheet, type PageSettings, type SheetKind } from './settings-sheet.js'

export type PageRole = 'visitor' | 'reader' | 'owner' | 'admin'

export type PageMenuProps = {
  role: PageRole
  /** What to call the reader in the role line: a first name, else their email. Null signed out. */
  name: string | null
  /** The page is gated and this reader is not let in (they see its door). */
  shutOut?: boolean
  /** The link to share, or null when this reader cannot share this page. `note` sits under it. */
  share: { url: string; title: string; note?: string } | null
  /** Shared comments are on here, so the pins can be shown or hidden. */
  comments: boolean
  /** The sign-in authority's link for this page, when signed out on a host that signs readers in. */
  signIn: string | null
  /** This host's sign-out link, when signed in. */
  signOut: string | null
  /** The owner's or an admin's link to this page as a reader sees it (`?as=reader`). Null for anyone else. */
  viewAsReader?: string | null
  /** Every version, when this reader may see past versions and there is more than one. */
  history: { items: HistoryItem[]; base: string; viewing: number } | null
  /** The published source, for the owner and admins only. */
  markdown: string | null
  /** The page's share and comment settings, for the owner and admins only; null for everyone
   *  else, so nobody else's page carries the list or the key. */
  settings?: PageSettings | null
}

/** The menu's first line: who this reader is to this page. */
export function roleLine(role: PageRole, name: string | null, shutOut = false): string {
  if (role === 'visitor' || !name) return 'Not signed in'
  if (role === 'admin') return `Signed in as ${name} · admin of this hub`
  if (role === 'owner') return `Signed in as ${name} · owner of this page`
  return shutOut ? `Signed in as ${name} · not on this page's list` : `Signed in as ${name}`
}

/** The items this reader gets, in order. Exported so the server markup and tests can name them. */
export function menuItems(p: Pick<PageMenuProps, 'share' | 'comments' | 'signIn' | 'signOut' | 'history' | 'markdown' | 'settings' | 'viewAsReader'>): string[] {
  return [
    p.share ? 'share' : null,
    p.comments ? 'comments' : null,
    p.settings ? 'share-settings' : null,
    p.settings && p.settings.comments !== null ? 'comment-settings' : null,
    p.history ? 'history' : null,
    p.markdown !== null ? 'markdown' : null,
    p.viewAsReader ? 'view-as-reader' : null,
    p.signOut ? 'sign-out' : p.signIn ? 'sign-in' : null,
  ].filter((x): x is string => !!x)
}

const PHONE = '(max-width: 639px)'
const isPhone = () => (typeof window.matchMedia === 'function' ? window.matchMedia(PHONE).matches : window.innerWidth < 640)
const coarse = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/** Copy text, by the clipboard API where it exists, else the old textarea way. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      // Bounded: a browser waiting on a permission it never asks for leaves the promise pending
      // (seen in headless Chrome), and the reader would get no answer at all.
      const done = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1200)),
      ])
      if (done) return true
    }
  } catch { /* fall through */ }
  try {
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand?.('copy') ?? false
    t.remove()
    return ok
  } catch { return false }
}

export function PageMenu(props: PageMenuProps) {
  const { role, name, shutOut, share, comments, signIn, signOut, history, markdown, settings, viewAsReader } = props
  const items = menuItems(props)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const [vars, setVars] = useState<Record<string, string>>({})
  const [pins, setPins] = useState(true)
  const [said, setSaid] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sheet, setSheet] = useState<{ kind: SheetKind; saved: boolean } | null>(null)
  const marker = useRef<HTMLSpanElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVars(themeVarsAround(marker.current))
    setMounted(true)
    const onPins = (e: Event) => setPins((e as CustomEvent<boolean>).detail === true)
    window.addEventListener(PINS_STATE, onPins)
    // A settings save reloads the page; open the sheet it came from again, saying it saved.
    if (settings) {
      try {
        const kind = window.sessionStorage.getItem(REOPEN_KEY)
        window.sessionStorage.removeItem(REOPEN_KEY)
        if (kind === 'share' || kind === 'comments') { setPhone(isPhone()); setSheet({ kind, saved: true }) }
      } catch { /* no storage: the page itself shows what changed */ }
    }
    return () => window.removeEventListener(PINS_STATE, onPins)
  }, [])

  const close = useCallback((focus = true) => {
    setOpen(false)
    setSaid(null)
    if (focus) button.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    setPhone(isPhone())
    setVars(themeVarsAround(marker.current))
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (menu.current?.contains(t) || button.current?.contains(t)) return
      close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, close])

  const onShare = async () => {
    if (!share) return
    // A phone hands the link to its own share sheet (Messages, Mail, AirDrop); a desk copies it.
    if (coarse() && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: share.title, url: share.url })
        close()
        return
      } catch (e) {
        // The reader backed out of the sheet: leave the menu as it was. Any other refusal (no
        // permission, an unsupported page) falls through to copying, so Share always answers.
        if ((e as { name?: string })?.name === 'AbortError') return
      }
    }
    setSaid((await copyText(share.url)) ? 'Link copied' : 'Could not copy the link')
  }
  const onMarkdown = async () => {
    if (markdown === null) return
    setSaid((await copyText(markdown)) ? 'Markdown copied' : 'Could not copy the markdown')
  }
  const onPins = () => {
    requestPins(!pins)
    setPins(!pins)
    close()
  }
  const onSheet = (kind: SheetKind) => {
    setOpen(false)
    setSheet({ kind, saved: false })
  }
  const onHistory = () => {
    setOpen(false)
    setHistoryOpen(true)
  }

  const line = roleLine(role, name, shutOut)
  const itemStyle: CSSProperties = {
    display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'left', font: 'inherit', fontSize: phone ? 16 : 14,
    color: 'inherit', background: 'none', border: 0, borderRadius: 8, padding: phone ? '12px 12px' : '8px 10px',
    cursor: 'pointer', textDecoration: 'none', lineHeight: 1.3,
  }
  const sub: CSSProperties = { display: 'block', marginTop: 2, fontSize: 12, opacity: 0.6 }

  const panelStyle: CSSProperties = {
    ...(vars as CSSProperties),
    position: 'fixed', zIndex: 60, boxSizing: 'border-box', background: 'var(--a-surface, var(--a-ground, #fff))', color: 'var(--a-strong, var(--a-ink, #111))',
    border: '1px solid var(--a-line, rgba(127,127,127,0.3))', boxShadow: '0 12px 32px rgba(0,0,0,0.22)', fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontStyle: 'normal', fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', outline: 'none',
    ...(phone
      ? { left: 8, right: 8, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', borderRadius: 16, padding: '6px 6px 8px', maxHeight: '70vh', overflowY: 'auto' }
      : { top: 'calc(env(safe-area-inset-top, 0px) + 56px)', right: 12, width: 264, borderRadius: 12, padding: 6 }),
  }

  const ui = mounted ? (
    <div data-page-menu-ui data-nospeak data-comment-ui style={vars as CSSProperties}>
      <button
        ref={button}
        type="button"
        data-page-menu-button
        aria-label="Page menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : (setSaid(null), setOpen(true)))}
        style={{
          position: 'fixed', zIndex: 45, top: 'calc(env(safe-area-inset-top, 0px) + 12px)', right: 12, width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, margin: 0, borderRadius: 999, cursor: 'pointer',
          color: 'var(--a-ink, #111)', background: 'color-mix(in srgb, var(--a-ground, #fff) 82%, transparent)',
          border: '1px solid var(--a-line, rgba(127,127,127,0.3))', boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
          <circle cx="3.5" cy="9" r="1.6" fill="currentColor" />
          <circle cx="9" cy="9" r="1.6" fill="currentColor" />
          <circle cx="14.5" cy="9" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open && phone ? <div aria-hidden data-page-menu-scrim style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(0,0,0,0.28)' }} /> : null}
      {open ? (
        <div ref={menu} data-page-menu role="menu" aria-label="Page menu" style={panelStyle}>
          <p data-page-menu-role style={{ margin: 0, padding: phone ? '10px 12px 8px' : '8px 10px 6px', fontSize: 12, lineHeight: 1.35, opacity: 0.7, overflowWrap: 'anywhere' }}>
            {line}
          </p>
          {items.length ? <div aria-hidden style={{ height: 1, margin: '0 6px 4px', background: 'var(--a-line, rgba(127,127,127,0.3))' }} /> : null}
          {share ? (
            <button type="button" role="menuitem" data-page-menu-item="share" onClick={() => void onShare()} style={itemStyle}>
              {said === 'Link copied' || said === 'Could not copy the link' ? said : 'Share'}
              {share.note ? <span data-page-menu-note style={sub}>{share.note}</span> : null}
            </button>
          ) : null}
          {comments ? (
            <button type="button" role="menuitem" data-page-menu-item="comments" onClick={onPins} style={itemStyle}>
              {pins ? 'Hide comments' : 'Show comments'}
            </button>
          ) : null}
          {settings ? (
            <button type="button" role="menuitem" data-page-menu-item="share-settings" aria-haspopup="dialog" onClick={() => onSheet('share')} style={itemStyle}>
              Share settings
            </button>
          ) : null}
          {settings && settings.comments !== null ? (
            <button type="button" role="menuitem" data-page-menu-item="comment-settings" aria-haspopup="dialog" onClick={() => onSheet('comments')} style={itemStyle}>
              Comment settings
            </button>
          ) : null}
          {history ? (
            <button type="button" role="menuitem" data-page-menu-item="history" aria-haspopup="dialog" onClick={onHistory} style={itemStyle}>
              Version history
            </button>
          ) : null}
          {markdown !== null ? (
            <button type="button" role="menuitem" data-page-menu-item="markdown" onClick={() => void onMarkdown()} style={itemStyle}>
              {said === 'Markdown copied' || said === 'Could not copy the markdown' ? said : 'Copy the markdown'}
            </button>
          ) : null}
          {viewAsReader ? (
            <a role="menuitem" data-page-menu-item="view-as-reader" href={viewAsReader} style={itemStyle}>View as a reader</a>
          ) : null}
          {signOut ? (
            <a role="menuitem" data-page-menu-item="sign-out" href={signOut} style={itemStyle}>Sign out</a>
          ) : signIn ? (
            <a role="menuitem" data-page-menu-item="sign-in" href={signIn} onClick={(e) => { e.currentTarget.href = signInBack(signIn) }} style={itemStyle}>Sign in</a>
          ) : null}
          <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{said ?? ''}</span>
        </div>
      ) : null}
      {sheet && settings ? (
        <SettingsSheet kind={sheet.kind} settings={settings} saved={sheet.saved} phone={phone} vars={vars} onCopy={copyText}
          onClose={() => { setSheet(null); button.current?.focus() }} />
      ) : null}
      {historyOpen && history ? (
        <HistoryPanel items={history.items} base={history.base} viewing={history.viewing} anchor={button}
          onClose={() => { setHistoryOpen(false); button.current?.focus() }} onOutside={() => setHistoryOpen(false)} />
      ) : null}
    </div>
  ) : null

  return (
    <>
      {/* What the server decided, drawn identically on both sides so the markup hydrates. The
          hidden version list keeps every past version reachable with scripts off. */}
      <span ref={marker} hidden data-page-menu-for={role} data-page-menu-items={items.join(' ')}>
        {history ? <VersionList items={history.items} base={history.base} marker /> : null}
      </span>
      {ui ? createPortal(ui, document.body) : null}
    </>
  )
}
