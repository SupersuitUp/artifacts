import { describe, it, expect } from 'vitest'
import { analyticsPlan, DEFAULT_POSTHOG_HOST } from './analytics-plan.js'

const config = { posthogKey: 'phc_test', tenant: 'example' }
const base = { config, pageId: 'abcd2345', kind: 'public' as const, owner: false, bot: false }

describe('analyticsPlan', () => {
  it('a host with no key records nothing', () => {
    expect(analyticsPlan({ ...base, config: null })).toBeNull()
    expect(analyticsPlan({ ...base, config: { posthogKey: '  ' } })).toBeNull()
  })
  it('the owner or an admin is never recorded', () => {
    expect(analyticsPlan({ ...base, owner: true })).toBeNull()
    expect(analyticsPlan({ ...base, kind: 'gated', owner: true, reader: { email: 'robin@example.com' } })).toBeNull()
  })
  it('a link-preview fetcher is never recorded', () => {
    expect(analyticsPlan({ ...base, bot: true })).toBeNull()
  })
  it('a public or password page stays anonymous, even with a signed-in reader', () => {
    for (const kind of ['public', 'password'] as const) {
      const plan = analyticsPlan({ ...base, kind, reader: { email: 'ana@example.com' } })!
      expect(plan.identity).toBeNull()
      expect(plan).toMatchObject({ key: 'phc_test', host: DEFAULT_POSTHOG_HOST, kind, tenant: 'example', pageId: 'abcd2345' })
    }
  })
  it('a gated page identifies the signed-in reader by email', () => {
    const plan = analyticsPlan({ ...base, kind: 'gated', reader: { email: 'Ana@Example.com', name: 'Ana Ruiz' } })!
    expect(plan.identity).toEqual({ distinctId: 'ana@example.com', email: 'ana@example.com', name: 'Ana Ruiz' })
  })
  it('a per-reader link identifies by its opaque recipient id alone: never its label, never an email', () => {
    // Superlinks (operator's ruling, 2026-10-26): analytics gets the link's id, never who it is for.
    // The id-to-person map stays with the publisher, so a third-party analytics store holds no names.
    const plan = analyticsPlan({ ...base, kind: 'per-reader', recipient: { rid: 'r1x', label: 'Ana' }, reader: { email: 'ana@example.com' } })!
    expect(plan.identity).toEqual({ distinctId: 'recipient:r1x' })
  })
  it('honours a host override', () => {
    expect(analyticsPlan({ ...base, config: { posthogKey: 'k', posthogHost: 'https://eu.i.posthog.com' } })!.host).toBe('https://eu.i.posthog.com')
  })
})
