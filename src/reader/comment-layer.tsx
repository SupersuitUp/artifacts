'use client'
// Comments on any part of a page, Figma style. Select text and a "Comment" chip appears; hold and
// drag over anything that is not text (an image, a table, the gap between paragraphs) and a box
// draws. Either opens the card (comment-card.tsx), which says before anything is typed whether
// the owner will ever read it.
//
// Two kinds, kept apart all the way down:
//   SHARED   the `comments` slot on the state API; filled pins in the page's accent.
//   PERSONAL the reader's own notes: /personal when signed in, else this device only
//            (device-notes.ts); hollow pins marked "only you". Never on the state API.
//
// Pins sit in the margin beside a quote, or on the box drawn. A comment whose quote or block is gone
// from this version is listed under "Comments on earlier versions" after the article, with its
// quote, the way the notes widget sets aside notes on a renamed heading. Replies are one level
// deep and only on shared comments. Everything drawn here is data-nospeak and data-comment-ui, so
// the read-aloud never reads it and the text index never counts it.
//
// Rendered empty on the server and on the first client render so the markup always hydrates; the
// overlay is portalled onto document.body so its coordinates are page coordinates.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MAX_QUOTE_CHARS, textAnchorFrom, type Anchor } from '../artifacts/anchor.js'
import { COMMENTS_SLOT, type CommentValue, type CommentsMode } from '../artifacts/comments.js'
import type { PersonalNote } from '../artifacts/personal-store.js'
import { CommentCard } from './comment-card.js'
import { themeVarsAround } from './theme-vars.js'
import { addDeviceNote, deviceNotes, removeDeviceNote, replaceDeviceNote } from './device-notes.js'
import { boxOf, headingAt, indexText, offsetAt, placeAnchor, regionFrom } from './comment-place.js'

type Item = { id: string; kind: 'shared' | 'personal'; where: 'server' | 'device'; value: CommentValue; name: string; mine: boolean; at: string }
type Draft = { anchor: Anchor; x: number; y: number; quote?: string }
type RawRow = { id?: unknown; name?: unknown; value?: unknown; at?: unknown; mine?: unknown }

const isValue = (v: unknown): v is CommentValue =>
  !!v && typeof v === 'object' && typeof (v as CommentValue).body === 'string' && !!(v as CommentValue).anchor && typeof (v as CommentValue).anchor === 'object'
const LONG_PRESS_MS = 400
const DRAG_PX = 8
/** Where a drag never starts a box: controls, and anything that is somebody's words. */
const NOT_FOR_BOXES = 'a, button, input, textarea, select, audio, video[controls], summary, label, [data-comment-ui], [data-note-toggle], [data-heading-notes], [data-artifact-notes], .artifact-defined-term, .artifact-word'

function isTextTarget(el: Element): boolean {
  if (el.closest(NOT_FOR_BOXES)) return true
  for (const c of Array.from(el.childNodes)) if (c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) return true
  return false
}

function sharedFrom(body: unknown): Item[] {
  const slot = (body as { slots?: Record<string, { shared?: RawRow[]; mine?: RawRow[] }> })?.slots?.[COMMENTS_SLOT]
  if (!slot) return []
  const rows = new Map<string, RawRow>()
  for (const r of Array.isArray(slot.mine) ? slot.mine : []) rows.set(String(r.id), { ...r, mine: true })
  for (const r of Array.isArray(slot.shared) ? slot.shared : []) rows.set(String(r.id), r)
  const out: Item[] = []
  for (const r of rows.values()) {
    if (!isValue(r.value)) continue
    out.push({ id: String(r.id), kind: 'shared', where: 'server', value: r.value, name: r.mine === true ? 'You' : typeof r.name === 'string' ? r.name : 'a reader', mine: r.mine === true, at: String(r.at ?? '') })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
const personalFrom = (notes: PersonalNote[], where: Item['where']): Item[] =>
  notes.filter((n) => isValue(n.value)).map((n) => ({ id: n.id, kind: 'personal', where, value: n.value as CommentValue, name: 'You', mine: true, at: n.at }))

export function CommentLayer({
  artifactId, rootId, ownerName, comments, canShare, signedIn, isOwner, version, accent, ground, signIn,
}: {
  artifactId: string
  /** The element holding the page's prose, the same root the read-aloud lights. */
  rootId: string
  ownerName: string
  comments: CommentsMode
  /** This reader may leave shared comments here (comments: is on, and they are signed in where it asks). */
  canShare: boolean
  signedIn: boolean
  isOwner: boolean
  /** The version being read, stored on every comment left on it. */
  version: number
  accent: string
  ground: string
  signIn?: string | null
}) {
  const stateUrl = `/api/artifacts/${artifactId}/state`
  const personalUrl = `/api/artifacts/${artifactId}/personal`
  const [mounted, setMounted] = useState(false)
  const [shared, setShared] = useState<Item[]>([])
  const [serverNotes, setServerNotes] = useState<Item[]>([])
  const [device, setDevice] = useState<Item[]>([])
  const [onServer, setOnServer] = useState(signedIn)
  const [showPins, setShowPins] = useState(true)
  const [panel, setPanel] = useState(false)
  const [chip, setChip] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [thread, setThread] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [theme, setTheme] = useState<Record<string, string>>({})

  const call = useCallback(async (url: string, init?: RequestInit) => {
    try {
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
    } catch {
      return { status: 0, body: { error: 'that did not reach the page; try again' } as Record<string, unknown> }
    }
  }, [])
  const refreshDevice = useCallback(() => setDevice(personalFrom(deviceNotes(artifactId), 'device')), [artifactId])

  // The theme the overlay carries, re-read when a `system` page flips between light and dark.
  useEffect(() => {
    const read = () => setTheme(themeVarsAround(document.getElementById(rootId)))
    read()
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    mq?.addEventListener?.('change', read)
    return () => mq?.removeEventListener?.('change', read)
  }, [rootId])

  useEffect(() => {
    setMounted(true)
    refreshDevice()
    let live = true
    if (comments !== 'off') {
      void call(stateUrl).then((r) => { if (live && r.status === 200) setShared(sharedFrom(r.body)) })
    }
    if (signedIn) {
      void (async () => {
        const r = await call(personalUrl)
        if (!live) return
        if (r.status !== 200) { setOnServer(false); return }
        let notes = (r.body.notes as PersonalNote[]) ?? []
        // Notes kept on this device before signing in move to the account, then leave the device.
        for (const n of deviceNotes(artifactId)) {
          const m = await call(personalUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: n.value }) })
          if (m.status !== 200) break
          notes = (m.body.notes as PersonalNote[]) ?? notes
          removeDeviceNote(artifactId, n.id)
        }
        if (!live) return
        setServerNotes(personalFrom(notes, 'server'))
        refreshDevice()
      })()
    }
    const relayout = () => setTick((t) => t + 1)
    window.addEventListener('resize', relayout)
    const root = document.getElementById(rootId)
    const ro = typeof ResizeObserver !== 'undefined' && root ? new ResizeObserver(relayout) : null
    if (ro && root) ro.observe(root)
    return () => { live = false; window.removeEventListener('resize', relayout); ro?.disconnect() }
  }, [artifactId, comments, signedIn, stateUrl, personalUrl, rootId, call, refreshDevice])

  // Text selection inside the page shows the Comment chip.
  useEffect(() => {
    const root = document.getElementById(rootId)
    if (!root) return
    const check = () => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setChip(null)
      const r = sel.getRangeAt(0)
      const common = r.commonAncestorContainer
      if (!root.contains(common) || (common instanceof Element ? common : common.parentElement)?.closest('[data-comment-ui]')) return setChip(null)
      const idx = indexText(root)
      let s = offsetAt(idx, r.startContainer, r.startOffset)
      let e = offsetAt(idx, r.endContainer, r.endOffset)
      if (s === null || e === null) return setChip(null)
      while (s < e && /\s/.test(idx.text[s])) s++
      while (e > s && /\s/.test(idx.text[e - 1])) e--
      if (e <= s) return setChip(null)
      e = Math.min(e, s + MAX_QUOTE_CHARS)
      const anchor = textAnchorFrom(idx.text, s, e, headingAt(root, idx, s))
      const rect = typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : null
      setChip({ anchor, quote: anchor.quote, x: (rect?.right ?? 0) + window.scrollX, y: (rect?.bottom ?? 0) + window.scrollY + 6 })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    // Phones adjust a selection with handles and fire no mouseup; settle on selectionchange instead.
    const settle = () => { clearTimeout(timer); timer = setTimeout(check, 350) }
    root.addEventListener('mouseup', check)
    root.addEventListener('keyup', check)
    document.addEventListener('selectionchange', settle)
    return () => { clearTimeout(timer); root.removeEventListener('mouseup', check); root.removeEventListener('keyup', check); document.removeEventListener('selectionchange', settle) }
  }, [rootId])

  // Hold and drag over anything that is not text draws a box. A mouse starts after 8px of travel;
  // a finger after a 400 ms long-press, so an ordinary swipe still scrolls.
  const dragRef = useRef<{ x: number; y: number; armed: boolean; drawing: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null)
  useEffect(() => {
    const root = document.getElementById(rootId)
    if (!root) return
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element) || isTextTarget(e.target)) return
      const d: NonNullable<typeof dragRef.current> = { x: e.clientX, y: e.clientY, armed: e.pointerType !== 'touch', drawing: false }
      if (e.pointerType === 'touch') d.timer = setTimeout(() => { d.armed = true; navigator.vibrate?.(10) }, LONG_PRESS_MS)
      else e.preventDefault()
      dragRef.current = d
    }
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX
      if (!d.armed) { if (far) { clearTimeout(d.timer); dragRef.current = null } return }
      if (!d.drawing && !far) return
      d.drawing = true
      setDrag({ x1: d.x, y1: d.y, x2: e.clientX, y2: e.clientY })
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      clearTimeout(d.timer)
      setDrag(null)
      if (!d.drawing) return
      const box = { left: Math.min(d.x, e.clientX), right: Math.max(d.x, e.clientX), top: Math.min(d.y, e.clientY), bottom: Math.max(d.y, e.clientY) }
      // The box belongs to the block it covers most, so a drag across a gap still lands somewhere.
      let best: { el: HTMLElement; area: number } | null = null
      for (const el of root.querySelectorAll<HTMLElement>('[data-block]')) {
        const b = el.getBoundingClientRect()
        const area = Math.max(0, Math.min(box.right, b.right) - Math.max(box.left, b.left)) * Math.max(0, Math.min(box.bottom, b.bottom) - Math.max(box.top, b.top))
        if (area > 0 && (!best || area > best.area)) best = { el, area }
      }
      if (!best) return
      const anchor = regionFrom(best.el.getBoundingClientRect(), { x: d.x, y: d.y }, { x: e.clientX, y: e.clientY }, best.el.dataset.block!)
      if (anchor) { setChip(null); setDraft({ anchor, x: box.right + window.scrollX, y: box.bottom + window.scrollY + 6 }) }
    }
    // While a finger is drawing, the page must not scroll under it.
    const touchmove = (e: TouchEvent) => { if (dragRef.current?.armed) e.preventDefault() }
    const noImageDrag = (e: DragEvent) => { if (dragRef.current) e.preventDefault() }
    root.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    root.addEventListener('touchmove', touchmove, { passive: false })
    root.addEventListener('dragstart', noImageDrag)
    return () => {
      root.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      root.removeEventListener('touchmove', touchmove)
      root.removeEventListener('dragstart', noImageDrag)
    }
  }, [rootId])

  const items = useMemo(() => [...shared, ...serverNotes, ...device], [shared, serverNotes, device])
  const tops = useMemo(() => items.filter((i) => !i.value.parent || !items.some((p) => p.id === i.value.parent)), [items])

  // Where each top-level comment sits on this version, or that it is on an earlier one.
  const layout = useMemo(() => {
    const placed: { item: Item; left: number; top: number; box?: { left: number; top: number; width: number; height: number } }[] = []
    const earlier: Item[] = []
    if (!mounted) return { placed, earlier }
    const root = document.getElementById(rootId)
    if (!root) return { placed, earlier: tops }
    const idx = indexText(root)
    const col = (root.querySelector('article') ?? root).getBoundingClientRect()
    const margin = Math.min(col.right + window.scrollX + 8, window.scrollX + (window.innerWidth || col.right + 40) - 32)
    for (const item of tops) {
      const at = item.value.parent ? null : placeAnchor(root, idx, item.value.anchor)
      if (!at) { earlier.push(item); continue }
      const b = boxOf(at)
      if (at.kind === 'text') placed.push({ item, left: margin, top: b.top })
      else placed.push({ item, left: b.left + b.width - 12, top: b.top - 12, box: b })
    }
    // Pins on the same line stack instead of hiding one another.
    placed.sort((a, b) => a.top - b.top || a.left - b.left)
    for (let i = 1; i < placed.length; i++) {
      const p = placed[i - 1]
      if (Math.abs(placed[i].left - p.left) < 20 && placed[i].top - p.top < 26) placed[i].top = p.top + 26
    }
    return { placed, earlier }
    // `tick` re-measures after a resize.
  }, [mounted, rootId, tops, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveNew = async (body: string, share: boolean, d: Draft): Promise<string | null> => {
    const value: CommentValue = { anchor: d.anchor, body, version }
    if (share) {
      const r = await call(stateUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: COMMENTS_SLOT, op: 'append', value }) })
      if (r.status !== 200) return typeof r.body.error === 'string' ? r.body.error : 'that did not save; try again'
      setShared(sharedFrom(r.body))
    } else if (signedIn && onServer) {
      const r = await call(personalUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) })
      if (r.status === 200) setServerNotes(personalFrom((r.body.notes as PersonalNote[]) ?? [], 'server'))
      else if (r.body.device === true) { setOnServer(false); addDeviceNote(artifactId, value); refreshDevice() }
      else return typeof r.body.error === 'string' ? r.body.error : 'that did not save; try again'
    } else {
      addDeviceNote(artifactId, value)
      refreshDevice()
    }
    document.getSelection()?.removeAllRanges()
    setDraft(null)
    return null
  }

  const remove = async (item: Item) => {
    if (item.where === 'device') { removeDeviceNote(artifactId, item.id); refreshDevice() }
    else if (item.kind === 'personal') {
      const r = await call(`${personalUrl}?entry=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (r.status === 200) setServerNotes(personalFrom((r.body.notes as PersonalNote[]) ?? [], 'server'))
    } else {
      const r = await call(stateUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: COMMENTS_SLOT, op: 'remove', entry: item.id }) })
      if (r.status === 200) setShared(sharedFrom(r.body))
    }
    if (thread === item.id) setThread(null)
  }

  const edit = async (item: Item, body: string): Promise<string | null> => {
    const value = { ...item.value, body }
    if (item.where === 'device') { replaceDeviceNote(artifactId, item.id, value); refreshDevice(); return null }
    const r = item.kind === 'personal'
      ? await call(personalUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry: item.id, value }) })
      : await call(stateUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: COMMENTS_SLOT, op: 'replace', entry: item.id, value }) })
    if (r.status !== 200) return typeof r.body.error === 'string' ? r.body.error : 'that did not save; try again'
    if (item.kind === 'personal') setServerNotes(personalFrom((r.body.notes as PersonalNote[]) ?? [], 'server'))
    else setShared(sharedFrom(r.body))
    return null
  }

  const reply = async (parent: Item, body: string): Promise<string | null> => {
    const value: CommentValue = { anchor: parent.value.anchor, body, version, parent: parent.id }
    const r = await call(stateUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: COMMENTS_SLOT, op: 'append', value }) })
    if (r.status !== 200) return typeof r.body.error === 'string' ? r.body.error : 'that did not save; try again'
    setShared(sharedFrom(r.body))
    return null
  }

  const open = layout.placed.find((p) => p.item.id === thread)
  const openItem = open?.item ?? layout.earlier.find((i) => i.id === thread)
  const count = tops.length
  const overlay: ReactNode = mounted ? (
    <div data-comment-ui data-nospeak className="font-sans" style={theme as CSSProperties}>
      {showPins ? layout.placed.map(({ item, left, top, box }) => (
        <div key={item.id}>
          {box ? (
            <div data-comment-box={item.id} aria-hidden className="pointer-events-none absolute z-30 rounded-md border-2"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height, borderColor: accent, borderStyle: item.kind === 'personal' ? 'dashed' : 'solid', opacity: thread === item.id ? 1 : 0.55 }} />
          ) : null}
          <Pin item={item} left={left} top={top} accent={accent} ground={ground} onOpen={() => setThread(thread === item.id ? null : item.id)} />
        </div>
      )) : null}
      {chip && !draft ? (
        <button type="button" data-comment-chip className="absolute z-50 -translate-x-full rounded-full px-3 py-1 text-xs font-medium shadow-lg"
          style={{ left: chip.x, top: chip.y, background: accent, color: 'var(--a-on-accent, #111)' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setDraft(chip); setChip(null) }}>
          Comment
        </button>
      ) : null}
      {draft ? (
        <Floating x={draft.x} y={draft.y}>
          <CommentCard ownerName={ownerName} mode={comments} canShare={canShare} signedIn={signedIn && onServer} quote={draft.quote} accent={accent} signIn={signIn}
            onSave={(body, share) => saveNew(body, share, draft)} onCancel={() => setDraft(null)} />
        </Floating>
      ) : null}
      {openItem && open ? (
        <Floating x={open.left + 28} y={open.top}>
          <Thread item={openItem} replies={items.filter((i) => i.value.parent === openItem.id)} canReply={openItem.kind === 'shared' && canShare}
            accent={accent} onClose={() => setThread(null)} onRemove={remove} onEdit={edit} onReply={reply} />
        </Floating>
      ) : null}
      {drag ? (
        <div aria-hidden className="pointer-events-none fixed z-40 rounded-md border-2 border-dashed"
          style={{ left: Math.min(drag.x1, drag.x2), top: Math.min(drag.y1, drag.y2), width: Math.abs(drag.x2 - drag.x1), height: Math.abs(drag.y2 - drag.y1), borderColor: accent, background: `color-mix(in srgb, ${accent} 12%, transparent)` }} />
      ) : null}
      <div className="fixed right-4 z-40 flex flex-col items-end gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)' }}>
        {panel ? (
          <div data-comment-panel className="w-64 rounded-xl border border-[color:var(--a-line-strong)] bg-[color:var(--a-surface)] p-3 text-xs text-[color:var(--a-strong)] shadow-xl">
            <p className="opacity-80">Select any text, or hold and drag a box over anything, to leave a comment.</p>
            {isOwner ? <p data-comment-owner className="mt-1 opacity-80">This is your page: you see every comment, with the name of who left it.</p> : null}
            <button type="button" data-comment-pins-toggle className="mt-2 underline" onClick={() => setShowPins((v) => !v)}>
              {showPins ? 'Hide comments' : 'Show comments'}
            </button>
          </div>
        ) : null}
        <button type="button" data-comment-button aria-expanded={panel} onClick={() => setPanel((v) => !v)}
          className="rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur"
          style={{ borderColor: accent, color: accent, background: `color-mix(in srgb, ${ground} 85%, transparent)` }}>
          {count ? `Comments · ${count}` : 'Comment'}
        </button>
      </div>
    </div>
  ) : null

  return (
    <>
      {/* What the server decided, drawn identically on both sides so the markup hydrates. */}
      <span hidden data-comment-layer={comments} data-comment-can-share={canShare ? 'yes' : 'no'} />
      {mounted && layout.earlier.length ? (
        <section data-comments-earlier data-comment-ui data-nospeak className="mx-auto max-w-2xl px-6 pb-16 text-sm">
          <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: accent }}>Comments on earlier versions</p>
          <ul className="m-0 mt-2 grid list-none gap-3 p-0">
            {layout.earlier.map((item) => (
              <li key={item.id} className="m-0 border-l-2 py-1 pl-3" style={{ borderColor: accent, borderStyle: item.kind === 'personal' ? 'dashed' : 'solid' }}>
                {item.value.anchor.kind === 'text' ? <span className="block text-[13px] italic opacity-70">“{item.value.anchor.quote}”</span> : <span className="block text-[13px] italic opacity-70">A box on part of the page that has changed</span>}
                <span className="block whitespace-pre-wrap text-[15px] text-[color:var(--a-strong)]">{item.value.body}</span>
                <span className="block text-xs opacity-60">
                  {item.kind === 'personal' ? 'only you' : item.name}{` · version ${item.value.version}`}
                  {item.mine ? <button type="button" onClick={() => void remove(item)} className="ml-2 underline">delete</button> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  )
}

function Pin({ item, left, top, accent, ground, onOpen }: { item: Item; left: number; top: number; accent: string; ground: string; onOpen: () => void }) {
  const personal = item.kind === 'personal'
  return (
    <button type="button" data-comment-pin={item.kind} data-comment-id={item.id} onClick={onOpen}
      aria-label={personal ? 'Your personal note (only you)' : `Comment by ${item.name}`}
      className="absolute z-30 flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border-2 px-1.5 text-[10px] font-semibold shadow"
      style={{ left, top, borderColor: accent, background: personal ? ground : accent, color: personal ? accent : 'var(--a-on-accent, #111)' }}>
      {personal ? <span>only you</span> : <span aria-hidden>●</span>}
    </button>
  )
}

function Floating({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  // Kept inside the screen on a phone, where the margin a pin sits in may be the screen's edge.
  const width = typeof window === 'undefined' ? 360 : Math.min(360, window.innerWidth - 16)
  const left = typeof window === 'undefined' ? x : Math.max(window.scrollX + 8, Math.min(x, window.scrollX + window.innerWidth - width - 8))
  return <div className="absolute z-50" style={{ left, top: y }}>{children}</div>
}

function Thread({ item, replies, canReply, accent, onClose, onRemove, onEdit, onReply }: {
  item: Item; replies: Item[]; canReply: boolean; accent: string
  onClose: () => void; onRemove: (i: Item) => Promise<void>; onEdit: (i: Item, body: string) => Promise<string | null>; onReply: (i: Item, body: string) => Promise<string | null>
}) {
  const [replying, setReplying] = useState(false)
  return (
    <div data-comment-thread data-comment-ui data-nospeak className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[color:var(--a-line-strong)] bg-[color:var(--a-surface)] p-3 text-sm text-[color:var(--a-strong)] shadow-xl">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.15em]" style={{ color: accent }}>
        <span>{item.kind === 'personal' ? 'Only you' : 'Comment'}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="opacity-70 hover:opacity-100">×</button>
      </div>
      {item.value.anchor.kind === 'text' ? <p className="mb-2 line-clamp-2 border-l-2 pl-2 text-[13px] italic opacity-70" style={{ borderColor: accent }}>{item.value.anchor.quote}</p> : null}
      <Entry item={item} onRemove={onRemove} onEdit={onEdit} />
      {replies.length ? <ul className="m-0 mt-2 grid list-none gap-2 border-l pl-3 p-0">{replies.map((r) => <li key={r.id} className="m-0"><Entry item={r} onRemove={onRemove} onEdit={onEdit} /></li>)}</ul> : null}
      {canReply ? (
        replying
          ? <InlineForm label="Reply" accent={accent} onCancel={() => setReplying(false)} onSubmit={async (b) => { const e = await onReply(item, b); if (!e) setReplying(false); return e }} />
          : <button type="button" data-comment-reply onClick={() => setReplying(true)} className="mt-2 text-xs underline">Reply</button>
      ) : null}
    </div>
  )
}

function Entry({ item, onRemove, onEdit }: { item: Item; onRemove: (i: Item) => Promise<void>; onEdit: (i: Item, body: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <InlineForm label="Save" initial={item.value.body} onCancel={() => setEditing(false)} onSubmit={async (b) => { const e = await onEdit(item, b); if (!e) setEditing(false); return e }} />
  return (
    <div>
      <p className="m-0 whitespace-pre-wrap text-[15px]">{item.value.body}</p>
      <p className="m-0 text-xs opacity-60">
        {item.kind === 'personal' ? (item.where === 'device' ? 'only you, on this device' : 'only you') : item.name}
        {item.mine ? (
          <>
            <button type="button" data-comment-edit onClick={() => setEditing(true)} className="ml-2 underline">edit</button>
            <button type="button" data-comment-delete onClick={() => void onRemove(item)} className="ml-2 underline">delete</button>
          </>
        ) : null}
      </p>
    </div>
  )
}

function InlineForm({ label, initial = '', accent = 'currentColor', onSubmit, onCancel }: { label: string; initial?: string; accent?: string; onSubmit: (body: string) => Promise<string | null>; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  return (
    <form className="mt-2" onSubmit={async (e) => { e.preventDefault(); if (text.trim()) setError(await onSubmit(text.trim())) }}>
      <textarea value={text} autoFocus rows={2} onChange={(e) => setText(e.target.value)} aria-label={label}
        className="w-full rounded-lg border border-[color:var(--a-line)] bg-transparent p-2 text-[15px]" />
      {error ? <p role="alert" className="text-xs text-amber-500">{error}</p> : null}
      <div className="mt-1 flex gap-3 text-xs">
        <button type="submit" disabled={!text.trim()} className="rounded-full px-3 py-0.5 font-medium disabled:opacity-40" style={{ background: accent, color: 'var(--a-on-accent, #111)' }}>{label}</button>
        <button type="button" onClick={onCancel} className="opacity-70">Cancel</button>
      </div>
    </form>
  )
}
