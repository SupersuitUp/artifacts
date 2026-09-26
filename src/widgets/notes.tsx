'use client'
// The notes widget in the reader's browser. One provider per page reads the page's state once
// (GET /api/artifacts/<id>/state), places every note under the heading it was left under, and
// sets aside the ones whose heading is gone. A small "note" control sits in each heading; the
// panel after the heading lists its notes and, when open, takes a new one.
//
// Everything drawn here carries data-nospeak: narration reads the prose, never the notes, and
// the read-along highlighter skips the same nodes. Notes are shown as text, never as markup.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { MAX_NOTE_CHARS, NOTES_SLOT, placeNotes, type PlacedNote } from '../artifacts/notes-place.js'

type Ctx = {
  off: boolean
  accent: string
  bySlug: Record<string, PlacedNote[]>
  earlier: PlacedNote[]
  canWrite: boolean
  signIn: string | null
  open: string | null
  setOpen: (slug: string | null) => void
  error: string | null
  busy: boolean
  post: (slug: string, heading: string, note: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
}
const NotesContext = createContext<Ctx | null>(null)

type RawEntry = { id?: unknown; name?: unknown; value?: unknown; at?: unknown; mine?: unknown }
const isNote = (v: unknown): v is { slug: string; heading: string; note: string } =>
  !!v && typeof v === 'object' && typeof (v as { slug?: unknown }).slug === 'string' &&
  typeof (v as { heading?: unknown }).heading === 'string' && typeof (v as { note?: unknown }).note === 'string'

function notesFrom(body: unknown): PlacedNote[] {
  const slot = (body as { slots?: Record<string, { shared?: RawEntry[]; mine?: unknown }> })?.slots?.[NOTES_SLOT]
  if (!slot) return []
  const rows: RawEntry[] = Array.isArray(slot.shared) ? slot.shared : Array.isArray(slot.mine) ? (slot.mine as RawEntry[]).map((e) => ({ ...e, mine: true })) : []
  const out: PlacedNote[] = []
  for (const r of rows) {
    if (!isNote(r.value)) continue
    out.push({
      id: String(r.id ?? ''), slug: r.value.slug, heading: r.value.heading, note: r.value.note,
      name: r.mine ? 'You' : typeof r.name === 'string' ? r.name : 'a reader', at: String(r.at ?? ''), mine: r.mine === true,
    })
  }
  return out
}

export function NotesProvider({ artifactId, headings, accent, children }: { artifactId: string; headings: { slug: string; text: string }[]; accent?: string; children: ReactNode }) {
  const endpoint = `/api/artifacts/${artifactId}/state`
  const [notes, setNotes] = useState<PlacedNote[]>([])
  const [off, setOff] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [signIn, setSignIn] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = useCallback((status: number, body: Record<string, unknown>) => {
    if (status === 200) {
      setNotes(notesFrom(body))
      setCanWrite(body.canWrite === true)
      setSignIn(typeof body.signIn === 'string' ? body.signIn : null)
      setError(null)
      return true
    }
    if (status === 401) {
      setCanWrite(false)
      setSignIn(typeof body.signIn === 'string' ? body.signIn : null)
      return false
    }
    // No state store, no such page, or no slot: the page takes no notes here, so draw nothing.
    if (status === 404 || status === 501) { setOff(true); return false }
    setError(typeof body.error === 'string' ? body.error : 'that did not save; try again')
    return false
  }, [])

  const call = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', ...init })
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
      return apply(r.status, body)
    } catch {
      setError('that did not reach the page; try again')
      return false
    }
  }, [endpoint, apply])

  useEffect(() => { void call() }, [call])

  const post = useCallback(async (slug: string, heading: string, note: string) => {
    setBusy(true)
    const done = await call({
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: NOTES_SLOT, op: 'append', value: { slug, heading, note } }),
    })
    setBusy(false)
    if (done) setOpen(null)
    return done
  }, [call])

  const remove = useCallback(async (id: string) => {
    await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: NOTES_SLOT, op: 'remove', entry: id }) })
  }, [call])

  const placed = useMemo(() => placeNotes(headings, notes), [headings, notes])
  const value: Ctx = { off, accent: accent ?? 'currentColor', ...placed, canWrite, signIn, open, setOpen, error, busy, post, remove }
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
}

/** The small control inside a heading. */
export function NoteToggle({ slug }: { slug: string }) {
  const c = useContext(NotesContext)
  if (!c || c.off) return null
  const n = c.bySlug[slug]?.length ?? 0
  return (
    <button
      type="button"
      data-nospeak
      data-note-toggle={slug}
      aria-expanded={c.open === slug}
      onClick={() => c.setOpen(c.open === slug ? null : slug)}
      className="ml-3 inline-block rounded-full border px-2 py-0.5 align-middle font-sans text-[11px] font-medium uppercase tracking-[0.15em] opacity-70 transition-opacity hover:opacity-100"
      style={{ borderColor: c.accent, color: c.accent }}
    >
      {n ? `note · ${n}` : 'note'}
    </button>
  )
}

function NoteItem({ n, c, under }: { n: PlacedNote; c: Ctx; under?: boolean }) {
  return (
    <li className="m-0 border-l-2 py-1 pl-3" style={{ borderColor: c.accent }}>
      <span className="block whitespace-pre-wrap text-[15px] text-zinc-100">{n.note}</span>
      <span className="block text-xs opacity-60">
        {n.name}
        {under ? <> · under “{n.heading}”</> : null}
        {n.mine && n.id ? (
          <button type="button" data-note-remove={n.id} onClick={() => void c.remove(n.id)} className="ml-2 underline opacity-80 hover:opacity-100">
            remove
          </button>
        ) : null}
      </span>
    </li>
  )
}

function NoteForm({ slug, heading, c }: { slug: string; heading: string; c: Ctx }) {
  const [text, setText] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const note = text.trim()
    if (!note) return
    if (await c.post(slug, heading, note)) setText('')
  }
  if (!c.canWrite) {
    return c.signIn ? (
      <p className="my-2 text-sm"><a href={c.signIn} className="underline" style={{ color: c.accent }}>Sign in to leave a note</a></p>
    ) : (
      <p className="my-2 text-sm opacity-70">Notes here are open to signed-in readers.</p>
    )
  }
  return (
    <form onSubmit={submit} className="my-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_NOTE_CHARS}
        rows={3}
        aria-label={`A note on ${heading}`}
        placeholder={`A note on “${heading}”`}
        className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-3 text-[15px] text-zinc-100"
      />
      {c.error ? <p className="mt-1 text-xs text-amber-500">{c.error}</p> : null}
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={c.busy || !text.trim()} className="rounded-full px-4 py-1 text-sm font-medium disabled:opacity-40" style={{ background: c.accent, color: '#111' }}>
          Save note
        </button>
        <button type="button" onClick={() => c.setOpen(null)} className="text-sm opacity-70 hover:opacity-100">Cancel</button>
      </div>
    </form>
  )
}

/** After each heading: its notes, and the box when its control is open. */
export function HeadingNotes({ slug, text }: { slug: string; text: string }) {
  const c = useContext(NotesContext)
  if (!c || c.off) return null
  const list = c.bySlug[slug] ?? []
  const isOpen = c.open === slug
  if (!list.length && !isOpen) return null
  return (
    <div data-nospeak data-heading-notes={slug} className="my-3">
      {list.length ? <ul className="m-0 grid list-none gap-2 p-0">{list.map((n) => <NoteItem key={n.id} n={n} c={c} />)}</ul> : null}
      {isOpen ? <NoteForm slug={slug} heading={text} c={c} /> : null}
    </div>
  )
}

/** Where the ```notes fence sits: a line saying notes are on, and the notes whose heading is gone. */
export function NotesEarlier() {
  const c = useContext(NotesContext)
  if (!c || c.off) return null
  return (
    <section data-nospeak data-artifact-notes className="my-8 text-sm">
      <p className="opacity-60">Leave a note beside any heading.</p>
      {c.earlier.length ? (
        <>
          <p className="mt-4 text-[11px] uppercase tracking-[0.2em]" style={{ color: c.accent }}>Notes on earlier versions</p>
          <ul className="m-0 mt-2 grid list-none gap-2 p-0">{c.earlier.map((n) => <NoteItem key={n.id} n={n} c={c} under />)}</ul>
        </>
      ) : null}
    </section>
  )
}
