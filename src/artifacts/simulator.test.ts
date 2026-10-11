import { describe, it, expect } from 'vitest'
import { parseSimulatorFence, simulatorSrc } from './simulator.js'

describe('parseSimulatorFence', () => {
  it('reads a scenario, a caption and an optional height', () => {
    const r = parseSimulatorFence('scenario: diane-meeting-prep\ncaption: Step into the hour before the meeting.\nheight: 760px', 4)
    expect(r).toEqual({ ok: true, block: { scenario: 'diane-meeting-prep', caption: 'Step into the hour before the meeting.', height: '760px' } })
  })
  it('defaults the height to 720px', () => {
    const r = parseSimulatorFence('scenario: a\ncaption: Play it.', 1)
    expect(r.ok && r.block.height).toBe('720px')
  })
  it('refuses a block with no scenario, no caption, a bad id, a bad height or an unknown key, naming the line', () => {
    expect(parseSimulatorFence('caption: x', 3)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 3: .*scenario/) })
    expect(parseSimulatorFence('scenario: a', 3)).toMatchObject({ ok: false, error: expect.stringMatching(/caption/) })
    expect(parseSimulatorFence('scenario: A B\ncaption: x', 3)).toMatchObject({ ok: false, error: expect.stringMatching(/line 4: .*scenario/) })
    expect(parseSimulatorFence('scenario: a\ncaption: x\nheight: tall', 3)).toMatchObject({ ok: false, error: expect.stringMatching(/line 6: .*height/) })
    expect(parseSimulatorFence('scenario: a\ncaption: x\nautoplay: on', 3)).toMatchObject({ ok: false, error: expect.stringMatching(/unknown key: autoplay/) })
  })
})

describe('simulatorSrc', () => {
  it('points the host\'s embed page at the scenario, with the timeline off', () => {
    expect(simulatorSrc('https://example.com/simulator/embed', 'diane-meeting-prep')).toBe('https://example.com/simulator/embed?scenario=diane-meeting-prep&timeline=off')
  })
  it('refuses an embed address that is not https', () => {
    expect(simulatorSrc('http://example.com/embed', 'a')).toBeNull()
    expect(simulatorSrc('javascript:alert(1)', 'a')).toBeNull()
  })
})
