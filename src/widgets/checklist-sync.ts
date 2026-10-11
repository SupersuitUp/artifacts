'use client'
// The shared set behind a page whose checklists `sync`: one store per page, held by every
// checklist block on it, because item ids are page-wide and the host keeps ONE set for the page
// (the shared `one` slot `checklist`, where each writer's latest set is an entry).
//
// The newest entry by its server time is the page's set. A tick updates the screen at once and,
// after a short pause, posts the WHOLE page-wide set; a poll every few seconds while the tab is
// visible brings in the other readers' ticks. Concurrency is last-write-wins on the whole set: two
// people ticking different items inside the same couple of seconds can lose one of the two ticks.
// That is accepted for a list two people walk through together; a per-item merge would need the
// host to keep per-item state, which this version does not.
//
// A host that keeps no answers (501), a page that takes none (404), or a first read that fails
// drops the store to `local`: ticks live in localStorage exactly as an unsynced checklist's do.
import { CHECKLIST_SLOT, checklistStorageKey } from '../artifacts/checklist.js'

export type SyncStatus = 'loading' | 'synced' | 'saving' | 'error' | 'sign-in' | 'local'
export type SyncSnapshot = { done: ReadonlySet<string>; status: SyncStatus; message?: string; signIn?: string | null }

export const SYNC_POLL_MS = 4000
export const SYNC_SAVE_DELAY_MS = 400
const RETRY_MS = 5000

type Shared = { value?: unknown; at?: unknown }

/** The page's set from a state answer: the newest shared entry's `done`, or null when the answer
 *  carries no checklist slot. An empty slot is an empty set. */
export function latestSharedDone(body: unknown): string[] | null {
  const slot = (body as { slots?: Record<string, { shared?: Shared[] }> } | null)?.slots?.[CHECKLIST_SLOT]
  if (!slot) return null
  let best: Shared | null = null
  for (const e of slot.shared ?? []) if (typeof e?.at === 'string' && (!best || e.at > (best.at as string))) best = e
  const done = (best?.value as { done?: unknown } | undefined)?.done
  return Array.isArray(done) ? done.filter((d): d is string => typeof d === 'string') : []
}

function readLocal(artifactId: string, id: string): boolean {
  try {
    return globalThis.localStorage?.getItem(checklistStorageKey(artifactId, id)) === '1'
  } catch {
    return false
  }
}
function writeLocal(artifactId: string, id: string, on: boolean) {
  try {
    if (on) globalThis.localStorage?.setItem(checklistStorageKey(artifactId, id), '1')
    else globalThis.localStorage?.removeItem(checklistStorageKey(artifactId, id))
  } catch {
    // Storage blocked: the tick lives for this visit only.
  }
}

class SyncStore {
  private blocks = new Map<object, readonly string[]>()
  private done = new Set<string>()
  private status: SyncStatus = 'loading'
  private message?: string
  private signIn?: string | null
  private snap: SyncSnapshot
  private listeners = new Set<() => void>()
  private dirty = false
  private inflight = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private onVisible = () => { if (this.visible()) void this.pull() }

  constructor(private artifactId: string) {
    this.snap = this.make()
  }

  private make(): SyncSnapshot {
    return { done: new Set(this.done), status: this.status, ...(this.message ? { message: this.message } : {}), ...(this.signIn !== undefined ? { signIn: this.signIn } : {}) }
  }
  private emit() {
    this.snap = this.make()
    for (const l of this.listeners) l()
  }
  private set(status: SyncStatus, message?: string, signIn?: string | null) {
    this.status = status
    this.message = message
    this.signIn = signIn
  }
  private visible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }
  private url() {
    return `/api/artifacts/${this.artifactId}/state`
  }
  /** Every id a checklist on the page draws. A set from an earlier version can name an item the
   *  page no longer has, and the server refuses a set naming one, so only these are posted. */
  private known(): Set<string> {
    const out = new Set<string>()
    for (const ids of this.blocks.values()) for (const id of ids) out.add(id)
    return out
  }

  snapshot = () => this.snap

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  register(block: object, ids: readonly string[]) {
    // Back in the map after a stop (React's strict mode unmounts and remounts once).
    if (!stores.has(this.artifactId)) stores.set(this.artifactId, this)
    this.blocks.set(block, ids)
    if (this.status === 'local') {
      for (const id of ids) if (readLocal(this.artifactId, id)) this.done.add(id)
      this.emit()
    }
    if (this.blocks.size === 1) this.start()
  }

  unregister(block: object) {
    this.blocks.delete(block)
    if (this.blocks.size === 0) this.stop()
  }

  private start() {
    void this.pull()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible)
    this.pollTimer = setInterval(() => { if (this.visible()) void this.pull() }, SYNC_POLL_MS)
  }

  private stop() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.pollTimer = this.saveTimer = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible)
    stores.delete(this.artifactId)
  }

  private toLocal() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.done = new Set([...this.known()].filter((id) => readLocal(this.artifactId, id)))
    this.set('local')
    this.emit()
  }

  /** Read the page's set. Skipped while this reader has a change not yet saved, so a poll can
   *  never take back a tick the reader just made. */
  async pull() {
    if (this.status === 'local' || this.dirty || this.inflight) return
    let r: Response
    try {
      r = await fetch(this.url(), { credentials: 'same-origin', cache: 'no-store' })
    } catch {
      if (this.status === 'loading') return this.toLocal()
      this.set('error', 'offline; will retry')
      return this.emit()
    }
    if (r.status === 501 || r.status === 404) return this.toLocal()
    const body: unknown = await r.json().catch(() => null)
    if (!r.ok) {
      if (this.status === 'loading') return this.toLocal()
      this.set('error', 'could not read the shared list; will retry')
      return this.emit()
    }
    const done = latestSharedDone(body)
    if (done === null) return this.toLocal()
    if (this.dirty || this.inflight) return
    this.done = new Set(done)
    if (this.status !== 'sign-in') this.set('synced')
    this.emit()
  }

  toggle(id: string) {
    const on = !this.done.has(id)
    if (on) this.done.add(id)
    else this.done.delete(id)
    writeLocal(this.artifactId, id, on)
    if (this.status === 'local') return this.emit()
    this.dirty = true
    this.set('saving')
    this.emit()
    this.schedule(SYNC_SAVE_DELAY_MS)
  }

  private schedule(ms: number) {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.push() }, ms)
  }

  /** Post the whole page-wide set. Last write wins on the whole set (see the top of this file). */
  async push() {
    if (this.inflight || !this.dirty) return
    this.inflight = true
    this.dirty = false
    const known = this.known()
    const done = [...this.done].filter((id) => known.has(id))
    type Body = { error?: unknown; signIn?: unknown } | null
    let r: Response | null = null
    let body = null as Body
    try {
      r = await fetch(this.url(), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: CHECKLIST_SLOT, op: 'set', value: { done } }),
      })
      body = (await r.json().catch(() => null)) as Body
    } catch {
      r = null
    }
    this.inflight = false
    if (r?.ok) {
      if (this.dirty) return this.schedule(SYNC_SAVE_DELAY_MS)
      const latest = latestSharedDone(body)
      if (latest) this.done = new Set(latest)
      this.set('synced')
    } else if (r?.status === 401) {
      this.set('sign-in', undefined, typeof body?.signIn === 'string' ? body.signIn : null)
    } else if (r && r.status >= 400 && r.status < 500 && r.status !== 429) {
      this.set('error', typeof body?.error === 'string' ? body.error : 'that tick did not save')
    } else {
      // Offline, rate-limited or a server error: keep the tick and try again shortly.
      this.dirty = true
      this.set('error', 'not saved yet; retrying')
      this.schedule(RETRY_MS)
    }
    this.emit()
  }
}

const stores = new Map<string, SyncStore>()

/** The one store for a page, shared by every checklist block on it. */
export function syncStoreFor(artifactId: string): SyncStore {
  let s = stores.get(artifactId)
  if (!s) stores.set(artifactId, (s = new SyncStore(artifactId)))
  return s
}

export const SERVER_SYNC_SNAPSHOT: SyncSnapshot = { done: new Set(), status: 'loading' }
