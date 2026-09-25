// What a page lets readers put into it. Declared in front matter under `state:`; read by the
// state routes on every request, so changing the rules is a republish and nothing else.
//
// A SLOT is a named place readers write. `one` keeps one value per reader (a vote, a form, a
// tool's saved state); `many` keeps an append-only list per reader (notes). A write to a slot
// the page did not declare is refused, which is what keeps a page from becoming free storage.
export type Shape = 'one' | 'many'
export type Visibility = 'private' | 'tally' | 'shared'
export type Writers = 'signed-in' | 'anyone'
export type SlotDef = { shape: Shape; visibility?: Visibility }
export type StateConfig = { writers: Writers; visibility: Visibility; slots: Record<string, SlotDef> }

export const SLOT_NAME = /^[a-z][a-z0-9-]{0,39}$/
export const MAX_VALUE_BYTES = 8 * 1024
export const MAX_MANY_PER_READER = 200
export const ANON_WRITES_PER_MINUTE = 30
/** Every reader's answers together, per page per slot. A new answer past it is refused; a reader
 *  replacing their own `one` answer is not, because that adds nothing. */
export const MAX_ENTRIES_PER_SLOT = 2000
/** A `shared` slot shows readers only its newest entries, so one busy page cannot make every read
 *  ship its whole history. Tallies still count everything. */
export const SHARED_LIMIT = 100

const VISIBILITIES: readonly Visibility[] = ['private', 'tally', 'shared']
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseStateConfig(raw: unknown): { ok: true; state: StateConfig } | { ok: false; error: string } {
  if (!isMap(raw)) return { ok: false, error: 'state must be a map' }
  for (const k of Object.keys(raw)) if (!['writers', 'visibility', 'slots'].includes(k)) return { ok: false, error: `state has an unknown key: ${k}` }
  const writers = raw.writers ?? 'signed-in'
  if (writers !== 'signed-in' && writers !== 'anyone') return { ok: false, error: 'state.writers must be signed-in or anyone' }
  const visibility = raw.visibility ?? 'private'
  if (!VISIBILITIES.includes(visibility as Visibility)) return { ok: false, error: `state.visibility must be one of: ${VISIBILITIES.join(', ')}` }
  const slots: Record<string, SlotDef> = {}
  const rawSlots = raw.slots ?? {}
  if (!isMap(rawSlots)) return { ok: false, error: 'state.slots must be a map' }
  for (const [name, def] of Object.entries(rawSlots)) {
    if (!SLOT_NAME.test(name)) return { ok: false, error: `slot name "${name}" must be lowercase letters, digits and dashes, starting with a letter` }
    if (!isMap(def)) return { ok: false, error: `slot "${name}" needs shape one or many` }
    for (const k of Object.keys(def)) if (k !== 'shape' && k !== 'visibility') return { ok: false, error: `slot "${name}" has an unknown key: ${k}` }
    if (def.shape !== 'one' && def.shape !== 'many') return { ok: false, error: `slot "${name}" needs shape one or many` }
    if (def.visibility !== undefined && !VISIBILITIES.includes(def.visibility as Visibility))
      return { ok: false, error: `slot "${name}" visibility must be one of: ${VISIBILITIES.join(', ')}` }
    slots[name] = { shape: def.shape, ...(def.visibility ? { visibility: def.visibility as Visibility } : {}) }
  }
  return { ok: true, state: { writers, visibility: visibility as Visibility, slots } }
}

/** A gated page's readers are always signed in, so its state is too, whatever the file says. */
export function effectiveWriters(state: StateConfig, access?: string): Writers {
  return access ? 'signed-in' : state.writers
}

export function slotVisibility(state: StateConfig, slot: string): Visibility {
  return state.slots[slot]?.visibility ?? state.visibility
}

function isJson(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every(isJson)
  if (isMap(v)) return Object.values(v).every(isJson)
  return false
}

export function checkValue(value: unknown): string | null {
  if (value === undefined) return 'value is required'
  if (!isJson(value)) return 'value must be JSON'
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_VALUE_BYTES) return 'value is over 8 KB'
  return null
}

/** Answers are kept across a republish, so a slot may never change what shape its data is. */
export function shapeChanges(prev: StateConfig | undefined, next: StateConfig | undefined): string[] {
  if (!prev || !next) return []
  const out: string[] = []
  for (const [name, def] of Object.entries(next.slots)) {
    const was = prev.slots[name]
    if (was && was.shape !== def.shape) out.push(`slot "${name}" changed shape from ${was.shape} to ${def.shape}; rename the slot instead`)
  }
  return out
}
