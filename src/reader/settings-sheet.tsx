'use client'
// The page menu's two owner-and-admin sheets (0.31.0): Share settings and Comment settings. The
// server hands the page these settings ONLY for the owner and the hub's admins (routes/artifacts
// `settingsFor`), and every change goes through POST /api/artifacts/<id>/settings, which checks
// the same thing again. On a phone a sheet from the bottom, on a desk a panel under the button,
// styled like the menu itself.
//
// A save that changes how the page renders (who opens it, the password, the comments) reloads
// the page so it shows the new settings, and the sheet opens again on the other side saying
// "Saved". Adding or removing someone on the list changes nothing on the page, so it does not.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { NO_ZOOM_FONT } from './no-zoom.js'

export type AccessLevel = 'public' | 'freedom' | 'invite'
export type SettingsFact = { label: string; text: string }
/** Everything the sheets show and change, for one page. The endpoint answers in the same shape. */
export type PageSettings = {
  /** POST here to change, GET to read. */
  endpoint: string
  access: AccessLevel
  /** The levels this host can offer: 'public' always; the gated ones only on a host that keeps a list. */
  levels: AccessLevel[]
  /** A password shuts the page (only meaningful while it is open to anyone with the link). */
  password: boolean
  /** The link to send: with the key when a password is on, else the page. */
  link: string
  /** Who is on the page's list, or null on a host that keeps none. */
  list: { email: string; name?: string }[] | null
  /** Who may comment, or null on a host that keeps no comments. */
  comments: 'off' | 'anyone' | 'signed-in' | null
  commentsVisible: 'owner' | 'readers'
  /** A gated page takes comments only from signed-in readers, whatever the setting says. */
  gated: boolean
  /** Read-only lines: what a stranger sees, search engines, anything the host adds. */
  facts: SettingsFact[]
}
export type SheetKind = 'share' | 'comments'

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  public: 'Anyone with the link',
  freedom: 'Any Supersuit account',
  invite: 'Only the list',
}
export const COMMENTS_LABEL = { anyone: 'Anyone', 'signed-in': 'Signed-in readers', off: 'Nobody' } as const
export const VISIBLE_LABEL = { owner: 'Owner and admins', readers: 'Every reader' } as const

/** Where a reload leaves a note for the sheet to open again with. */
export const REOPEN_KEY = 'artifact:settings-reopen'

/** The body of a settings POST, from what the sheet holds against what the page had. Only what
 *  changed is sent, so a save never touches a setting nobody moved. */
export function settingsChanges(was: PageSettings, now: Pick<PageSettings, 'access' | 'password' | 'comments' | 'commentsVisible'>) {
  const body: Record<string, unknown> = {}
  if (now.access !== was.access) body.access = now.access
  if (now.password !== was.password) body.password = now.password ? 'on' : 'off'
  if (now.comments !== null && now.comments !== was.comments) body.comments = now.comments
  if (now.commentsVisible !== was.commentsVisible) body.commentsVisible = now.commentsVisible
  return body
}

async function send(endpoint: string, body: unknown): Promise<{ ok: true; settings: PageSettings } | { ok: false; error: string }> {
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
    const j = (await r.json().catch(() => null)) as (PageSettings & { error?: string }) | null
    if (!r.ok || !j) return { ok: false, error: j?.error ?? `Could not save (${r.status})` }
    return { ok: true, settings: j }
  } catch {
    return { ok: false, error: 'Could not reach the page. Check the connection and try again.' }
  }
}

export function SettingsSheet({ kind, settings, phone, vars, onClose, onCopy, saved = false }: {
  kind: SheetKind
  settings: PageSettings
  phone: boolean
  vars: Record<string, string>
  onClose: () => void
  onCopy: (text: string) => Promise<boolean>
  /** Opened again after the reload a save caused: say so. */
  saved?: boolean
}) {
  const [s, setS] = useState(settings)
  const [access, setAccess] = useState(settings.access)
  const [password, setPassword] = useState(settings.password)
  const [comments, setComments] = useState(settings.comments)
  const [visible, setVisible] = useState(settings.commentsVisible)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(saved ? 'Saved' : null)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const changes = settingsChanges(s, { access, password, comments, commentsVisible: visible })
  const dirty = Object.keys(changes).length > 0

  const save = async () => {
    if (!dirty || busy) return
    setBusy(true)
    setSaid(null)
    const r = await send(s.endpoint, changes)
    setBusy(false)
    if (!r.ok) { setSaid(r.error); return }
    setS(r.settings)
    setSaid('Saved')
    // The page renders from these settings, so show it as it now is, and come back to this sheet.
    try { window.sessionStorage.setItem(REOPEN_KEY, kind) } catch { /* the reload still shows it */ }
    window.location.reload()
  }
  const listChange = async (body: { add?: { email: string }[]; remove?: string[] }) => {
    if (busy) return
    setBusy(true)
    setSaid(null)
    const r = await send(s.endpoint, body)
    setBusy(false)
    if (!r.ok) { setSaid(r.error); return }
    setS(r.settings)
    if (body.add) setEmail('')
    setSaid(body.add ? 'Added' : 'Removed')
  }
  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setSaid('That is not an email address'); return }
    void listChange({ add: [{ email: v }] })
  }
  const copy = async () => setSaid((await onCopy(s.link)) ? 'Link copied' : 'Could not copy the link')

  const font = phone ? 16 : 14
  const style: CSSProperties = {
    ...(vars as CSSProperties),
    position: 'fixed', zIndex: 61, boxSizing: 'border-box', background: 'var(--a-surface, var(--a-ground, #fff))', color: 'var(--a-strong, var(--a-ink, #111))',
    border: '1px solid var(--a-line, rgba(127,127,127,0.3))', boxShadow: '0 12px 32px rgba(0,0,0,0.22)', fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontStyle: 'normal', fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', outline: 'none', fontSize: font, lineHeight: 1.4, overflowY: 'auto',
    ...(phone
      ? { left: 8, right: 8, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', borderRadius: 16, padding: '14px 14px 12px', maxHeight: '82vh' }
      : { top: 'calc(env(safe-area-inset-top, 0px) + 56px)', right: 12, width: 360, borderRadius: 12, padding: '14px 14px 12px', maxHeight: 'calc(100vh - 72px)' }),
  }
  const h: CSSProperties = { margin: '0 0 10px', fontSize: font + 1, fontWeight: 600 }
  const legend: CSSProperties = { padding: 0, margin: '0 0 6px', fontSize: 12, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }
  const fieldset: CSSProperties = { border: 0, margin: '0 0 14px', padding: 0, minWidth: 0 }
  const choice: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: phone ? '8px 2px' : '5px 2px', cursor: 'pointer' }
  const btn: CSSProperties = {
    font: 'inherit', fontSize: font - 1, borderRadius: 8, padding: phone ? '9px 14px' : '6px 12px', cursor: 'pointer',
    border: '1px solid var(--a-line, rgba(127,127,127,0.3))', background: 'transparent', color: 'inherit',
  }
  const primary: CSSProperties = { ...btn, background: 'var(--a-accent, #111)', borderColor: 'var(--a-accent, #111)', color: 'var(--a-ground, #fff)', fontWeight: 600 }
  const muted: CSSProperties = { margin: '4px 0 0', fontSize: 12, opacity: 0.65 }

  const radio = <T extends string>(name: string, value: T, current: T | null, set: (v: T) => void, label: string, note?: string) => (
    <label key={value} style={choice} data-settings-choice={`${name}:${value}`}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} style={{ width: 18, height: 18, margin: 0, accentColor: 'var(--a-accent, #111)' }} />
      <span>{label}{note ? <span style={{ display: 'block', fontSize: 12, opacity: 0.6 }}>{note}</span> : null}</span>
    </label>
  )

  const share = (
    <>
      <fieldset style={fieldset}>
        <legend style={legend}>Who can open it</legend>
        {s.levels.map((l) => radio('access', l, access, setAccess, ACCESS_LABEL[l], l === 'freedom' ? 'Plus anyone on the list' : undefined))}
      </fieldset>
      {access === 'public' ? (
        <fieldset style={fieldset}>
          <legend style={legend}>Password</legend>
          <label style={choice} data-settings-choice="password">
            <input type="checkbox" checked={password} onChange={(e) => setPassword(e.target.checked)} style={{ width: 18, height: 18, margin: 0, accentColor: 'var(--a-accent, #111)' }} />
            <span>Require a password<span style={{ display: 'block', fontSize: 12, opacity: 0.6 }}>The link to send carries the key</span></span>
          </label>
        </fieldset>
      ) : null}
      {dirty || busy ? (
        <div style={{ display: 'flex', gap: 8, margin: '0 0 14px' }}>
          <button type="button" data-settings-save onClick={() => void save()} disabled={busy} style={primary}>{busy ? 'Saving' : 'Save'}</button>
          <button type="button" onClick={() => { setAccess(s.access); setPassword(s.password) }} disabled={busy} style={btn}>Undo</button>
        </div>
      ) : null}
      {s.list && s.access !== 'public' ? (
        <fieldset style={fieldset} data-settings-list>
          <legend style={legend}>{`The list (${s.list.length})`}</legend>
          {s.list.length === 0 ? <p style={{ ...muted, margin: '0 0 6px' }}>Nobody yet.</p> : null}
          <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0 }}>
            {s.list.map((e) => (
              <li key={e.email} data-settings-list-entry={e.email} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--a-line, rgba(127,127,127,0.2))' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {e.name ? <>{e.name}<span style={{ display: 'block', fontSize: 12, opacity: 0.6 }}>{e.email}</span></> : e.email}
                </span>
                <button type="button" aria-label={`Remove ${e.email}`} onClick={() => void listChange({ remove: [e.email] })} disabled={busy} style={btn}>Remove</button>
              </li>
            ))}
          </ul>
          <form onSubmit={onAdd} style={{ display: 'flex', gap: 8 }}>
            <input type="email" inputMode="email" autoComplete="off" placeholder="name@example.com" aria-label="Email to add" value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1, minWidth: 0, font: 'inherit', ...NO_ZOOM_FONT, padding: phone ? '8px 10px' : '6px 8px', borderRadius: 8, border: '1px solid var(--a-line, rgba(127,127,127,0.4))', background: 'transparent', color: 'inherit' }} />
            <button type="submit" disabled={busy} style={btn}>Add</button>
          </form>
          {s.access === 'invite' ? null : <p style={muted}>Supersuit accounts get in without being on the list.</p>}
        </fieldset>
      ) : null}
      <div style={{ margin: '0 0 14px' }} data-settings-link>
        <p style={legend}>The link to send</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{ flex: 1, minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }}>{s.link}</code>
          <button type="button" onClick={() => void copy()} style={btn}>Copy</button>
        </div>
      </div>
      {s.facts.length ? (
        <dl style={{ display: 'grid', gap: 8, margin: 0 }} data-settings-facts>
          {s.facts.map((f) => (
            <div key={f.label}>
              <dt style={{ fontSize: 12, fontWeight: 600, opacity: 0.7 }}>{f.label}</dt>
              <dd style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>{f.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  )

  const commentSheet = (
    <>
      <fieldset style={fieldset}>
        <legend style={legend}>Who can comment</legend>
        {(['anyone', 'signed-in', 'off'] as const).map((m) => radio('comments', m, comments, setComments, COMMENTS_LABEL[m],
          m === 'anyone' && s.gated ? 'This page is private, so only signed-in readers it is open to can' : undefined))}
      </fieldset>
      {comments !== 'off' ? (
        <fieldset style={fieldset}>
          <legend style={legend}>Who can read the comments</legend>
          {(['owner', 'readers'] as const).map((v) => radio('visible', v, visible, setVisible, VISIBLE_LABEL[v],
            v === 'owner' ? 'Each commenter also sees their own' : undefined))}
        </fieldset>
      ) : null}
      {dirty || busy ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" data-settings-save onClick={() => void save()} disabled={busy} style={primary}>{busy ? 'Saving' : 'Save'}</button>
          <button type="button" onClick={() => { setComments(s.comments); setVisible(s.commentsVisible) }} disabled={busy} style={btn}>Undo</button>
        </div>
      ) : null}
    </>
  )

  return (
    <>
      <div aria-hidden data-settings-scrim onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: phone ? 'rgba(0,0,0,0.28)' : 'transparent' }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={kind === 'share' ? 'Share settings' : 'Comment settings'} tabIndex={-1}
        data-settings-sheet={kind} data-nospeak data-comment-ui style={style}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={h}>{kind === 'share' ? 'Share settings' : 'Comment settings'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn, border: 0, padding: '2px 6px', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        {kind === 'share' ? share : commentSheet}
        <p role="status" aria-live="polite" data-settings-said style={{ margin: said ? '10px 0 0' : 0, fontSize: 13, minHeight: 0 }}>{said ?? ''}</p>
      </div>
    </>
  )
}
