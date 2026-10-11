// Embedded players: fenced blocks that play a host-named page inline, in a frame.
//
//   ```simulator                       ```messages
//   scenario: diane-meeting-prep       chat: fritz          # optional: open on one chat
//   caption: Step into the hour ...    caption: Fritz, in his own words.
//   height: 760px      # optional      height: 760px        # optional, default 760px (simulator 720px)
//   ```                                ```
//
// `simulator` is a Supersuit Session demo; `messages` is a Messages-app phone of real threads. The
// block names what to open and a caption; the HOST names each player's embed page
// (ArtifactRoutesConfig.simulatorEmbed / messagesEmbed), so this public package points at nobody's
// service by default, and a host without the player draws the caption alone rather than the block's
// source as code. `simulator` keeps the syntax the Superskills book's reader takes.

export type EmbedKind = 'simulator' | 'messages'
type Spec = { key: string; required: boolean; fixed: Record<string, string>; height: string }
const KINDS: Record<EmbedKind, Spec> = {
  simulator: { key: 'scenario', required: true, fixed: { timeline: 'off' }, height: '720px' },
  messages: { key: 'chat', required: false, fixed: {}, height: '760px' },
}
export const EMBED_KINDS = Object.keys(KINDS) as EmbedKind[]
export const isEmbedKind = (k: unknown): k is EmbedKind => typeof k === 'string' && Object.hasOwn(KINDS, k)

export type EmbedBlock = { value: string | null; caption: string; height: string }
export type SimulatorBlock = { scenario: string; caption: string; height: string }

const ID = /^[a-z0-9-]+$/
const HEIGHT = /^\d{3,4}px$/

/** Parses an embed fence's body. `line` is the line the fence opens on, so every error names the
 *  line the author sees. */
export function parseEmbedFence(kind: EmbedKind, value: string, line: number):
  { ok: true; block: EmbedBlock } | { ok: false; error: string } {
  const spec = KINDS[kind]
  const keys = [spec.key, 'caption', 'height']
  const got: Record<string, { v: string; at: number }> = {}
  const rows = value ? value.split('\n') : []
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].trim()
    if (!raw || raw.startsWith('#')) continue
    const at = line + 1 + i
    const m = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(raw)
    if (!m) return { ok: false, error: `line ${at}: the ${kind} block takes lines like "${spec.key}: <id>"` }
    if (!keys.includes(m[1])) return { ok: false, error: `line ${at}: the ${kind} block has an unknown key: ${m[1]}` }
    got[m[1]] = { v: m[2].replace(/\s+#.*$/, '').trim(), at }
  }
  const id = got[spec.key]
  if (!id && spec.required) return { ok: false, error: `line ${line}: the ${kind} block needs a ${spec.key}` }
  if (id && !ID.test(id.v)) return { ok: false, error: `line ${id.at}: a ${kind} ${spec.key} is lowercase letters, digits and dashes` }
  if (!got.caption?.v) return { ok: false, error: `line ${line}: the ${kind} block needs a caption, the line a reader sees under it` }
  if (got.height && !HEIGHT.test(got.height.v)) return { ok: false, error: `line ${got.height.at}: a ${kind} height is a number of pixels, like 760px` }
  return { ok: true, block: { value: id?.v ?? null, caption: got.caption.v, height: got.height?.v ?? spec.height } }
}

/** The address a player loads: the host's embed page, what to open, any fixed switches. Null for an
 *  embed address that is not https, so a misconfigured host frames nothing. */
export function embedSrc(kind: EmbedKind, embed: string, value: string | null): string | null {
  let u: URL
  try { u = new URL(embed) } catch { return null }
  if (u.protocol !== 'https:') return null
  const spec = KINDS[kind]
  if (value) u.searchParams.set(spec.key, value)
  for (const [k, v] of Object.entries(spec.fixed)) u.searchParams.set(k, v)
  return u.toString()
}

/** The ```simulator block (kept for callers of 0.25.0). */
export function parseSimulatorFence(value: string, line: number):
  { ok: true; block: SimulatorBlock } | { ok: false; error: string } {
  const r = parseEmbedFence('simulator', value, line)
  return r.ok ? { ok: true, block: { scenario: r.block.value as string, caption: r.block.caption, height: r.block.height } } : r
}
export const simulatorSrc = (embed: string, scenario: string) => embedSrc('simulator', embed, scenario)
