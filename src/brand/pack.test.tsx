import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { freedomDefault, type BrandPack } from './pack.js'
import { BrandGround, BrandMark } from './wrapper.js'
import { GLOW_PASTELS } from './backdrop.js'

describe('brand packs', () => {
  it('the default pack renders a flat ground and a dove', () => {
    const out = renderToStaticMarkup(
      <BrandGround pack={freedomDefault}>
        <BrandMark pack={freedomDefault} />
        <p>hi</p>
      </BrandGround>,
    )
    expect(out).toContain('data-brand-ground="freedom-default"')
    expect(out).toContain('🕊')
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
    expect(out).toContain('--a-ground:#f6f1e7')
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
  it('bubbles animate on the compositor only: no full-screen blur or blend to repaint every frame', () => {
    const out = renderToStaticMarkup(<BrandGround pack={{ ...freedomDefault, backdrop: { kind: 'bubbles' } }}><p /></BrandGround>)
    expect(out).not.toMatch(/filter:\s*blur/)
    expect(out).not.toContain('mix-blend-mode')
    expect(out).toContain('will-change:transform')
  })
  it('the default glow runs the whole spectrum, one bubble per colour', () => {
    expect(GLOW_PASTELS.length).toBeGreaterThanOrEqual(9)
    const out = renderToStaticMarkup(<BrandGround pack={{ ...freedomDefault, backdrop: { kind: 'bubbles' } }}><p /></BrandGround>)
    expect(out.match(/class="a-bubble"/g)?.length).toBe(GLOW_PASTELS.length)
  })
  it('the default glow never carries the warm half, so it cannot read as a rainbow', () => {
    for (const c of GLOW_PASTELS) {
      const [r, g, b] = c.split(',').map(Number)
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const d = max - min
      const hue = d === 0 ? 0 : max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240
      // cyan (~180) round through blue and violet to magenta-pink (~335); no red, orange, yellow, green
      expect(hue >= 175 && hue <= 340, `${c} has hue ${Math.round(hue)}`).toBe(true)
    }
  })
})
