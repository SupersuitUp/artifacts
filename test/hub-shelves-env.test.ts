// HUB_TENANT `shelves`: the "Shared with you" home's shelves, in order, validated when the hub starts.
import { describe, expect, it } from 'vitest'
import { parseHubEnv } from '../template/hub/src/lib/hub-env-parse'

const base = { host: 'artifacts.example.com', owner: 'Robin', firebase: { apiKey: 'k', appId: 'a', authDomain: 'artifacts.example.com', projectId: 'p' } }
const parse = (extra: Record<string, unknown>) => parseHubEnv(JSON.stringify({ ...base, ...extra }))

describe('HUB_TENANT shelves', () => {
  it('is optional', () => {
    expect(parse({})!.shelves).toBeUndefined()
  })
  it('keeps the shelves in order with their labels and blurbs', () => {
    expect(parse({ shelves: [{ id: 'family', label: 'Family pages', blurb: 'For the family' }, { id: 'trips', label: 'Trips and plans' }] })!.shelves)
      .toEqual([{ id: 'family', label: 'Family pages', blurb: 'For the family' }, { id: 'trips', label: 'Trips and plans' }])
  })
  it('refuses a bad id, a missing label, a repeated id and an empty list', () => {
    expect(() => parse({ shelves: [{ id: 'Family', label: 'F' }] })).toThrow(/shelves\[0\]\.id/)
    expect(() => parse({ shelves: [{ id: 'family' }] })).toThrow(/label/)
    expect(() => parse({ shelves: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })).toThrow(/twice/)
    expect(() => parse({ shelves: [] })).toThrow(/non-empty/)
  })
})
