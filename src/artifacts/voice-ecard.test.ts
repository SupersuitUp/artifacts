// `template: voice-ecard`: the front matter, the choreography's phases and timings, the geometry at the
// three sizes that matter, the wrap cover rule and the read-along, all from voice-ecard.ts, the one file
// the parser, the reader's browser and these tests share.
import { describe, it, expect } from 'vitest'
import { parseArtifactSource } from './front-matter.js'
import {
  VOICE_ECARD_OCCASIONS, ENVELOPE_COLORS, DEFAULT_ENVELOPE, RISE_MS, OPEN_MS, ZOOM_MS, CLOSE_MS, OPENING_MS, nextPhase,
  spreadGeom, viewportSize, cardBox, closeSpot, tiltHint, onePage, WRAP_FRONT, wrapFrontCrop, openCardBox, letterFontPx, REF_PAGE, REF_LETTER_FONT,
  letterParagraphs, readAlong, wordState, reachedLastWord, timingsFromJson, letterMismatch, type VoiceEcardPhase, type VoiceEcardTiming,
} from './voice-ecard.js'
import { ENVELOPE_PAPER, LINER_PAPER, LETTER_PAPER } from './voice-ecard-assets.js'
import { LINER_FOR } from './voice-ecard.js'

const WORDS: VoiceEcardTiming[] = [
  { w: 'Dear', s: 4.0, e: 4.3 }, { w: 'Robin,', s: 4.35, e: 4.9, br: 1 },
  { w: 'Thank', s: 5.6, e: 5.9 }, { w: 'you', s: 5.95, e: 6.1 }, { w: 'for', s: 6.15, e: 6.3 }, { w: 'this', s: 6.35, e: 6.6 }, { w: 'year.', s: 6.65, e: 7.2 },
]
const timingsYaml = (ws: VoiceEcardTiming[]) => `timings:\n${ws.map((t) => `  - { w: ${JSON.stringify(t.w)}, s: ${t.s}, e: ${t.e}${t.br ? ', br: 1' : ''} }`).join('\n')}\n`
const src = (fm: string, body = '') => `---\ntitle: Happy Thanksgiving\nsummary: A card for you\ntemplate: voice-ecard\n${fm}---\n${body}`
const BASE = 'to: Robin\nfrom: Sam\n'

describe('front matter: template: voice-ecard', () => {
  it('is its own kind with its own keys, defaults filled', () => {
    const r = parseArtifactSource(src(BASE + 'occasion: thanksgiving\n'))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.template).toBe('voice-ecard')
    expect(r.meta.to).toBe('Robin')
    expect(r.meta.voiceEcard).toEqual({ from: 'Sam', occasion: 'thanksgiving', envelope: 'gold', mark: true })
    // A reply needs shared comments, so a card takes them from anyone unless it says otherwise.
    expect(r.meta.comments).toBe('anyone')
  })
  it('takes every voice eCard key', () => {
    const r = parseArtifactSource(src(BASE + [
      'occasion: christmas', 'envelope: brand', 'cover: https://cdn.example.com/wrap.webp', 'inner: /art/inner.webp',
      'background: https://cdn.example.com/scene.png', 'cinemagraph: wxmmto7dj6mleawz66xc', 'font: script',
      'audio: https://cdn.example.com/card.m4a', 'mark: false', 'comments: off',
    ].join('\n') + '\n' + timingsYaml(WORDS), 'Dear Robin,\n\nThank you for this year.\n'))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.cover).toBe('https://cdn.example.com/wrap.webp')
    expect(r.meta.comments).toBe('off')
    expect(r.meta.voiceEcard).toEqual({
      from: 'Sam', occasion: 'christmas', envelope: 'brand', inner: '/art/inner.webp', background: 'https://cdn.example.com/scene.png',
      cinemagraph: 'wxmmto7dj6mleawz66xc', font: 'script', audio: 'https://cdn.example.com/card.m4a', words: WORDS, mark: false,
    })
  })
  it('takes timings as an address too, kept where narration keeps its own', () => {
    const r = parseArtifactSource(src(BASE + 'audio: /a/card.m4a\ntimings: https://cdn.example.com/card.timings.json\n'))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.timings).toBe('https://cdn.example.com/card.timings.json')
    expect(r.meta.voiceEcard?.words).toBeUndefined()
  })
  it('defaults the envelope by occasion: BlessOut\'s holiday colours, navy otherwise', () => {
    for (const o of VOICE_ECARD_OCCASIONS) {
      const r = parseArtifactSource(src(BASE + `occasion: ${o}\n`))
      expect(r.ok && r.meta.voiceEcard?.envelope).toBe(DEFAULT_ENVELOPE[o])
    }
    expect(DEFAULT_ENVELOPE.thanksgiving).toBe('gold')
    expect(DEFAULT_ENVELOPE.christmas).toBe('red')
    expect(DEFAULT_ENVELOPE.other).toBe('navy')
  })
  const refusals: [string, string, string?][] = [
    ['from: Sam\n', 'to:'],
    ['to: Robin\n', 'from:'],
    [BASE + 'occasion: halloween\n', 'occasion must be one of'],
    [BASE + 'envelope: plaid\n', 'envelope must be brand or one of'],
    [BASE + 'cover: wrap.webp\n', 'cover must be an https address'],
    [BASE + 'inner: http://cdn.example.com/i.png\n', 'inner must be an https address'],
    [BASE + 'background: javascript:alert(1)\n', 'background must be an https address'],
    [BASE + 'audio: //cdn.example.com/a.m4a\n', 'audio must be an https address'],
    [BASE + 'cinemagraph: "../evil"\n', 'cinemagraph must be a Flixel'],
    [BASE + 'font: comic\n', 'font must be one of'],
    [BASE + 'mark: maybe\n', 'mark must be true or false'],
    [BASE + timingsYaml(WORDS), 'add audio:'],
    [BASE + 'audio: /a.m4a\ntimings:\n  - { w: Hi, s: 2, e: 1 }\n', 'e at or after s'],
    [BASE + 'audio: /a.m4a\ntimings:\n  - { w: Hi, s: 2, e: 3 }\n  - { w: there, s: 1, e: 3 }\n', 'starts before'],
    [BASE + 'audio: /a.m4a\ntimings: []\n', 'non-empty'],
    [BASE + 'audio: /a.m4a\n' + timingsYaml(WORDS), 'disagree at word 3', 'Dear Robin,\n\nThanks for this year.\n'],
    [BASE + 'voice: kokoro\n', 'takes no voice'],
    [BASE + 'narration: https://cdn.example.com/n.mp3\n', 'takes no narration'],
    [BASE + 'goal: listen\n', 'goal: listen needs'],
  ]
  for (const [fm, why, body] of refusals) {
    it(`refuses, in words: ${why}`, () => {
      const r = parseArtifactSource(src(fm, body))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain(why)
    })
  }
  it('refuses a voice eCard key on any other page', () => {
    for (const k of ['from: Sam', 'occasion: birthday', 'envelope: gold', 'inner: /i.png', 'background: /b.png', 'cinemagraph: abcdefgh12', 'font: script', 'audio: /a.m4a']) {
      const r = parseArtifactSource(`---\ntitle: T\nsummary: S\n${k}\n---\nx\n`)
      expect(r.ok, k).toBe(false)
      if (!r.ok) expect(r.error).toContain('template: voice-ecard')
    }
  })
  it('mark: none still means what it always meant on a document; true and false are a card\'s', () => {
    const doc = parseArtifactSource('---\ntitle: T\nsummary: S\nmark: none\n---\nx\n')
    expect(doc.ok && doc.meta.mark).toBe('none')
    expect(parseArtifactSource('---\ntitle: T\nsummary: S\nmark: false\n---\nx\n').ok).toBe(false)
  })
  it('names voice-ecard in the template error', () => {
    const r = parseArtifactSource('---\ntitle: T\nsummary: S\ntemplate: poster\n---\nx\n')
    expect(!r.ok && r.error).toContain('voice-ecard')
  })
  it('a letter whose body says the timings\' words is accepted; punctuation and case do not count', () => {
    expect(letterMismatch('dear robin\n\nthank you, for this year', WORDS)).toBeNull()
    const r = parseArtifactSource(src(BASE + 'audio: /a.m4a\ngoal: listen\n' + timingsYaml(WORDS), 'Dear Robin,\n\nThank you for this year.\n'))
    expect(r.ok && r.meta.goal).toBe('listen')
  })
})

describe('the choreography: BlessOut\'s phases and timings', () => {
  it('rises 800, opens 950, zooms 700, closes 450', () => {
    expect([RISE_MS, OPEN_MS, ZOOM_MS, CLOSE_MS]).toEqual([800, 950, 700, 450])
    expect(OPENING_MS).toBe(2450)
  })
  it('runs idle → rising → opening → zooming → open, and closing back to idle', () => {
    const seen: VoiceEcardPhase[] = []
    let p: VoiceEcardPhase = 'rising'
    let t = 0
    for (;;) {
      seen.push(p)
      const n = nextPhase(p)
      if (!n) break
      t += n.after
      p = n.next
    }
    expect(seen).toEqual(['rising', 'opening', 'zooming', 'open'])
    expect(t).toBe(2450)
    expect(nextPhase('closing')).toEqual({ next: 'idle', after: 450 })
    expect(nextPhase('idle')).toBeNull()
    expect(nextPhase('open')).toBeNull()
  })
})

describe('geometry', () => {
  const win = (w: number, h: number, vv?: { width: number; height: number; scale: number }) => ({ innerWidth: w, innerHeight: h, document: { documentElement: { clientWidth: w, clientHeight: h } }, visualViewport: vv ?? null })
  // Gary, 2026-11-24, on an iPhone held sideways: "the card should shrink proportionally to what a
  // card would, like card proportions. So the text could be very small, which is okay." The open
  // card is one reference-size card (3:4 pages, a 3:2 spread) scaled as a unit to fit the screen.
  const sizes: [number, number][] = [[844, 390], [390, 844], [932, 430], [1280, 800], [2000, 921]]
  for (const [w, h] of sizes) {
    it(`${w}x${h}: the whole open card fits the screen at card proportions, scaled as one unit`, () => {
      const v = viewportSize(win(w, h))
      const g = spreadGeom(v)
      const one = onePage(v)
      const box = openCardBox(g, one)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.left + box.width).toBeLessThanOrEqual(w)
      expect(box.top + box.height).toBeLessThanOrEqual(h)
      // One page is 3:4; the spread is 3:2.
      expect(Math.abs(box.width / box.height - (one ? 3 / 4 : 3 / 2)) / (one ? 3 / 4 : 3 / 2)).toBeLessThan(0.01)
      expect(Math.abs(g.pw / g.ph - 3 / 4)).toBeLessThan(0.0075)
      // Every size on the page is the reference size times one scale factor.
      expect(g.pw).toBeCloseTo(REF_PAGE.w * g.scale, 6)
      expect(g.ph).toBeCloseTo(REF_PAGE.h * g.scale, 6)
      expect(letterFontPx(g)).toBeCloseTo(REF_LETTER_FONT * g.scale, 6)
      // It fills the screen in its tight direction, with only the margin left over.
      const tight = one ? Math.min((w - 2 * g.margin) / REF_PAGE.w, (h - 2 * g.margin) / REF_PAGE.h) : Math.min((w - 2 * g.margin) / (2 * REF_PAGE.w), (h - 2 * g.margin) / REF_PAGE.h)
      expect(g.scale).toBeCloseTo(tight, 6)
      // The folded card in flight fits too.
      expect(g.riseTop + g.fh).toBeLessThanOrEqual(h)
      expect(g.fw / g.fh).toBeCloseTo(3 / 4, 6)
    })
  }
  it('a portrait phone sees one page with the tilt hint; landscape and desktop the whole spread', () => {
    expect(onePage({ vw: 390, vh: 844 })).toBe(true)
    expect(tiltHint('open', { vw: 390, vh: 844 })).toBe(true)
    expect(tiltHint('zooming', { vw: 390, vh: 844 })).toBe(false)
    for (const [vw, vh] of [[844, 390], [932, 430], [1280, 800], [2000, 921]]) expect(tiltHint('open', { vw, vh })).toBe(false)
    const one = spreadGeom({ vw: 390, vh: 844 })
    expect(one.spineX).toBeCloseTo((390 - one.pw) / 2)
    const spread = spreadGeom({ vw: 844, vh: 390 })
    expect(spread.spineX).toBe(422)
  })
  it('the close medallion sits on the open card\'s top-right corner, on screen', () => {
    for (const [vw, vh] of sizes) {
      const g = spreadGeom({ vw, vh })
      const c = closeSpot(g)
      expect(c.left + 42).toBeLessThanOrEqual(vw)
      expect(c.top).toBeGreaterThanOrEqual(0)
      expect(c.left).toBeCloseTo(Math.min(vw - 52, g.spineX + g.pw - 24))
    }
  })
  it('the visual viewport wins over stale layout numbers, except while pinch-zoomed', () => {
    expect(viewportSize(win(390, 844, { width: 390, height: 727, scale: 1 }))).toEqual({ vw: 390, vh: 727 })
    expect(viewportSize(win(390, 844, { width: 195, height: 400, scale: 2 }))).toEqual({ vw: 390, vh: 844 })
  })
  it('the card flies from the letter\'s box to the risen fold, slides its spine to the middle, then opens full size', () => {
    const g = spreadGeom({ vw: 1280, vh: 800 })
    const from = { top: 400, left: 600, width: 320, height: 80 }
    expect(cardBox('rising', from, false, g)).toEqual(from)
    expect(cardBox('rising', from, true, g)).toEqual({ top: g.riseTop, left: (1280 - g.fw) / 2, width: g.fw, height: g.fh })
    expect(cardBox('opening', from, true, g)).toEqual({ top: g.riseTop, left: 640, width: g.fw, height: g.fh })
    for (const p of ['zooming', 'open', 'closing'] as const) expect(cardBox(p, from, true, g)).toEqual({ top: g.pTop, left: 640, width: g.pw, height: g.ph })
  })

})

describe('the wrap cover', () => {
  it('draws the right half of a landscape wrap on the front, at 3:4', () => {
    expect(WRAP_FRONT).toEqual({ backgroundSize: '200% 100%', backgroundPosition: '100% 50%' })
    const crop = wrapFrontCrop(2400, 1600)
    expect(crop).toEqual({ x: 1200, y: 0, width: 1200, height: 1600 })
    expect(crop.width / crop.height).toBeCloseTo(3 / 4)
  })
  it('the folded card is the front\'s 3:4 shape', () => {
    const g = spreadGeom({ vw: 1280, vh: 800 })
    expect(g.fw / g.fh).toBeCloseTo(0.75)
  })
})

describe('the read-along', () => {
  it('the letter is the timings\' words, paragraphs where br says', () => {
    const paras = letterParagraphs(WORDS)
    expect(paras.map((p) => p.map((x) => x.word).join(' '))).toEqual(['Dear Robin,', 'Thank you for this year.'])
    expect(paras.flat().map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
  const at = (t: number, started = true) => {
    const a = readAlong(WORDS, t, started)
    return WORDS.map((_, i) => wordState(i, a, started))
  }
  it('nothing is dimmed before the voice starts', () => {
    expect(at(0, false)).toEqual(WORDS.map(() => null))
  })
  it('lights the word being said, keeps said words in full ink, fades the rest', () => {
    expect(readAlong(WORDS, 3.9, true).lit).toBe(-1)
    expect(at(3.9)).toEqual(Array(7).fill('coming'))
    expect(at(4.1)).toEqual(['saying', 'coming', 'coming', 'coming', 'coming', 'coming', 'coming'])
    expect(at(4.5)).toEqual(['said', 'saying', 'coming', 'coming', 'coming', 'coming', 'coming'])
    // A pause between paragraphs: the last word said stays said, never faded back.
    expect(at(5.4)).toEqual(['said', 'said', 'coming', 'coming', 'coming', 'coming', 'coming'])
    expect(at(6.2)).toEqual(['said', 'said', 'said', 'said', 'saying', 'coming', 'coming'])
    expect(at(9)).toEqual(Array(7).fill('said'))
  })
  it('a play is listened to the end when the last word has begun', () => {
    expect(reachedLastWord(WORDS, 6.6)).toBe(false)
    expect(reachedLastWord(WORDS, 6.65)).toBe(true)
    expect(reachedLastWord([], 100)).toBe(false)
  })
  it('reads a timings file in either shape, and nothing from a broken one', () => {
    expect(timingsFromJson(WORDS)).toEqual(WORDS)
    expect(timingsFromJson({ words: WORDS })).toEqual(WORDS)
    expect(timingsFromJson([{ t: 1, e: 2 }])).toEqual([])
    expect(timingsFromJson(null)).toEqual([])
  })
})

describe('the papers ship inside the package', () => {
  it('has every envelope colour, every occasion\'s liner, and the letter paper, as WebP data', () => {
    for (const c of ENVELOPE_COLORS) expect(ENVELOPE_PAPER[c], c).toMatch(/^data:image\/webp;base64,/)
    for (const o of VOICE_ECARD_OCCASIONS) expect(LINER_PAPER[LINER_FOR[o]], o).toMatch(/^data:image\/webp;base64,/)
    expect(LETTER_PAPER).toMatch(/^data:image\/webp;base64,/)
  })
})
