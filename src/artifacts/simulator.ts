// The ```simulator fence: a Supersuit Session demo played inline on the page. The block names a
// scenario and a caption; the HOST names the demo's embed page (ArtifactRoutesConfig.simulatorEmbed),
// so this public package points at nobody's service by default, and a host without a demo draws
// the caption alone rather than the block's source as code.
//
//   ```simulator
//   scenario: diane-meeting-prep
//   caption: Step into the hour before Diane's first meeting. Press Start.
//   height: 760px            # optional, default 720px
//   ```
//
// The same syntax the Superskills book's reader takes, so one block works in both.

export type SimulatorBlock = { scenario: string; caption: string; height: string }

const SCENARIO = /^[a-z0-9-]+$/
const HEIGHT = /^\d{3,4}px$/
const KEYS = ['scenario', 'caption', 'height'] as const

/** Parses a simulator fence's body. `line` is the line the fence opens on, so every error names
 *  the line the author sees. */
export function parseSimulatorFence(value: string, line: number):
  { ok: true; block: SimulatorBlock } | { ok: false; error: string } {
  const got: Partial<Record<(typeof KEYS)[number], { v: string; at: number }>> = {}
  const rows = value ? value.split('\n') : []
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].trim()
    if (!raw || raw.startsWith('#')) continue
    const at = line + 1 + i
    const m = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(raw)
    if (!m) return { ok: false, error: `line ${at}: the simulator block takes lines like "scenario: <id>"` }
    const key = m[1] as (typeof KEYS)[number]
    if (!KEYS.includes(key)) return { ok: false, error: `line ${at}: the simulator block has an unknown key: ${m[1]}` }
    got[key] = { v: m[2].replace(/\s+#.*$/, '').trim(), at }
  }
  if (!got.scenario) return { ok: false, error: `line ${line}: the simulator block needs a scenario` }
  if (!SCENARIO.test(got.scenario.v)) return { ok: false, error: `line ${got.scenario.at}: a simulator scenario is lowercase letters, digits and dashes` }
  if (!got.caption?.v) return { ok: false, error: `line ${line}: the simulator block needs a caption, the line a reader sees under the demo` }
  if (got.height && !HEIGHT.test(got.height.v)) return { ok: false, error: `line ${got.height.at}: a simulator height is a number of pixels, like 760px` }
  return { ok: true, block: { scenario: got.scenario.v, caption: got.caption.v, height: got.height?.v ?? '720px' } }
}

/** The address the player loads: the host's embed page, the scenario, the timeline off. Null for
 *  an embed address that is not https, so a misconfigured host frames nothing. */
export function simulatorSrc(embed: string, scenario: string): string | null {
  let u: URL
  try { u = new URL(embed) } catch { return null }
  if (u.protocol !== 'https:') return null
  u.searchParams.set('scenario', scenario)
  u.searchParams.set('timeline', 'off')
  return u.toString()
}
