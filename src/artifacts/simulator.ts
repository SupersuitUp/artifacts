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
// (ArtifactRoutesConfig.simulatorEmbed / messagesEmbed / figureEmbed / helmEmbed), so this public package points at nobody's
// service by default, and a host without the player draws the caption alone rather than the block's
// source as code. `simulator` keeps the syntax the Superskills book's reader takes.
//
// A FRAME THAT FITS (0.39.0). `height:` is the height a frame OPENS at, and the room its player is
// given. A session demo draws a different device for each viewer (a short laptop on a desktop, a
// tall phone on a phone), so no one height suits both: the frame asked its embed page `fit=content`,
// and a page that understands posts `{ type: 'embed:fit', height: <px> }` to its parent, which the
// frame then takes (EmbedFrame). A page that posts nothing keeps the block's height. The embed
// page must hold its player's size once asked, never size it from its own viewport, or the two
// chase each other; that is why the frame listens only for this message and for no player's own.

//
// FIGURES AND THE HELM. Two more kinds on the same mechanism, for books:
//
//   ```figure                          ```helm
//   figure: doug-week                  scene: doug-walk
//   caption: A week of Doug ...        caption: A year later ...
//   height: 560px      # optional      height: 760px        # optional
//   ```                                autoplay: true       # optional, true or false
//                                      ```
//
// `figure` is an interactive figure, `helm` a scene played on a Helm phone. A kind is one row of
// KINDS: the key that names what to open, whether it is required, its default height, the switches
// every frame of it carries, and any further keys it takes (`options`), each with the values it
// allows. An option reaches the embed page only when it is not its kind's `off` value, so a block
// saying `autoplay: false` loads the same address as one that says nothing.

export type EmbedKind = 'simulator' | 'messages' | 'figure' | 'helm'
type Option = { values: readonly string[]; off: string }
type Spec = { key: string; required: boolean; fixed: Record<string, string>; height: string; options?: Record<string, Option> }
const BOOL: Option = { values: ['true', 'false'], off: 'false' }
const KINDS: Record<EmbedKind, Spec> = {
  simulator: { key: 'scenario', required: true, fixed: { timeline: 'off', fit: 'content' }, height: '720px' },
  messages: { key: 'chat', required: false, fixed: {}, height: '760px' },
  figure: { key: 'figure', required: true, fixed: { fit: 'content' }, height: '560px' },
  helm: { key: 'scene', required: true, fixed: { fit: 'content' }, height: '760px', options: { autoplay: BOOL } },
}
export const EMBED_KINDS = Object.keys(KINDS) as EmbedKind[]
export const isEmbedKind = (k: unknown): k is EmbedKind => typeof k === 'string' && Object.hasOwn(KINDS, k)

/** `options` holds a kind's further keys (helm's `autoplay`) as written, and is absent when none were. */
export type EmbedBlock = { value: string | null; caption: string; height: string; options?: Record<string, string> }
export type SimulatorBlock = { scenario: string; caption: string; height: string }

const ID = /^[a-z0-9-]+$/
const HEIGHT = /^\d{3,4}px$/

/** Parses an embed fence's body. `line` is the line the fence opens on, so every error names the
 *  line the author sees. */
export function parseEmbedFence(kind: EmbedKind, value: string, line: number):
  { ok: true; block: EmbedBlock } | { ok: false; error: string } {
  const spec = KINDS[kind]
  const opts = spec.options ?? {}
  const keys = [spec.key, 'caption', 'height', ...Object.keys(opts)]
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
  const options: Record<string, string> = {}
  for (const [name, o] of Object.entries(opts)) {
    const g = got[name]
    if (!g) continue
    if (!o.values.includes(g.v)) return { ok: false, error: `line ${g.at}: a ${kind} ${name} is ${o.values.join(' or ')}` }
    options[name] = g.v
  }
  const block: EmbedBlock = { value: id?.v ?? null, caption: got.caption.v, height: got.height?.v ?? spec.height }
  if (Object.keys(options).length) block.options = options
  return { ok: true, block }
}

/** The address a player loads: the host's embed page, what to open, any fixed switches. Null for an
 *  embed address that is not https, so a misconfigured host frames nothing. */
export function embedSrc(kind: EmbedKind, embed: string, value: string | null, options?: Record<string, string>): string | null {
  let u: URL
  try { u = new URL(embed) } catch { return null }
  if (u.protocol !== 'https:') return null
  const spec = KINDS[kind]
  if (value) u.searchParams.set(spec.key, value)
  for (const [name, o] of Object.entries(spec.options ?? {})) {
    const v = options?.[name]
    if (v && v !== o.off && o.values.includes(v)) u.searchParams.set(name, v)
  }
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

/** The message an embed page sends its frame, and the heights a frame will take. */
export const FIT_MESSAGE = 'embed:fit'
export const FIT_MIN = 240
export const FIT_MAX = 2000

/** The height (px) a frame takes from a message, or null: only `embed:fit` with a finite number,
 *  only from the origin of the page the frame loaded, and never outside FIT_MIN..FIT_MAX. */
export function fitFrom(data: unknown, origin: string, src: string): number | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { type?: unknown; height?: unknown }
  if (d.type !== FIT_MESSAGE || typeof d.height !== 'number' || !Number.isFinite(d.height)) return null
  let expected: string
  try { expected = new URL(src).origin } catch { return null }
  if (origin !== expected) return null
  return Math.max(FIT_MIN, Math.min(FIT_MAX, Math.ceil(d.height)))
}
