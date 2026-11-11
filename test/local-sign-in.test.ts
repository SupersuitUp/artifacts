// The hub's pass route counts a sign-in only when it is fresh, and a count never blocks the pass.
import { describe, it, expect, vi } from 'vitest'
import { localPass } from '../template/hub/src/lib/local-sign-in'

const NOW = 1_800_000_000_000
const tenant = { id: 'hub', siteUrl: 'https://artifacts.example.com', pack: {} as never, configured: true, localSignIn: { firebase: {} as never, providers: ['google' as const] } }
const run = (authTime: number, count: (p: string) => Promise<void>) => localPass({
  tenant, to: '/abcdefgh', authorization: 'Bearer t', secret: 's'.repeat(32), now: NOW, count,
  verify: async () => ({ uid: 'u1', email: 'a@example.com', emailVerified: true, claims: { auth_time: authTime, firebase: { sign_in_provider: 'microsoft.com' } } }),
})

describe('the sign-in count on the pass route', () => {
  it('a fresh sign-in gets its pass and is counted once, by provider', async () => {
    const count = vi.fn(async () => {})
    const r = await run(NOW / 1000 - 60, count)
    expect(r.ok).toBe(true)
    expect(count).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledWith('microsoft')
  })
  it('a reader already signed in opening another page gets a pass and is not counted', async () => {
    const count = vi.fn(async () => {})
    const r = await run(NOW / 1000 - 3600, count)
    expect(r.ok).toBe(true)
    expect(count).not.toHaveBeenCalled()
  })
  it('a count that throws or rejects never blocks the pass', async () => {
    expect((await run(NOW / 1000, () => { throw new Error('boom') })).ok).toBe(true)
    expect((await run(NOW / 1000, () => Promise.reject(new Error('boom')))).ok).toBe(true)
  })
})
