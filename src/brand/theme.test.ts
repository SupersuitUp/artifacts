import { describe, it, expect } from 'vitest'
import { themeCss, resolveMode, themedPack, THEME_MODES } from './theme.js'
import { freedomDefault, type BrandPack } from './pack.js'

describe('theme', () => {
  it('modes are exactly light, dark and system', () => {
    expect([...THEME_MODES]).toEqual(['light', 'dark', 'system'])
  })
  it('a page overrides the pack, the pack overrides dark', () => {
    expect(resolveMode(freedomDefault)).toBe('dark')
    expect(resolveMode({ ...freedomDefault, mode: 'light' })).toBe('light')
    expect(resolveMode({ ...freedomDefault, mode: 'light' }, 'system')).toBe('system')
  })
  it('dark and light carry their own palettes; system switches on the device', () => {
    const css = themeCss(freedomDefault)
    expect(css).toContain(`[data-artifact-theme="dark"]{--a-ground:${freedomDefault.ground}`)
    expect(css).toContain(`[data-artifact-theme="light"]{--a-ground:${freedomDefault.light!.ground}`)
    expect(css).toMatch(/@media \(prefers-color-scheme: light\)\{\[data-artifact-theme="system"\]\{--a-ground:/)
    expect(css).toContain('color-scheme:light')
  })
  it('a pack with no light palette still gets a readable one', () => {
    const p: BrandPack = { ...freedomDefault, light: undefined }
    expect(themeCss(p)).toMatch(/\[data-artifact-theme="light"\]\{--a-ground:#[0-9a-f]{6};--a-ink:#[0-9a-f]{6}/)
  })
  it('the themed pack paints with variables, so every inline colour follows the mode', () => {
    const t = themedPack(freedomDefault)
    expect(t.ground).toBe('var(--a-ground)')
    expect(t.ink).toBe('var(--a-ink)')
    expect(t.accent).toBe('var(--a-accent)')
    expect(t.kicker).toBe(freedomDefault.kicker)
  })
})
