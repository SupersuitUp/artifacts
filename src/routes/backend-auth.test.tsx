import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { isBackendAuthError } from './backend-auth.js'
import { testConfig, memoryArtifactStore } from './test-config.js'

// What firebase-admin throws when the host's cloud credential is refused: here, a Vercel team
// change left the workload identity provider trusting the old team's OIDC issuer (2026-10-28).
function grpcAuthError(): Error {
  const e = new Error('2 UNKNOWN: Getting metadata from plugin failed with error: Error code invalid_grant: The issuer in ID Token https://oidc.vercel.com/new-team does not match the expected one in config: https://oidc.vercel.com/old-team.') as Error & { code: number }
  e.code = 2
  return e
}
const GOOD = `---\ntitle: T\nsummary: S\n---\n# hi`
const publish = () => new NextRequest('https://artifacts.example.com/api/artifacts', {
  method: 'POST', body: GOOD, headers: { 'content-type': 'text/markdown', authorization: 'Bearer test-key' },
})

describe('a backend credential failure', () => {
  it('is recognised by its shapes, and ordinary errors are not', () => {
    expect(isBackendAuthError(grpcAuthError())).toBe(true)
    expect(isBackendAuthError(Object.assign(new Error('16 UNAUTHENTICATED: Request had invalid authentication credentials.'), { code: 16 }))).toBe(true)
    expect(isBackendAuthError(new Error('Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication'))).toBe(true)
    expect(isBackendAuthError(new Error('9 FAILED_PRECONDITION: The query requires an index.'))).toBe(false)
    expect(isBackendAuthError(new Error('boom'))).toBe(false)
    expect(isBackendAuthError('invalid_grant')).toBe(false)
  })

  it('makes publish answer 503 with a typed error that names the cause, never a bare 500', async () => {
    const store = { ...memoryArtifactStore(), save: vi.fn(async () => { throw grpcAuthError() }), get: vi.fn(async () => { throw grpcAuthError() }) }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const routes = createArtifactRoutes(testConfig({ store }))
    const r = await routes.POST(publish())
    expect(r.status).toBe(503)
    const body = await r.json()
    expect(body.error).toBe('backend-auth')
    expect(body.message).toMatch(/could not sign in to its database/)
    // The provider's issuer and the token's are the host's config, not a visitor's business.
    expect(JSON.stringify(body)).not.toMatch(/oidc\.vercel\.com/)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('covers the other routes too, and leaves any other error as it was', async () => {
    const store = { ...memoryArtifactStore(), get: vi.fn(async () => { throw grpcAuthError() }) }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const routes = createArtifactRoutes(testConfig({ store }))
    const g = await routes.GET(new NextRequest('https://artifacts.example.com/api/artifacts/abcd2345', { headers: { authorization: 'Bearer test-key' } }), { params: Promise.resolve({ id: 'abcd2345' }) })
    expect(g.status).toBe(503)
    expect((await g.json()).error).toBe('backend-auth')

    const other = { ...memoryArtifactStore(), save: vi.fn(async () => { throw new Error('boom') }) }
    const r2 = createArtifactRoutes(testConfig({ store: other }))
    await expect(r2.POST(publish())).rejects.toThrow('boom')
    vi.restoreAllMocks()
  })
})
