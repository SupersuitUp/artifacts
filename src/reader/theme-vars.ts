// Anything the reader portals onto document.body leaves the wrapper that sets the page's theme,
// so it has to carry the theme with it. One helper for every portal (comment overlay, definition
// sheet, version history).
/** The page's theme variables (`--a-*`) as they resolve around `el`. Computed style covers variables set by a stylesheet (the `system` mode's media
 *  query); the inline walk covers engines that do not list custom properties in computed style. */
export function themeVarsAround(el: Element | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!el) return out
  const cs = getComputedStyle(el)
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i]
    if (name.startsWith('--a-')) { const v = cs.getPropertyValue(name).trim(); if (v) out[name] = v }
  }
  for (let n: Element | null = el; n; n = n.parentElement) {
    const st = (n as HTMLElement).style
    if (!st) continue
    for (let i = 0; i < st.length; i++) {
      const name = st[i]
      if (name.startsWith('--a-') && !(name in out)) { const v = st.getPropertyValue(name).trim(); if (v) out[name] = v }
    }
  }
  return out
}
