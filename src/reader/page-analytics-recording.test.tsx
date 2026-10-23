// @vitest-environment jsdom
// A session replay is a copy of the page held by a third party, so every page kind records with
// every word and every input masked. This mounts the real component against a stand-in posthog-js
// and reads what it handed `posthog.init`, so a change that unmasks any kind fails here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const init = vi.fn()
vi.mock('posthog-js', () => ({
  default: { init: (...a: unknown[]) => init(...a), register: vi.fn(), identify: vi.fn(), capture: vi.fn() },
}))

import { PageAnalytics, posthogInitOptions, RECORDING_MASK } from './page-analytics.js'
import type { AnalyticsPlan, PageKind } from './analytics-plan.js'

const KINDS: PageKind[] = ['public', 'password', 'gated', 'per-reader']
const plan = (kind: PageKind): AnalyticsPlan => ({
  key: 'phc_test', host: 'https://ingest.example.com', pageId: 'abcd2345', kind, tenant: 'example',
  identity: kind === 'per-reader' ? { distinctId: 'recipient:r1', name: 'Jordan' } : null,
})

async function initOptionsFor(kind: PageKind) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<PageAnalytics plan={plan(kind)} />) })
  await vi.waitFor(() => expect(init).toHaveBeenCalled())
  act(() => root.unmount())
  return init.mock.calls[0][1] as Record<string, unknown>
}

beforeEach(() => init.mockClear())

describe('session replay masking', () => {
  it('the mask is every text node and every input', () => {
    expect(RECORDING_MASK).toEqual({ maskAllInputs: true, maskTextSelector: '*' })
  })

  for (const kind of KINDS) {
    it(`a ${kind} page records with all text and all inputs masked`, async () => {
      const options = await initOptionsFor(kind)
      expect(options.disable_session_recording).not.toBe(true) // still recorded, just without the words
      expect(options.session_recording).toMatchObject(RECORDING_MASK)
      expect(options.mask_all_text).toBe(true)
    })
  }

  it('nothing in the options can turn the mask back off', () => {
    const options = posthogInitOptions({ host: 'https://ingest.example.com' })
    const rec = options.session_recording as Record<string, unknown>
    expect(rec.maskTextSelector).toBe('*')
    expect(rec.maskAllInputs).toBe(true)
    expect(rec).not.toHaveProperty('maskTextFn')
    expect(rec).not.toHaveProperty('maskInputFn')
    expect(rec).not.toHaveProperty('maskInputOptions')
  })
})
