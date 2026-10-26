// @vitest-environment jsdom
// posthog-js keeps the last identity it was given on this origin, so a browser that opened one
// reader's per-reader link would otherwise report every page it opens after under that reader's id
// and label: a password or public page names nobody, and a per-reader page's init-time page view
// goes out before identify switches it. This mounts the real component against a stand-in
// posthog-js holding a leftover identity and reads the order of calls.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const calls: string[] = []
const state = { distinctId: 'anon-1', userState: 'anonymous' }
vi.mock('posthog-js', () => ({
  default: {
    init: () => calls.push('init'),
    register: () => calls.push('register'),
    get_distinct_id: () => state.distinctId,
    get_property: (k: string) => (k === '$user_state' ? state.userState : undefined),
    reset: () => { calls.push('reset'); state.distinctId = 'anon-2'; state.userState = 'anonymous' },
    identify: (id: string) => { calls.push(`identify ${id}`); state.distinctId = id; state.userState = 'identified' },
    capture: (e: string) => calls.push(`capture ${e} as ${state.distinctId}`),
  },
}))

import { PageAnalytics, posthogInitOptions } from './page-analytics.js'
import type { AnalyticsPlan, PageKind } from './analytics-plan.js'

const plan = (kind: PageKind, identity: AnalyticsPlan['identity'] = null): AnalyticsPlan => ({
  key: 'phc_test', host: 'https://ingest.example.com', pageId: 'abcd2345', kind, tenant: 'example', identity,
})

async function mount(p: AnalyticsPlan) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<PageAnalytics plan={p} />) })
  await vi.waitFor(() => expect(calls.some((c) => c.startsWith('capture $pageview'))).toBe(true))
  act(() => root.unmount())
  return calls.filter((c) => !c.startsWith('capture ') || c.startsWith('capture $pageview'))
}

const leftover = () => Object.assign(state, { distinctId: 'recipient:someone-else', userState: 'identified' })

beforeEach(() => { calls.length = 0; Object.assign(state, { distinctId: 'anon-1', userState: 'anonymous' }) })

describe('a leftover identity never reaches another page', () => {
  it('the page view is captured by the page, after it has settled who the reader is', () => {
    expect(posthogInitOptions({ host: 'https://ingest.example.com' }).capture_pageview).toBe(false)
  })

  for (const kind of ['password', 'public'] as PageKind[]) {
    it(`a ${kind} page forgets a reader left from another page before it records anything`, async () => {
      leftover()
      expect(await mount(plan(kind))).toEqual(['init', 'reset', 'register', 'capture $pageview as anon-2'])
    })
  }

  it('a per-reader page drops the leftover reader before naming its own, and records its view as its own', async () => {
    leftover()
    expect(await mount(plan('per-reader', { distinctId: 'recipient:r1', name: 'Jordan' }))).toEqual(
      ['init', 'reset', 'register', 'identify recipient:r1', 'capture $pageview as recipient:r1'])
  })

  it('a reader coming back on their own link keeps their identity', async () => {
    Object.assign(state, { distinctId: 'recipient:r1', userState: 'identified' })
    expect(await mount(plan('per-reader', { distinctId: 'recipient:r1', name: 'Jordan' }))).toEqual(
      ['init', 'register', 'identify recipient:r1', 'capture $pageview as recipient:r1'])
  })

  it('an anonymous browser is not reset, so its first visit still joins the reader it becomes', async () => {
    expect(await mount(plan('gated', { distinctId: 'jo@example.org', email: 'jo@example.org' }))).toEqual(
      ['init', 'register', 'identify jo@example.org', 'capture $pageview as jo@example.org'])
  })
})
