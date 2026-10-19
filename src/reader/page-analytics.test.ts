// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { trackSections, narrationEvent } from './page-analytics.js'

function page(tops: Record<string, number>) {
  document.body.innerHTML = Object.keys(tops).map((id) => `<h2 id="${id}">Heading ${id}</h2>`).join('')
  for (const [id, top] of Object.entries(tops)) {
    document.getElementById(id)!.getBoundingClientRect = () => ({ top } as DOMRect)
  }
}

describe('trackSections', () => {
  it('reports the section left, with its visible seconds, by the rail\'s rule', () => {
    page({ one: 0, two: 900 })
    const events: [string, Record<string, unknown>?][] = []
    let t = 0
    const s = trackSections(['one', 'two'], (e, p) => events.push([e, p]), document, () => t)
    s.check()
    t = 12_000
    document.getElementById('two')!.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
    s.check()
    expect(events).toEqual([['section_viewed', { section_id: 'one', heading: 'Heading one', seconds: 12 }]])
    t = 13_000
    s.stop() // under the minimum: passed over, not read
    expect(events).toHaveLength(1)
  })
})

describe('narrationEvent', () => {
  it('names play, pause and complete, and drops the pause that precedes ended', () => {
    expect(narrationEvent('play', { currentTime: 0.4, duration: 61.2 })).toEqual(['narration_play', { position_seconds: 0, duration_seconds: 61 }])
    expect(narrationEvent('pause', { currentTime: 30.6, duration: 61.2 })![0]).toBe('narration_pause')
    expect(narrationEvent('pause', { currentTime: 61.2, duration: 61.2, ended: true })).toBeNull()
    expect(narrationEvent('ended', { currentTime: 61.2, duration: NaN })).toEqual(['narration_complete', { position_seconds: 61, duration_seconds: null }])
  })
})
