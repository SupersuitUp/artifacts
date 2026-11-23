// HUB_TENANT's sign-in fields: which doors the hub opens, and the Microsoft client id that lets it
// trust a work email whose domain the tenant verified.
import { describe, it, expect } from 'vitest'
import { parseHubEnv } from '../template/hub/src/lib/hub-env-parse'

const base = { host: 'artifacts.example.com', owner: 'An Operator', firebase: { apiKey: 'k', appId: 'a', authDomain: 'artifacts.example.com', projectId: 'p' } }
const parse = (extra: Record<string, unknown>) => parseHubEnv(JSON.stringify({ ...base, ...extra }))

describe('HUB_TENANT signIn', () => {
  it('takes google, microsoft and email, once each', () => {
    expect(parse({ signIn: ['google', 'email', 'google'] })?.signIn).toEqual(['google', 'email'])
    expect(parse({ signIn: ['email'] })?.signIn).toEqual(['email'])
    expect(parse({})?.signIn).toBeUndefined()
  })
  it('refuses anything else, in words that list the allowed values', () => {
    for (const signIn of [[], ['apple'], 'google', [1]]) {
      expect(() => parse({ signIn })).toThrow('HUB_TENANT signIn must be a non-empty list of "google", "microsoft" and "email"')
    }
  })
})

describe('HUB_TENANT microsoft', () => {
  it('carries the Microsoft client id, trimmed', () => {
    expect(parse({ microsoft: { clientId: ' 11111111-2222-3333-4444-555555555555 ' } })?.microsoft).toEqual({ clientId: '11111111-2222-3333-4444-555555555555' })
    expect(parse({})?.microsoft).toBeUndefined()
  })
  it('refuses a block with no client id, or not an object', () => {
    for (const microsoft of [{}, { clientId: '' }, { clientId: 7 }, 'id', null, []]) {
      expect(() => parse({ microsoft })).toThrow(/HUB_TENANT microsoft/)
    }
    expect(() => parse({ microsoft: {} })).toThrow('HUB_TENANT microsoft.clientId must be a non-empty string')
  })
})
