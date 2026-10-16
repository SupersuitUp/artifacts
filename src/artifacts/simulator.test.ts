import { describe, it, expect } from 'vitest'
import { parseSimulatorFence, simulatorSrc, parseEmbedFence, embedSrc, fitFrom, FIT_MIN, FIT_MAX, EMBED_KINDS } from './simulator.js'

describe('the figure block', () => {
  it('takes a figure id, a caption and an optional height', () => {
    expect(parseEmbedFence('figure', 'figure: doug-week\ncaption: A week of Doug, before and after.', 1)).toEqual({ ok: true, block: { value: 'doug-week', caption: 'A week of Doug, before and after.', height: '560px' } })
    expect(parseEmbedFence('figure', 'figure: clicks\ncaption: x\nheight: 480px', 1)).toMatchObject({ ok: true, block: { height: '480px' } })
  })
  it('refuses a missing figure, a missing caption, a bad id or an unknown key, naming the line', () => {
    expect(parseEmbedFence('figure', 'caption: x', 7)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 7: the figure block needs a figure/) })
    expect(parseEmbedFence('figure', 'figure: a', 7)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 7: .*caption/) })
    expect(parseEmbedFence('figure', 'figure: Doug Week\ncaption: x', 7)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 8: .*figure/) })
    expect(parseEmbedFence('figure', 'figure: a\ncaption: x\nautoplay: true', 7)).toMatchObject({ ok: false, error: expect.stringMatching(/unknown key: autoplay/) })
  })
  it('points the host\'s figure page at the figure, asking it to fit', () => {
    expect(embedSrc('figure', 'https://example.com/figures/embed', 'doug-week')).toBe('https://example.com/figures/embed?figure=doug-week&fit=content')
    expect(embedSrc('figure', 'http://example.com/figures/embed', 'a')).toBeNull()
  })
})

describe('the helm block', () => {
  it('takes a scene, a caption, an optional height and an optional autoplay', () => {
    expect(parseEmbedFence('helm', 'scene: doug-walk\ncaption: A year later, on the reservoir loop.', 1)).toEqual({ ok: true, block: { value: 'doug-walk', caption: 'A year later, on the reservoir loop.', height: '760px' } })
    expect(parseEmbedFence('helm', 'scene: doug-walk\ncaption: x\nautoplay: true\nheight: 820px', 1)).toEqual({ ok: true, block: { value: 'doug-walk', caption: 'x', height: '820px', options: { autoplay: 'true' } } })
    expect(parseEmbedFence('helm', 'scene: doug-walk\ncaption: x\nautoplay: false', 1)).toMatchObject({ ok: true, block: { options: { autoplay: 'false' } } })
  })
  it('refuses a missing scene, a missing caption, a bad autoplay or an unknown key, naming the line', () => {
    expect(parseEmbedFence('helm', 'caption: x', 2)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 2: the helm block needs a scene/) })
    expect(parseEmbedFence('helm', 'scene: a', 2)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 2: .*caption/) })
    expect(parseEmbedFence('helm', 'scene: a\ncaption: x\nautoplay: yes', 2)).toMatchObject({ ok: false, error: expect.stringMatching(/^line 5: a helm autoplay is true or false/) })
    expect(parseEmbedFence('helm', 'scene: a\ncaption: x\nfigure: b', 2)).toMatchObject({ ok: false, error: expect.stringMatching(/unknown key: figure/) })
  })
  it('points the host\'s Helm page at the scene, asking it to fit, and passes autoplay only when it is on', () => {
    expect(embedSrc('helm', 'https://example.com/helm/embed', 'doug-walk')).toBe('https://example.com/helm/embed?scene=doug-walk&fit=content')
    expect(embedSrc('helm', 'https://example.com/helm/embed', 'doug-walk', { autoplay: 'true' })).toBe('https://example.com/helm/embed?scene=doug-walk&autoplay=true&fit=content')
    expect(embedSrc('helm', 'https://example.com/helm/embed', 'doug-walk', { autoplay: 'false' })).toBe('https://example.com/helm/embed?scene=doug-walk&fit=content')
  })
})

describe('every embed kind', () => {
  it('lists the four kinds', () => {
    expect([...EMBED_KINDS].sort()).toEqual(['figure', 'helm', 'messages', 'simulator'])
  })
})

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
    expect(simulatorSrc('https://example.com/simulator/embed', 'diane-meeting-prep')).toBe('https://example.com/simulator/embed?scenario=diane-meeting-prep&timeline=off&fit=content')
  })
  it('refuses an embed address that is not https', () => {
    expect(simulatorSrc('http://example.com/embed', 'a')).toBeNull()
    expect(simulatorSrc('javascript:alert(1)', 'a')).toBeNull()
  })
})

describe('the messages block', () => {
  it('takes an optional chat and a caption', () => {
    expect(parseEmbedFence('messages', 'chat: fritz\ncaption: Fritz, in his own words.', 1)).toEqual({ ok: true, block: { value: 'fritz', caption: 'Fritz, in his own words.', height: '760px' } })
    expect(parseEmbedFence('messages', 'caption: The whole inbox.', 1)).toEqual({ ok: true, block: { value: null, caption: 'The whole inbox.', height: '760px' } })
  })
  it('refuses a missing caption, a bad chat id or an unknown key', () => {
    expect(parseEmbedFence('messages', 'chat: fritz', 2).ok).toBe(false)
    expect(parseEmbedFence('messages', 'chat: Fritz H\ncaption: x', 2).ok).toBe(false)
    expect(parseEmbedFence('messages', 'scenario: a\ncaption: x', 2)).toMatchObject({ ok: false, error: expect.stringMatching(/unknown key: scenario/) })
  })
  it('points the host\'s messages page at the chat, or at the list when there is none', () => {
    expect(embedSrc('messages', 'https://example.com/messages/embed', 'fritz')).toBe('https://example.com/messages/embed?chat=fritz')
    expect(embedSrc('messages', 'https://example.com/messages/embed', null)).toBe('https://example.com/messages/embed')
    expect(embedSrc('messages', 'http://example.com/messages/embed', 'a')).toBeNull()
  })
})

describe('a frame that fits its player', () => {
  it('asks the session demo to fit, and leaves the Messages phone as it was', () => {
    expect(embedSrc('simulator', 'https://example.com/simulator/embed', 'a-b')).toContain('fit=content')
    expect(embedSrc('messages', 'https://example.com/messages/embed', 'fritz')).toBe('https://example.com/messages/embed?chat=fritz')
  })
  it('takes a height only from its own embed page, as a sane number of pixels', () => {
    const from = 'https://example.com'
    expect(fitFrom({ type: 'embed:fit', height: 512.4 }, from, 'https://example.com/simulator/embed?scenario=a')).toBe(513)
    expect(fitFrom({ type: 'embed:fit', height: 512 }, 'https://evil.example', 'https://example.com/simulator/embed')).toBeNull()
    expect(fitFrom({ type: 'session-player:height', height: 512 }, from, 'https://example.com/x')).toBeNull()
    expect(fitFrom({ type: 'embed:fit', height: '512' }, from, 'https://example.com/x')).toBeNull()
    expect(fitFrom({ type: 'embed:fit', height: NaN }, from, 'https://example.com/x')).toBeNull()
    expect(fitFrom('embed:fit', from, 'https://example.com/x')).toBeNull()
    expect(fitFrom(null, from, 'https://example.com/x')).toBeNull()
    expect(fitFrom({ type: 'embed:fit', height: 20 }, from, 'https://example.com/x')).toBe(FIT_MIN)
    expect(fitFrom({ type: 'embed:fit', height: 90000 }, from, 'https://example.com/x')).toBe(FIT_MAX)
    expect(fitFrom({ type: 'embed:fit', height: 500 }, from, 'not a url')).toBeNull()
  })
})
