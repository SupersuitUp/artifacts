'use client'
// The page's owner panel (artifact hub admin center, task 4), opened from the page menu's "Owner view". The server
// hands the menu an OwnerView ONLY for the owner and the hub's admins signed in (routes/artifacts `Menu`), and every
// endpoint below checks the same thing again (routes/owner-auth.ts), so a reader's link never reaches any of it.
//
// It is this page's slice of the Artifacts tile (`../owner`): each reader's card exactly as the tile's page view draws
// it (sent, opened, came back, read time, comments), and the version history. Its buttons are what an agent does to a
// page, and each one sends the SAME request as the command it mirrors (`ownerRequests`, tested against
// freedom-dev's publish-artifact recipients.mjs and publish.mjs): a new reader link, copy a link, shut a link, when the
// links close, the existing Share settings sheet, unpublish, delete. Nothing here is a behaviour of its own.
//
// Data is read when the panel opens and after every change, with the reader grant cookie (same-origin), so opening a
// page costs nobody a read. Drawn like the settings sheet: a sheet from the bottom on a phone, a panel on a desk.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { sendOfSummary, type Send } from '../analytics/index.js'
import { ReaderCard, themeFromPageVars } from '../owner/index.js'
import type { RecipientSummary } from '../artifacts/recipients-store.js'
import { NO_ZOOM_FONT } from './no-zoom.js'

/** What the server tells the menu about this page, for the owner and admins only. */
export type OwnerView = {
  id: string
  title: string
  /** The page's own address. */
  url: string
  /** Where to go once the page is unpublished or deleted: the hub's home. */
  home: string
  /** `links: per-reader`: readers get links of their own, so the panel can make and close them. */
  perReader: boolean
}

type Req = { url: string; method: 'GET' | 'POST' | 'DELETE'; body?: unknown }
const at = (id: string, rest = '') => `/api/artifacts/${id}${rest}`
/** Every request the panel sends, one per command it mirrors. */
export const ownerRequests = {
  views: (id: string): Req => ({ url: at(id, '/views'), method: 'GET' }),
  recipients: (id: string): Req => ({ url: at(id, '/recipients'), method: 'GET' }),
  versions: (id: string): Req => ({ url: at(id, '/versions'), method: 'GET' }),
  /** recipients.mjs add --label <name> */
  add: (id: string, label: string): Req => ({ url: at(id, '/recipients'), method: 'POST', body: { add: [{ label }] } }),
  /** recipients.mjs revoke --rid <rid> */
  revoke: (id: string, rid: string): Req => ({ url: at(id, '/recipients'), method: 'POST', body: { revoke: [rid] } }),
  /** recipients.mjs expires --at <iso> | --keep */
  expires: (id: string, iso: string | null): Req => ({ url: at(id, '/recipients'), method: 'POST', body: { expires: iso } }),
  /** publish.mjs --delete <file>: off the web, history kept */
  unpublish: (id: string): Req => ({ url: `/api/artifacts?id=${id}&unpublish=1`, method: 'POST' }),
  /** publish.mjs --delete --purge: the page, every version and comment, for good */
  remove: (id: string): Req => ({ url: at(id), method: 'DELETE' }),
}

async function send<T = Record<string, unknown>>(r: Req): Promise<{ ok: true; json: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(r.url, {
      method: r.method, credentials: 'same-origin',
      ...(r.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) }),
    })
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
    if (!res.ok || !json) return { ok: false, error: json?.error ?? `The hub answered ${res.status}` }
    return { ok: true, json }
  } catch {
    return { ok: false, error: 'Could not reach the hub. Check the connection and try again.' }
  }
}

type Listing = { expireAt: string | null; keep: boolean; recipients: { rid: string; label: string; owner: boolean; revoked: boolean; addedAt?: string; url: string }[] }
type Versions = { versions: { version: number; at: string; note?: string; current?: boolean }[] }
type Loaded = { sends: Send[]; links: Record<string, string>; expireAt: string | null; versions: Versions['versions']; errors: string[] }

const QUIET_DAYS = 3
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function OwnerPanel({ view, phone, vars, onClose, onCopy, onShareSettings }: {
  view: OwnerView
  phone: boolean
  vars: Record<string, string>
  onClose: () => void
  onCopy: (text: string) => Promise<boolean>
  /** Opens the page menu's Share settings sheet; absent when this host keeps no settings. */
  onShareSettings?: () => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [made, setMade] = useState<{ label: string; url: string } | null>(null)
  const [closes, setCloses] = useState('')
  const [confirm, setConfirm] = useState<'unpublish' | 'delete' | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    const [v, r, h] = await Promise.all([
      send<{ recipients: RecipientSummary[] }>(ownerRequests.views(view.id)),
      send<Listing>(ownerRequests.recipients(view.id)),
      send<Versions>(ownerRequests.versions(view.id)),
    ])
    const listing = r.ok ? r.json : null
    const added = new Map((listing?.recipients ?? []).map((x) => [x.rid, x]))
    const page = { id: view.id, title: view.title, url: view.url }
    const now = new Date().toISOString()
    const sends = v.ok ? v.json.recipients.map((s) => sendOfSummary({ quietDays: QUIET_DAYS }, page, s, added.get(s.rid)?.addedAt ?? s.sentAt ?? now)) : []
    setData({
      sends, links: Object.fromEntries([...added].map(([rid, x]) => [rid, x.url])), expireAt: listing?.expireAt ?? null,
      versions: h.ok ? h.json.versions : [],
      errors: [!v.ok && view.perReader ? `Readers: ${v.error}` : '', !h.ok ? `Versions: ${h.error}` : ''].filter(Boolean),
    })
  }, [view.id, view.title, view.url, view.perReader])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /** One change, then the panel reads the page again so it shows what the hub now holds. */
  const act = async (r: Req, done: string, after?: (json: Record<string, unknown>) => void) => {
    if (busy) return false
    setBusy(true)
    setSaid(null)
    const res = await send(r)
    setBusy(false)
    if (!res.ok) { setSaid(res.error); return false }
    after?.(res.json)
    setSaid(done)
    await load()
    return true
  }
  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    const name = label.trim()
    if (!name) { setSaid('Write who the link is for'); return }
    void act(ownerRequests.add(view.id, name), `Link made for ${name}`, (j) => {
      const a = (j.added as { label: string; url: string }[] | undefined)?.[0]
      if (a) setMade({ label: a.label, url: a.url })
      setLabel('')
    })
  }
  const copy = async (url: string) => setSaid((await onCopy(url)) ? 'Link copied' : 'Could not copy the link')
  const onExpires = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closes)) { setSaid('Choose a day'); return }
    void act(ownerRequests.expires(view.id, new Date(`${closes}T23:59:00`).toISOString()), 'Links close then')
  }
  const onGone = async (kind: 'unpublish' | 'delete') => {
    const ok = await act(kind === 'delete' ? ownerRequests.remove(view.id) : ownerRequests.unpublish(view.id), kind === 'delete' ? 'Deleted' : 'Unpublished')
    setConfirm(null)
    if (ok) window.location.assign(view.home)
  }

  const font = phone ? 16 : 14
  const style: CSSProperties = {
    ...(vars as CSSProperties),
    position: 'fixed', zIndex: 61, boxSizing: 'border-box', background: 'var(--a-surface, var(--a-ground, #fff))', color: 'var(--a-strong, var(--a-ink, #111))',
    border: '1px solid var(--a-line, rgba(127,127,127,0.3))', boxShadow: '0 12px 32px rgba(0,0,0,0.22)', fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontStyle: 'normal', fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', outline: 'none', fontSize: font, lineHeight: 1.4, overflowY: 'auto',
    ...(phone
      ? { left: 8, right: 8, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', borderRadius: 16, padding: '14px 14px 12px', maxHeight: '82vh' }
      : { top: 'calc(env(safe-area-inset-top, 0px) + 56px)', right: 12, width: 420, borderRadius: 12, padding: '14px 14px 12px', maxHeight: 'calc(100vh - 72px)' }),
  }
  const h: CSSProperties = { margin: '0 0 10px', fontSize: font + 1, fontWeight: 600 }
  const legend: CSSProperties = { padding: 0, margin: '0 0 6px', fontSize: 12, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }
  const section: CSSProperties = { margin: '0 0 16px' }
  const btn: CSSProperties = {
    font: 'inherit', fontSize: font - 1, borderRadius: 8, padding: phone ? '9px 14px' : '6px 12px', cursor: 'pointer',
    border: '1px solid var(--a-line, rgba(127,127,127,0.3))', background: 'transparent', color: 'inherit',
  }
  const small: CSSProperties = { ...btn, padding: phone ? '7px 12px' : '4px 10px', fontSize: font - 2 }
  const primary: CSSProperties = { ...btn, background: 'var(--a-accent, #111)', borderColor: 'var(--a-accent, #111)', color: 'var(--a-ground, #fff)', fontWeight: 600 }
  const danger: CSSProperties = { ...btn, borderColor: '#c0392b', color: '#c0392b' }
  const muted: CSSProperties = { margin: '4px 0 0', fontSize: 12, opacity: 0.65 }
  const input: CSSProperties = { flex: 1, minWidth: 0, font: 'inherit', ...NO_ZOOM_FONT, padding: phone ? '8px 10px' : '6px 8px', borderRadius: 8, border: '1px solid var(--a-line, rgba(127,127,127,0.4))', background: 'transparent', color: 'inherit' }
  const theme = themeFromPageVars()

  return (
    <>
      <div aria-hidden data-settings-scrim onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: phone ? 'rgba(0,0,0,0.28)' : 'transparent' }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Owner view" tabIndex={-1} data-owner-panel data-nospeak data-comment-ui style={style}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={h}>Owner view</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn, border: 0, padding: '2px 6px', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={section} data-owner-readers>
          <p style={legend}>{data ? `Readers (${data.sends.length})` : 'Readers'}</p>
          {!data ? <p style={muted}>Reading the hub…</p> : data.sends.length ? (
            <ul className="grid gap-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.sends.map((s) => (
                <ReaderCard key={s.rid} s={s} theme={theme}>
                  {!s.revoked && view.perReader ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {data.links[s.rid] ? <button type="button" data-owner-action="copy" onClick={() => void copy(data.links[s.rid])} style={small}>Copy link</button> : null}
                      <button type="button" data-owner-action="revoke" disabled={busy} onClick={() => void act(ownerRequests.revoke(view.id, s.rid), `${s.label}'s link is shut`)} style={small}>Shut link</button>
                    </div>
                  ) : null}
                </ReaderCard>
              ))}
            </ul>
          ) : <p style={muted}>{view.perReader ? 'No reader links yet.' : 'This page has no reader links, so its readers are not named.'}</p>}
        </div>

        {view.perReader ? (
          <form onSubmit={onAdd} style={section}>
            <p style={legend}>New reader link</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input data-owner-new-label aria-label="Who the link is for" placeholder="Their name" value={label} onChange={(e) => setLabel(e.target.value)} style={input} />
              <button type="submit" data-owner-action="add" disabled={busy} style={btn}>Make link</button>
            </div>
            {made ? (
              <div data-owner-new-link style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <code style={{ flex: 1, minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }}>{made.url}</code>
                <button type="button" onClick={() => void copy(made.url)} style={small}>Copy</button>
              </div>
            ) : null}
          </form>
        ) : null}

        {view.perReader ? (
          <div style={section} data-owner-expires>
            <p style={legend}>When the links close</p>
            <p style={{ ...muted, margin: '0 0 8px' }}>{data?.expireAt ? `Every link closes ${day(data.expireAt)}.` : 'The links do not close.'}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <input type="date" data-owner-expires-date aria-label="The day the links close" value={closes} onChange={(e) => setCloses(e.target.value)} style={{ ...input, flex: '1 1 9rem' }} />
              <button type="button" data-owner-action="expires" disabled={busy} onClick={onExpires} style={btn}>Set</button>
              <button type="button" data-owner-action="keep" disabled={busy} onClick={() => void act(ownerRequests.expires(view.id, null), 'The links stay open')} style={btn}>Never close</button>
            </div>
          </div>
        ) : null}

        {data && data.versions.length ? (
          <div style={section}>
            <p style={legend}>{`Versions (${data.versions.length})`}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.versions.map((v) => (
                <li key={v.version} data-owner-version={v.version} style={{ padding: '4px 0', borderBottom: '1px solid var(--a-line, rgba(127,127,127,0.2))' }}>
                  {`Version ${v.version}${v.current ? ' (this one)' : ''} · ${day(v.at)}`}
                  {v.note ? <span style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>{v.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ ...section, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {onShareSettings ? <button type="button" data-owner-action="share-settings" onClick={onShareSettings} style={btn}>Share settings</button> : null}
          <button type="button" data-owner-action="unpublish" disabled={busy} onClick={() => setConfirm('unpublish')} style={btn}>Unpublish</button>
          <button type="button" data-owner-action="delete" disabled={busy} onClick={() => setConfirm('delete')} style={danger}>Delete</button>
        </div>
        {confirm ? (
          <div role="alertdialog" aria-label={confirm === 'delete' ? 'Delete this page' : 'Unpublish this page'} data-owner-confirm-box style={{ ...section, padding: 10, borderRadius: 8, border: '1px solid var(--a-line, rgba(127,127,127,0.3))' }}>
            <p style={{ margin: '0 0 8px' }}>
              {confirm === 'delete'
                ? 'Delete this page with every version, comment and reader link? This cannot be undone.'
                : 'Take this page off the web? Its versions and comments are kept, and it can be put back at this link.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" data-owner-confirm={confirm} disabled={busy} onClick={() => void onGone(confirm)} style={confirm === 'delete' ? { ...primary, background: '#c0392b', borderColor: '#c0392b', color: '#fff' } : primary}>
                {confirm === 'delete' ? 'Delete for good' : 'Unpublish'}
              </button>
              <button type="button" onClick={() => setConfirm(null)} style={btn}>Keep it</button>
            </div>
          </div>
        ) : null}

        {data?.errors.length ? data.errors.map((e) => <p key={e} style={muted}>{e}</p>) : null}
        <p role="status" aria-live="polite" data-owner-said style={{ margin: said ? '10px 0 0' : 0, fontSize: 13 }}>{said ?? ''}</p>
      </div>
    </>
  )
}
