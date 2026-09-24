import { describe, it, expect } from 'vitest'
import { keyHash, unlockCookieName, isUnlocked, unlockedUrl } from './unlock.js'

describe('a page with a password', () => {
  it('opens on the key in the URL, so a link sent to a person opens on tap', () => {
    expect(isUnlocked({ id: 'abc23456', password: 'day ones', key: 'day ones' })).toBe(true)
  })
  it('opens on the cookie the first unlock set, so a refresh does not ask again', () => {
    const cookie = keyHash('abc23456', 'day ones')
    expect(isUnlocked({ id: 'abc23456', password: 'day ones', cookie })).toBe(true)
  })
  it('stays shut on a wrong key, a wrong cookie, or nothing at all', () => {
    expect(isUnlocked({ id: 'abc23456', password: 'day ones', key: 'dayones' })).toBe(false)
    expect(isUnlocked({ id: 'abc23456', password: 'day ones', cookie: keyHash('abc23456', 'other') })).toBe(false)
    expect(isUnlocked({ id: 'abc23456', password: 'day ones' })).toBe(false)
  })
  it('a page with no password is always open', () => {
    expect(isUnlocked({ id: 'abc23456' })).toBe(true)
    expect(isUnlocked({ id: 'abc23456', password: '' })).toBe(true)
  })
  it('the cookie carries a hash bound to the page id, never the password, and never opens another page', () => {
    const h = keyHash('abc23456', 'day ones')
    expect(h).not.toContain('day ones')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(isUnlocked({ id: 'xyz23456', password: 'day ones', cookie: h })).toBe(false)
    expect(unlockCookieName('abc23456')).toBe('artifact_key_abc23456')
  })
  it('the unlocked link is the page URL with the key, encoded', () => {
    expect(unlockedUrl('https://artifacts.example/abc23456', 'day ones & co')).toBe('https://artifacts.example/abc23456?key=day%20ones%20%26%20co')
  })
})
