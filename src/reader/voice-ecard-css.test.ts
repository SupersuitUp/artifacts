// Issue #18 (0.74.1): on a brand pack that sets its reading face on every paragraph
// (`[data-cw-maison] p { font-family: "DM Sans" }`), the letter drew in the pack's sans whatever
// `font:` said, because its paragraphs only INHERITED the card's face. Every text element the card
// sets in its face must DECLARE `--ve-face` with a selector that beats a pack's `[data-pack] p`.
import { describe, it, expect } from 'vitest'
import { VOICE_ECARD_CSS } from './voice-ecard-css.js'

/** [ids, classes + attributes + pseudo-classes, elements] of one simple compound-chain selector. */
function specificity(sel: string): [number, number, number] {
  const s = sel.replace(/::?[a-z-]+\([^)]*\)/g, '.x').replace(/::[a-z-]+/g, ' e')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+/g) ?? []).length
  const els = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[a-z-]+/g, ' ').match(/\b[a-z][a-z0-9]*\b/g) ?? []).length
  return [ids, classes, els]
}
const beats = (a: [number, number, number], b: [number, number, number]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

/** The selectors (outside @media) whose block sets font-family to the card's face. */
function faceSelectors(): string[] {
  const css = VOICE_ECARD_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/font-family:\s*var\(--ve-face\)/.test(m[2])) continue
    out.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean))
  }
  return out
}
const PACK_P = specificity('[data-cw-maison] p')

describe('the letter keeps the card\'s face on a pack that styles every paragraph (#18)', () => {
  for (const [what, el] of [
    ['the open letter\'s paragraphs', '.ve-para'],
    ['the envelope\'s peek', '.ve-preview'],
    ['the cover fallback\'s lines', '.ve-cover-fallback p'],
    ['the names', '.ve-names b'],
  ] as const) {
    it(`${what} declare --ve-face with a selector stronger than [data-pack] p`, () => {
      const key = el.split(' ').pop()!.replace(/^\./, '')
      const hits = faceSelectors().filter((s) => new RegExp(`(\\.${key}|\\b${key})$`).test(s) && s.includes(el.split(' ')[0]))
      expect(hits.length, `no rule sets ${el} in --ve-face`).toBeGreaterThan(0)
      expect(hits.some((s) => beats(specificity(s), PACK_P)), `${hits.join(' | ')} loses to [data-pack] p`).toBe(true)
    })
  }
  it('and the face is italic or upright as the card says, on the same rule', () => {
    const css = VOICE_ECARD_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => /\.ve-para\b/.test(m[1]) && /--ve-face\)/.test(m[2]))
    expect(rule?.[2]).toMatch(/font-style:\s*var\(--ve-face-style\)/)
  })
})
