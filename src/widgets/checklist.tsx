'use client'
// The checklist widget in the reader's browser. Each tick is kept in localStorage under the page
// and the item id (checklist.ts, checklistStorageKey), so it survives a reload, a republish and a
// reworded item, and never leaves the device unless the reader presses Send. Storage that throws
// (a private window, blocked site data) costs the reader only the memory: ticks still work for
// the visit.
//
// The item text and description arrive already drawn on the server, as markdown with raw HTML
// escaped, so this file draws no author content itself. Everything here is data-nospeak: the
// narrator reads the prose, never the checklist.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CHECKLIST_SLOT, checklistStorageKey, type SendWriters } from '../artifacts/checklist.js'

export type ChecklistViewItem = { id: string; title: ReactNode; description: ReactNode | null }

function readTick(key: string | null): boolean {
  if (!key) return false
  try {
    return globalThis.localStorage?.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeTick(key: string | null, on: boolean) {
  if (!key) return
  try {
    if (on) globalThis.localStorage?.setItem(key, '1')
    else globalThis.localStorage?.removeItem(key)
  } catch {
    // Storage blocked: the tick lives for this visit only.
  }
}

type SendState = { status: 'idle' | 'busy' | 'sent' | 'error' | 'sign-in'; message?: string; signIn?: string | null }

export function Checklist({
  items,
  artifactId,
  send,
  owner,
  accent,
}: {
  items: ChecklistViewItem[]
  /** The page, for the storage key. Without one (a past version) ticks last for the visit. */
  artifactId?: string
  /** Who may press Send, when the page offers it and the host keeps answers. */
  send?: SendWriters
  owner?: string
  accent?: string
}) {
  const key = useCallback((id: string) => (artifactId ? checklistStorageKey(artifactId, id) : null), [artifactId])
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [sent, setSent] = useState<SendState>({ status: 'idle' })

  // Read after mount, never during render: the server has no storage, and reading it while
  // hydrating would draw a page that disagrees with the server's.
  const ids = items.map((it) => it.id).join('\n')
  useEffect(() => {
    const next: Record<string, boolean> = {}
    for (const id of ids.split('\n')) if (readTick(key(id))) next[id] = true
    setDone(next)
  }, [ids, key])

  const toggle = (id: string) => {
    setDone((d) => {
      const on = !d[id]
      writeTick(key(id), on)
      const next = { ...d }
      if (on) next[id] = true
      else delete next[id]
      return next
    })
    setSent((s) => (s.status === 'sent' ? { status: 'idle' } : s))
  }

  const count = items.filter((it) => done[it.id]).length
  const color = accent ?? 'var(--a-accent)'

  const doSend = async () => {
    if (!artifactId) return
    setSent({ status: 'busy' })
    try {
      const r = await fetch(`/api/artifacts/${artifactId}/state`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: CHECKLIST_SLOT, op: 'set', value: { done: items.filter((it) => done[it.id]).map((it) => it.id) } }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: unknown; signIn?: unknown }
      if (r.ok) setSent({ status: 'sent' })
      else if (r.status === 401) setSent({ status: 'sign-in', signIn: typeof body.signIn === 'string' ? body.signIn : null })
      else setSent({ status: 'error', message: typeof body.error === 'string' ? body.error : 'that did not send; try again' })
    } catch {
      setSent({ status: 'error', message: 'that did not reach the page; try again' })
    }
  }

  return (
    <div data-nospeak data-artifact-checklist className="my-6 rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-surface)]">
      <p
        data-checklist-count
        aria-live="polite"
        className="m-0 border-b border-[color:var(--a-line)] px-4 py-2 text-[11px] uppercase tracking-[0.2em]"
        style={{ color }}
      >
        {`${count} of ${items.length} done`}
      </p>
      <ul className="m-0 list-none p-0">
        {items.map((it) => {
          const on = !!done[it.id]
          const inputId = `checklist-${artifactId ?? 'page'}-${it.id}`
          return (
            <li key={it.id} data-checklist-item={it.id} data-done={on ? 'yes' : 'no'} className="m-0 border-b border-[color:var(--a-line)] px-4 py-1 last:border-b-0">
              {/* The whole row is the target: at least 44px tall, as a phone's thumb needs. The sizes
                  that make it a target are inline, so they hold on a host whose CSS build never
                  scanned this package's classes. */}
              <label htmlFor={inputId} className="flex cursor-pointer items-start gap-3 py-2" style={{ minHeight: 44 }}>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(it.id)}
                  className="mt-0.5 shrink-0 cursor-pointer"
                  style={{ accentColor: color, width: 24, height: 24 }}
                />
                <span className={on ? 'text-[color:var(--a-muted)] line-through' : 'text-[color:var(--a-strong)]'}>{it.title}</span>
              </label>
              {it.description ? <div className="pb-2 pl-9 text-[15px] text-[color:var(--a-body)]">{it.description}</div> : null}
            </li>
          )
        })}
      </ul>
      {send && artifactId ? (
        <div className="border-t border-[color:var(--a-line)] px-4 py-3">
          <button
            type="button"
            data-checklist-send
            disabled={sent.status === 'busy'}
            onClick={() => void doSend()}
            className="rounded-full px-5 text-sm font-medium disabled:opacity-40"
            style={{ background: color, color: 'var(--a-on-accent, #111)', minHeight: 44 }}
          >
            {owner ? `Send my progress to ${owner}` : 'Send my progress'}
          </button>
          {sent.status === 'sent' ? <p data-checklist-sent className="mt-2 text-sm opacity-80">{`Sent: ${count} of ${items.length} done.`}</p> : null}
          {sent.status === 'error' ? <p className="mt-2 text-sm text-amber-500">{sent.message}</p> : null}
          {sent.status === 'sign-in' ? (
            sent.signIn ? (
              <p className="mt-2 text-sm"><a href={sent.signIn} className="underline" style={{ color }}>Sign in to send</a></p>
            ) : (
              <p className="mt-2 text-sm opacity-70">Sending is open to signed-in readers.</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
