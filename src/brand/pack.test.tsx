import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { freedomDefault, type BrandPack } from './pack.js'
import { BrandGround, BrandMark } from './wrapper.js'

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
})
