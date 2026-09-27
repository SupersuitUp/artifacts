import { describe, expect, it } from 'vitest'
import { formatUpdated } from './updated-at.js'

// Gary, 2026-09-27: "Artifacts should have exact minute of last updated too." A day was not
// enough: a page republished three times in one evening read identically each time.
describe('formatUpdated', () => {
  it('names the exact minute and the zone it is in', () => {
    expect(formatUpdated('2026-09-27T13:07:42.000Z', 'America/Chicago')).toBe('September 27, 2026 at 8:07 AM CDT')
  })
  it('defaults to UTC, which the server render uses before the reader localizes it', () => {
    expect(formatUpdated('2026-09-27T13:07:42.000Z')).toBe('September 27, 2026 at 1:07 PM UTC')
  })
  it('never invents a time from a bad value', () => {
    expect(formatUpdated('not a date')).toBe('')
  })
})
