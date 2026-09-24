import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { mintPass, verifyPass, mintGrant, verifyGrant, decide, firstName, safeReturnPath, signInUrl, MEMBER_REASON, LISTED_REASON, type Reader } from './reader.js'

const jordan: Reader = { uid: 'uid1', email: 'jordan@example.com', name: 'Jordan Lee', member: true }

describe('the pass the sign-in authority mints', () => {
  it('is the exact shape the sign-in side holds (same vector on both sides)', () => {
    const payload = Buffer.from(JSON.stringify({ u: 'uid1', e: 'jordan@example.com', n: 'Jordan Lee', m: true, x: 1000 })).toString('base64url')
    const oracle = createHmac('sha256', 's').update(`artifact-pass:a1.${payload}`).digest('hex').slice(0, 32)
    expect(mintPass('s', jordan, 1000)).toBe(`a1.${payload}.${oracle}`)
  })
  it('verifies only unexpired, correctly signed passes, and never as a grant', () => {
    const pass = mintPass('s', jordan, 2000)
    expect(verifyPass('s', pass, 1999_000)).toEqual(jordan)
    expect(verifyPass('s', pass, 2001_000)).toBeNull()
    expect(verifyPass('other', pass, 1999_000)).toBeNull()
    expect(verifyPass(undefined, pass, 1999_000)).toBeNull()
    expect(verifyGrant('s', pass, 1999_000)).toBeNull()
    const [v, p, sig] = pass.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'uid1', e: 'eve@example.com', n: null, m: true, x: 2000 })).toString('base64url')
    expect(verifyPass('s', `${v}.${forged}.${sig}`, 1999_000)).toBeNull()
    expect(verifyPass('s', `${v}.${p}`, 1999_000)).toBeNull()
  })
  it('a grant lasts a week and lowercases the address', () => {
    const g = mintGrant('s', { ...jordan, email: 'Jordan@Example.com' }, 0)
    expect(verifyGrant('s', g, 6 * 86400_000)?.email).toBe('jordan@example.com')
    expect(verifyGrant('s', g, 8 * 86400_000)).toBeNull()
  })
})

describe('decide', () => {
  const stranger: Reader = { uid: 'u2', email: 'x@example.com', name: null, member: false }
  const member: Reader = { uid: 'u3', email: 'm@example.com', name: 'Mo', member: true }
  it('signed out never opens', () => {
    expect(decide('freedom', null, [])).toEqual({ open: false, why: 'signed-out' })
  })
  it('freedom opens to any member and to the list; invite only to the list', () => {
    expect(decide('freedom', member, [])).toEqual({ open: true, why: 'member', reason: MEMBER_REASON })
    expect(decide('invite', member, []).open).toBe(false)
    expect(decide('freedom', stranger, []).open).toBe(false)
    expect(decide('invite', stranger, [{ email: 'X@example.com ' }])).toEqual({ open: true, why: 'listed', reason: LISTED_REASON })
  })
  it("a listed person's own reason wins over membership", () => {
    const d = decide('freedom', member, [{ email: 'm@example.com', reason: 'Sam wanted your read before anyone else' }])
    expect(d).toEqual({ open: true, why: 'listed', reason: 'Sam wanted your read before anyone else' })
  })
  it('the banner name prefers the list, then the account, first word only', () => {
    expect(firstName(member, [{ email: 'm@example.com', name: 'Priya Smith' }])).toBe('Priya')
    expect(firstName(member, [])).toBe('Mo')
    expect(firstName(stranger, [])).toBeNull()
  })
})

describe('redirects stay on this host', () => {
  it('accepts one page path and nothing else', () => {
    expect(safeReturnPath('/j75wybat')).toBe('/j75wybat')
    for (const bad of ['//evil.example/j75wybat', 'https://evil.example/', '/j75wybat/x', '/api/x', '', null, '/J75WYBAT'])
      expect(safeReturnPath(bad as string)).toBeNull()
  })
  it('the sign-in url carries the page', () => {
    expect(signInUrl('https://accounts.example.com', 'https://artifacts.example.com/j75wybat'))
      .toBe('https://accounts.example.com/artifact/sign-in?to=https%3A%2F%2Fartifacts.example.com%2Fj75wybat')
  })
})
