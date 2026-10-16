import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { freedomDefault, type BrandPack } from './pack.js'
import { BrandGround, BrandMark } from './wrapper.js'
import { GLOW_PASTELS } from './backdrop.js'

describe('brand packs', () => {
  it('the default pack renders a flat ground and a rule for its mark, never a dove', () => {
    const out = renderToStaticMarkup(
      <BrandGround pack={freedomDefault}>
        <BrandMark pack={freedomDefault} />
        <p>hi</p>
      </BrandGround>,
    )
    expect(out).toContain('data-brand-ground="freedom-default"')
    expect(out).toContain('data-brand-mark="freedom-default"')
    expect(out).not.toContain('🕊')   // no bird or figure stands in for the agent
    expect(out).toContain('hi')
  })
  it('a pack with its own components is used instead', () => {
    const pack: BrandPack = {
      ...freedomDefault,
      id: 'custom',
      Wrapper: ({ children }) => <section data-custom-wrapper>{children}</section>,
      Mark: () => <svg data-custom-mark />,
    }
    const out = renderToStaticMarkup(
      <BrandGround pack={pack}>
        <BrandMark pack={pack} />
      </BrandGround>,
    )
    expect(out).toContain('data-custom-wrapper')
    expect(out).toContain('data-custom-mark')
    expect(out).not.toContain('🕊')
  })
  it('the ground carries the mode and the stylesheet that defines it', () => {
    const out = renderToStaticMarkup(<BrandGround pack={{ ...freedomDefault, mode: 'light' }}><p>hi</p></BrandGround>)
    expect(out).toContain('data-artifact-theme="light"')
    expect(out).toContain('--a-ground:#e8e0d2')
    expect(out).toContain('background:var(--a-ground)')
    const sys = renderToStaticMarkup(<BrandGround pack={freedomDefault} mode="system"><p>hi</p></BrandGround>)
    expect(sys).toContain('data-artifact-theme="system"')
  })
  it('a wrapper pack still gets the variables, without a second ground', () => {
    const pack: BrandPack = { ...freedomDefault, id: 'w', Wrapper: ({ children }) => <section data-w>{children}</section> }
    const out = renderToStaticMarkup(<BrandGround pack={pack}><p>hi</p></BrandGround>)
    expect(out).toContain('data-artifact-theme="dark"')
    expect(out).toContain('display:contents')
    expect(out).toContain('data-w')
  })
  it('bubbles draw behind the page, and hold still for readers who ask for less motion', () => {
    const out = renderToStaticMarkup(
      <BrandGround pack={{ ...freedomDefault, backdrop: { kind: 'bubbles', colors: ['1,2,3', '4,5,6'] } }}><p>hi</p></BrandGround>,
    )
    expect(out).toContain('data-artifact-backdrop="bubbles"')
    expect(out).toContain('rgba(1,2,3,')
    expect(out).toContain('prefers-reduced-motion')
    expect(out.indexOf('data-artifact-backdrop')).toBeLessThan(out.indexOf('hi'))
    expect(renderToStaticMarkup(<BrandGround pack={freedomDefault}><p /></BrandGround>)).not.toContain('data-artifact-backdrop')
  })
  it('bubbles animate on the compositor only: no blur or blend over the whole screen', () => {
    const out = renderToStaticMarkup(<BrandGround pack={{ ...freedomDefault, backdrop: { kind: 'bubbles' } }}><p /></BrandGround>)
    expect(out).not.toMatch(/style="[^"]*filter:\s*blur/)
    expect(out).not.toContain('mix-blend-mode')
    expect(out).toMatch(/\.a-bubble\{[^}]*filter:blur\(40px\)[^}]*will-change:transform/)
    expect(out.match(/class="a-bubble"/g)?.length).toBe(GLOW_PASTELS.length)
  })
})

// THE DEFAULT LOOK IS THE MAISON (0.49.0): Supersuit's own, the house look of its maker. Every colour
// is one of the house's seven tokens or a mix of two, the type is the house pair, and what a reader
// sees says Supersuit (the export keeps its old name so no host breaks).
describe('the default look', () => {
  const MAISON = ['#17171a', '#2e2119', '#e8e0d2', '#f4f1ec', '#a8834f', '#1c1a17', '#d8d1c4']
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  // A value is a hex or a two-token color-mix(); resolve it the way a browser does.
  const resolve = (v: string) => {
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
    const m = /^color-mix\(in srgb,(#[0-9a-f]{6}) ([\d.]+)%,(#[0-9a-f]{6})\)$/i.exec(v)
    if (!m) throw new Error(`${v} is neither a token nor a two-token mix`)
    const w = +m[2] / 100
    return '#' + [1, 3, 5].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) * w + parseInt(m[3].slice(i, i + 2), 16) * (1 - w)).toString(16).padStart(2, '0')).join('')
  }
  it('says Supersuit to a reader', () => {
    expect(freedomDefault.name).toBe('Supersuit')
    expect(freedomDefault.kicker).toBe('A page from Supersuit')
    expect(JSON.stringify(freedomDefault)).not.toMatch(/Freedom|Freeda/)
  })
  it('paints only in the house tokens, or a mix of two of them', () => {
    const light = freedomDefault.light!
    for (const v of [freedomDefault.ground, freedomDefault.ink, freedomDefault.accent, light.ground, light.ink, light.accent]) {
      const hexes = v.match(/#[0-9a-f]{6}/gi) ?? []
      expect(hexes.length).toBeGreaterThan(0)
      for (const h of hexes) expect(MAISON).toContain(h.toLowerCase())
    }
    // The dark palette feeds the share card, whose renderer has no color-mix(): plain hex only.
    for (const v of [freedomDefault.ground, freedomDefault.ink, freedomDefault.accent]) expect(v).toMatch(/^#[0-9a-f]{6}$/i)
    expect(freedomDefault.ground).toBe('#17171a')       // night
    expect(freedomDefault.light!.ground).toBe('#e8e0d2') // travertine
  })
  it('reads at 4.5:1 or better: text and accent on each ground', () => {
    const light = freedomDefault.light!
    for (const [fg, bg] of [[freedomDefault.ink, freedomDefault.ground], [freedomDefault.accent, freedomDefault.ground], [light.ink, light.ground], [light.accent, light.ground]]) {
      expect(ratio(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('sets the house pair: DM Serif Display to inscribe, DM Sans to read, with fallbacks that need no font service', () => {
    expect(freedomDefault.type.display).toMatch(/^"DM Serif Display",.*serif$/)
    expect(freedomDefault.type.body).toMatch(/^"DM Sans",.*sans-serif$/)
    expect(JSON.stringify(freedomDefault.type)).not.toMatch(/googleapis|gstatic|Fraunces|Italiana|Hanken/)
  })
})
