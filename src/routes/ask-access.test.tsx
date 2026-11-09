// Ask for access (0.63.0). A signed-in visitor turned away at a private page's door can ask the
// publisher for it, with an optional note. The request is a flag on the page's record and an
// `asked` reader event, so the host's read alerts tell the publisher. Gary, 2026-11-08: "there
// should be some kind of notification that you don't have permission to view this document".
import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { createArtifactRoutes } from './artifacts.js'
import { testConfig, memoryArtifactStore } from './test-config.js'
import { GRANT_COOKIE, mintGrant } from '../artifacts/reader.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { readAlertsDue } from '../artifacts/read-alerts.js'
import { summarize } from '../artifacts/readers-store.js'

const S = 's'.repeat(40)
const RS = 'rs'
const dana = { uid: 'u3', email: 'dana@example.com', name: 'Dana', member: true }
const perReader = { id: 'abcd2345', title: 'T', summary: 'S', links: 'per-reader' as const, markdown: 'x' }
const gated = { id: 'efgh2345', title: 'G', summary: 'S', access: 'invite' as const, markdown: 'x' }

function setup(over: { who?: typeof dana | null; flags?: { kind: string; email: string; at: string; detail?: string }[]; onReaderEvent?: unknown; readers?: unknown } = {}) {
  const flag = vi.fn(async () => {})
  const readers = over.readers === undefined
    ? { flag, flags: async () => over.flags ?? [], allowList: async () => [], acknowledged: async () => false }
    : over.readers
  const who = over.who === undefined ? dana : over.who
  const routes = createArtifactRoutes(testConfig({
    store: { ...memoryArtifactStore([perReader, gated]) } as never,
    recipients: memoryRecipientsStore() as never, recipientSecret: () => S, readerSecret: () => RS,
    ownerEmail: 'robin@example.com', signInOrigin: 'https://signin.example.com',
    readers: readers as never,
    onReaderEvent: over.onReaderEvent as never,
    readCookie: async (n: string) => (who && n === GRANT_COOKIE ? mintGrant(RS, who) : undefined),
  }))
  return { routes, flag }
}
const ask = (id: string, note?: string, who: typeof dana | null = dana) => {
  const body = new URLSearchParams({ id, ...(note !== undefined ? { note } : {}) })
  return new NextRequest('https://artifacts.example.com/api/reader/ask', {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(who ? { cookie: `${GRANT_COOKIE}=${mintGrant(RS, who)}` } : {}) },
  })
}
const page = (id: string, sp: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) })

describe('the door offers to ask', () => {
  it('a signed-in visitor at a per-reader door gets an Ask for access form', async () => {
    const { routes } = setup()
    const html = renderToStaticMarkup(await routes.Page(page('abcd2345')))
    expect(html).toContain('action="/api/reader/ask"')
    expect(html).toContain('Ask for access')
    expect(html).toContain('name="note"')
  })
  it('a signed-in visitor at a gated door gets the same form', async () => {
    const { routes } = setup()
    const html = renderToStaticMarkup(await routes.Page(page('efgh2345')))
    expect(html).toContain('action="/api/reader/ask"')
  })
  it('signed out there is no form, only sign-in', async () => {
    const { routes } = setup({ who: null })
    const html = renderToStaticMarkup(await routes.Page(page('abcd2345')))
    expect(html).not.toContain('action="/api/reader/ask"')
    expect(html).toContain('Sign in')
  })
  it('with no reader store there is nowhere to keep a request, so no form', async () => {
    const { routes } = setup({ readers: null })
    const html = renderToStaticMarkup(await routes.Page(page('abcd2345')))
    expect(html).not.toContain('action="/api/reader/ask"')
  })
  it('after asking, the door says the request was passed on instead of offering the form again', async () => {
    const { routes } = setup({ flags: [{ kind: 'asked', email: 'dana@example.com', at: '2026-11-08T00:00:00Z' }] })
    const html = renderToStaticMarkup(await routes.Page(page('abcd2345')))
    expect(html).toContain('You asked for access')
    expect(html).not.toContain('action="/api/reader/ask"')
  })
})

describe('POST /api/reader/ask', () => {
  it('records the request with the note and tells the host, then lands back on the page', async () => {
    const events: unknown[] = []
    const { routes, flag } = setup({ onReaderEvent: async (e: unknown) => { events.push(e) } })
    const res = await routes.ASK(ask('abcd2345', '  I was on the call last week.  '))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://artifacts.example.com/abcd2345')
    expect(flag).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'abcd2345', kind: 'asked', detail: 'I was on the call last week.', reader: expect.objectContaining({ email: 'dana@example.com' }) }))
    expect(events).toEqual([expect.objectContaining({ kind: 'asked', note: 'I was on the call last week.', reader: { email: 'dana@example.com', name: 'Dana' } })])
  })
  it('a note is cut to 500 characters', async () => {
    const { routes, flag } = setup()
    await routes.ASK(ask('abcd2345', 'x'.repeat(900)))
    expect(flag).toHaveBeenCalledWith(expect.objectContaining({ detail: 'x'.repeat(500) }))
  })
  it('signed out, nothing is recorded', async () => {
    const { routes, flag } = setup()
    const res = await routes.ASK(ask('abcd2345', 'hi', null))
    expect(res.status).toBe(303)
    expect(flag).not.toHaveBeenCalled()
  })
  it('the owner, who already has access, records nothing', async () => {
    const { routes, flag } = setup()
    await routes.ASK(ask('abcd2345', 'hi', { uid: 'u1', email: 'robin@example.com', name: 'Robin', member: true }))
    expect(flag).not.toHaveBeenCalled()
  })
  it('a page that is not private records nothing', async () => {
    const { routes, flag } = setup()
    const open = createArtifactRoutes(testConfig({ readerSecret: () => RS, readers: { flag, flags: async () => [] } as never }))
    await open.ASK(ask('abcd2345', 'hi'))
    expect(flag).not.toHaveBeenCalled()
    void routes
  })
  it('one request per visitor per page: a second is not recorded', async () => {
    const { routes, flag } = setup({ flags: [{ kind: 'asked', email: 'dana@example.com', at: '2026-11-08T00:00:00Z' }] })
    await routes.ASK(ask('abcd2345', 'again'))
    expect(flag).not.toHaveBeenCalled()
  })
})

describe('the asked alert and record', () => {
  it('is due once per reader per page', () => {
    const base = { email: 'dana@example.com', now: '2026-11-08T00:00:00Z' }
    expect(readAlertsDue({ ...base, sent: [], askedAttempt: true }).map((a) => a.kind)).toEqual(['asked'])
    expect(readAlertsDue({ ...base, sent: ['asked'], askedAttempt: true })).toEqual([])
  })
  it('the summary lists who asked, with their note', () => {
    const r = summarize([], [{ artifactId: 'a', email: 'dana@example.com', name: 'Dana', kind: 'asked', detail: 'hi', at: '2026-11-08T00:00:00Z' }])
    expect(r.asked).toEqual([{ email: 'dana@example.com', name: 'Dana', note: 'hi', at: '2026-11-08T00:00:00Z' }])
    expect(r.refused).toEqual([])
  })
})
