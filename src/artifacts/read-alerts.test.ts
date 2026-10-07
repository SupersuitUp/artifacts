import { describe, it, expect } from 'vitest'
import { readAlertsDue, readSecondsFor, wordCount, localDay, type ReadAlertKind, type ReadAlertInput } from './read-alerts.js'
import { summarize, type SessionDoc } from './readers-store.js'

const NOW = '2026-10-07T18:00:00Z'
const READ = 600 // a ten-minute page
const opened = (over: Partial<NonNullable<ReadAlertInput['summary']>> = {}) => ({
  sessions: 1, activeSeconds: 40, maxScroll: 20, firstSeen: '2026-10-07T17:00:00Z', lastSeen: '2026-10-07T17:05:00Z', lastStarted: '2026-10-07T17:00:00Z', ...over,
})
const due = (over: Partial<ReadAlertInput>) =>
  readAlertsDue({ sent: [], email: 'priya@example.com', now: NOW, readSeconds: READ, ...over }).map((a) => a.kind)

describe('reading time', () => {
  it('counts words and turns them into seconds at 230 words a minute', () => {
    expect(wordCount('  one two\n three  ')).toBe(3)
    expect(wordCount('')).toBe(0)
    expect(readSecondsFor(2300)).toBe(600)
    expect(readSecondsFor(0)).toBe(0)
  })
  it('a local day is judged in the zone given, and a bad zone reads as UTC', () => {
    expect(localDay('2026-10-08T03:00:00Z', 'America/Los_Angeles')).toBe('2026-10-07')
    expect(localDay('2026-10-08T03:00:00Z', 'UTC')).toBe('2026-10-08')
    expect(localDay('2026-10-08T03:00:00Z', 'Not/AZone')).toBe('2026-10-08')
  })
})

describe('first open', () => {
  it('fires on the first recorded visit, once', () => {
    expect(due({ summary: opened() })).toEqual(['first-open'])
    expect(due({ summary: opened(), sent: ['first-open'] })).toEqual([])
  })
  it('never for a record older than a day: turning alerts on over old history is not news', () => {
    expect(due({ summary: opened({ firstSeen: '2026-09-01T00:00:00Z', lastStarted: '2026-09-01T00:00:00Z' }) })).toEqual([])
  })
  it('never for the publisher, whatever the case of the address', () => {
    expect(due({ summary: opened(), email: 'Owner@Example.com', ignore: ['owner@example.com'] })).toEqual([])
  })
})

describe('refused', () => {
  it('fires for a refusal with the account tried, once, and nothing else on that evaluation', () => {
    const a = readAlertsDue({ sent: [], email: 'Other@Example.com', now: NOW, refusedAttempt: true, summary: opened() })
    expect(a).toEqual([expect.objectContaining({ kind: 'refused', email: 'other@example.com' })])
    expect(due({ refusedAttempt: true, sent: ['refused'] })).toEqual([])
  })
})

describe('finished', () => {
  it('needs the end of the page AND a third of its reading time', () => {
    expect(due({ summary: opened({ maxScroll: 95, activeSeconds: 200 }), sent: ['first-open'] })).toEqual(['finished'])
    expect(due({ summary: opened({ maxScroll: 95, activeSeconds: 199 }), sent: ['first-open'] })).toEqual([])
    expect(due({ summary: opened({ maxScroll: 89, activeSeconds: 900 }), sent: ['first-open'] })).toEqual([])
  })
  it('fires once, and at the same time as a first open when both just happened', () => {
    expect(due({ summary: opened({ maxScroll: 100, activeSeconds: 300 }) })).toEqual(['first-open', 'finished'])
    expect(due({ summary: opened({ maxScroll: 100, activeSeconds: 300 }), sent: ['first-open', 'finished'] })).toEqual([])
  })
})

describe('came back', () => {
  const back = opened({ sessions: 3, firstSeen: '2026-10-06T15:00:00Z', lastStarted: '2026-10-07T16:00:00Z' })
  it('fires on a visit that began on a later local day than the first', () => {
    expect(due({ summary: back, sent: ['first-open'] })).toEqual(['came-back'])
    expect(due({ summary: back, sent: ['first-open', 'came-back'] })).toEqual([])
  })
  it('a second visit the same local day is not coming back, in the zone given', () => {
    const sameDayLA = opened({ sessions: 2, firstSeen: '2026-10-07T16:00:00Z', lastStarted: '2026-10-08T03:00:00Z' })
    const now = '2026-10-08T04:00:00Z'
    expect(due({ summary: sameDayLA, sent: ['first-open'], now, timeZone: 'America/Los_Angeles' })).toEqual([])
    expect(due({ summary: sameDayLA, sent: ['first-open'], now, timeZone: 'UTC' })).toEqual(['came-back'])
  })
})

describe('quiet', () => {
  it('fires once for a reader listed three or more days ago who never opened it', () => {
    expect(due({ summary: null, addedAt: '2026-10-04T17:00:00Z' })).toEqual(['quiet'])
    expect(readAlertsDue({ sent: [], email: 'priya@example.com', now: NOW, addedAt: '2026-10-04T17:00:00Z' })[0].daysSinceAdded).toBe(3)
    expect(due({ summary: null, addedAt: '2026-10-04T17:00:00Z', sent: ['quiet'] })).toEqual([])
  })
  it('not before three days, not past the window, not once they opened, not without a listing date', () => {
    expect(due({ summary: null, addedAt: '2026-10-05T06:00:00Z' })).toEqual([])
    expect(due({ summary: null, addedAt: '2026-09-01T00:00:00Z' })).toEqual([])
    expect(due({ summary: opened({ firstSeen: '2026-10-01T00:00:00Z', lastStarted: '2026-10-01T00:00:00Z' }), addedAt: '2026-10-01T00:00:00Z' })).toEqual([])
    expect(due({ summary: null, addedAt: '2026-10-01T00:00:00Z', sent: ['first-open'] })).toEqual([])
    expect(due({ summary: null })).toEqual([])
  })
})

it('every kind is at most once: replaying every evaluation with everything sent yields nothing', () => {
  const all: ReadAlertKind[] = ['first-open', 'refused', 'finished', 'came-back', 'quiet']
  const back = opened({ sessions: 3, maxScroll: 100, activeSeconds: 900, firstSeen: '2026-10-06T15:00:00Z', lastStarted: '2026-10-07T16:00:00Z' })
  expect(due({ summary: back, sent: all })).toEqual([])
  expect(due({ refusedAttempt: true, sent: all })).toEqual([])
  expect(due({ summary: null, addedAt: '2026-10-04T00:00:00Z', sent: all })).toEqual([])
})

it('summarize carries when the latest visit began, which is what came-back reads', () => {
  const s = (startedAt: string, lastAt: string): SessionDoc => ({
    artifactId: 'abc23456', session: startedAt, email: 'priya@example.com', name: null, member: false, startedAt, lastAt, activeSeconds: 10, maxScroll: 10,
  })
  const [r] = summarize([s('2026-10-06T09:00:00Z', '2026-10-08T00:00:00Z'), s('2026-10-07T10:00:00Z', '2026-10-07T10:30:00Z')], []).readers
  expect(r.firstSeen).toBe('2026-10-06T09:00:00Z')
  expect(r.lastStarted).toBe('2026-10-07T10:00:00Z')
  expect(r.lastSeen).toBe('2026-10-08T00:00:00Z')
})
