// One store of a reader's own answers for one page, shared by every ask card and "Your answers". It reads
// the reader's records in the asks slot once, shows a tap at once, and puts back what was there if the hub refuses.
import { ASKS_SLOT, type AskAnswer } from '../artifacts/asks.js'

export type AskSnapshot = { loaded: boolean; mine: Record<string, AskAnswer>; error: string | null; name: string }
export const EMPTY_ASKS: AskSnapshot = { loaded: false, mine: {}, error: null, name: '' }
const nameKey = (id: string) => `artifact-name:${id}`
const readName = (id: string) => { try { return globalThis.localStorage?.getItem(nameKey(id)) ?? '' } catch { return '' } }
const keepName = (id: string, v: string) => { try { globalThis.localStorage?.setItem(nameKey(id), v) } catch { /* the name lives for this visit */ } }

export class AskStore {
  private snap: AskSnapshot = EMPTY_ASKS
  private subs = new Set<() => void>()
  private started = false
  constructor(readonly artifactId: string, private fetchImpl: typeof fetch) {}
  subscribe = (f: () => void) => { this.subs.add(f); if (!this.started) { this.started = true; if (!this.snap.name) this.snap = { ...this.snap, name: readName(this.artifactId) }; void this.load() } return () => { this.subs.delete(f) } }
  get = () => this.snap
  private set(s: AskSnapshot) { this.snap = s; for (const f of this.subs) f() }
  private url() { return `/api/artifacts/${this.artifactId}/state` }
  private async load() {
    try {
      const r = await this.fetchImpl(this.url(), { credentials: 'same-origin', cache: 'no-store' })
      const rows = ((await r.json())?.slots?.[ASKS_SLOT]?.mine ?? []) as { value: AskAnswer }[]
      const mine: Record<string, AskAnswer> = { ...this.snap.mine }
      for (const row of rows) if (!this.snap.mine[row.value.ask]) mine[row.value.ask] = row.value // oldest first: the last one stands
      this.set({ ...this.snap, loaded: true, mine, error: null })
    } catch { this.set({ ...this.snap, loaded: true, error: 'Your answers could not be read. Reload the page to try again.' }) }
  }
  /** The reader's first name on a group link: one value every card on the page reads. */
  setName = (v: string) => { keepName(this.artifactId, v.trim()); this.set({ ...this.snap, name: v }) }
  async answer(a: AskAnswer): Promise<boolean> {
    const before = this.snap
    this.set({ ...before, mine: { ...before.mine, [a.ask]: a }, error: null })
    const r = await this.fetchImpl(this.url(), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: ASKS_SLOT, op: 'append', value: a }) }).catch(() => null)
    if (r?.ok) return true
    const why = r ? ((await r.json().catch(() => ({}))) as { error?: string }).error : undefined
    this.set({ ...before, error: why ?? 'That answer did not reach the page. Try again.' })
    return false
  }
}

const stores = new Map<string, AskStore>()
export function askStoreFor(artifactId: string, fetchImpl?: typeof fetch): AskStore {
  if (fetchImpl) stores.set(artifactId, new AskStore(artifactId, fetchImpl))
  if (!stores.has(artifactId)) stores.set(artifactId, new AskStore(artifactId, (...a) => fetch(...a)))
  return stores.get(artifactId)!
}
