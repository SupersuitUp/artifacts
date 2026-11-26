// `template: voice-ecard` (0.74.0), the voice eCard: a greeting card that arrives in an envelope. The reader sees the
// envelope float over a scene, opens it (hover on a desktop, a tap on a phone), the folded card
// rises out of it, swings open, and zooms to a spread whose inside-right page holds the letter,
// read along word by word to the sender's own voice.
//
// PORTED, NOT REDRAWN. The choreography, its timings, the geometry and the iOS viewport lessons
// are BlessOut's (components/BlessingDetailPage.tsx, lib/cardGeometry.ts, 2026-07-16), copied
// here number for number so the two cannot be told apart; what this package adds is listed in
// README "Cards". Pure and browser-safe: the parser, the reader's browser and the tests all read
// the same rules from this one file.
import { normalizeWord } from './narration.js'
import { begunCount, litWordIndex } from '../reader/karaoke.js'
import { letterLineBreaksIn } from './letter-breaks.js'

/** What a card is for. Picks the envelope and its liner when the file names neither. */
export const VOICE_ECARD_OCCASIONS = ['thanksgiving', 'christmas', 'newyear', 'birthday', 'other'] as const
export type VoiceEcardOccasion = (typeof VOICE_ECARD_OCCASIONS)[number]

/** BlessOut's envelope papers, by colour. */
export const ENVELOPE_COLORS = ['red', 'green', 'gold', 'purple', 'black', 'blue', 'navy', 'pink', 'slate'] as const
export type EnvelopeColor = (typeof ENVELOPE_COLORS)[number]
/** `brand`: the envelope is drawn in the page's own brand colours instead of a paper. */
export type EnvelopeChoice = EnvelopeColor | 'brand'

/** The letter's face: the pack's display face (the default), a serif, a script, or a sans. */
export const VOICE_ECARD_FONTS = ['display', 'serif', 'script', 'sans'] as const
export type VoiceEcardFont = (typeof VOICE_ECARD_FONTS)[number]

/** One spoken word, as BlessOut's mixer writes it (scripts/mix-voiceover.mjs): the word, when it
 *  starts and ends in the MIXED file, in seconds, and `br: 1` when a paragraph ends after it. */
export type VoiceEcardTiming = { w: string; s: number; e: number; br?: number }

/** Everything a card is beyond a page's own title, summary, `to:` and `cover:`. */
export type VoiceEcardSpec = {
  from: string
  occasion: VoiceEcardOccasion
  envelope: EnvelopeChoice
  /** The inside-left page's art. */
  inner?: string
  /** The scene the envelope floats over. */
  background?: string
  /** A Flixel cinemagraph id, played behind the envelope instead of the still scene. */
  cinemagraph?: string
  font?: VoiceEcardFont
  /** The mixed voice-over-music file. */
  audio?: string
  /** The words, timed, when the file carries them inline. A `timings:` URL is fetched at render. */
  words?: VoiceEcardTiming[]
  /** The small "Made with Supersuit" line under the closed envelope. Default on. */
  mark: boolean
  /** `names: off`: no "To:" and "From:" labels anywhere on the card (the letter already says who).
   *  Present only when off; `to:` still names the reader for links and the summary. */
  names?: false
  /** `greeting: reader` (0.77.0): opened through one named reader's link, the letter's first line is
   *  "Dear <their first name>," taken from that link's label, so one shared card greets each reader.
   *  Present only when on. Nothing for the owner's link, a group link, a forward, or no link. */
  greeting?: 'reader'
}

/** The colour a card's envelope takes when the file does not name one: BlessOut's holiday
 *  defaults (gold for Thanksgiving, red for Christmas), and the Gilded Stationer's navy otherwise. */
export const DEFAULT_ENVELOPE: Record<VoiceEcardOccasion, EnvelopeColor> = {
  thanksgiving: 'gold', christmas: 'red', newyear: 'navy', birthday: 'pink', other: 'navy',
}
/** The liner inside the envelope's flap and back, by occasion. */
export const LINER_FOR: Record<VoiceEcardOccasion, string> = {
  thanksgiving: 'light-leaves', christmas: 'ornaments', newyear: 'stars', birthday: 'festive', other: 'white',
}

/** The front matter keys only a card takes. */
export const VOICE_ECARD_KEYS = ['from', 'occasion', 'envelope', 'inner', 'background', 'cinemagraph', 'font', 'audio', 'names', 'greeting'] as const

/** Lines a card cannot carry, refused in words rather than dropped. */
export const NOT_ON_A_VOICE_ECARD = ['voice', 'narration', 'narrationHash', 'file'] as const

export const MAX_FROM_CHARS = 60
export const MAX_VOICE_ECARD_WORDS = 4000
/** A Flixel cinemagraph id. */
export const CINEMAGRAPH_ID = /^[a-z0-9]{8,40}$/
export const FLIXEL_BASE = 'https://media.flixel.com/cinemagraph/'

/** An address a card's art or audio may come from: https, or a path on this host. Never a local
 *  file (the publisher uploads those first) and never a script URL. */
export function isVoiceEcardUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 2000 || /\s/.test(v)) return false
  if (v.startsWith('/') && !v.startsWith('//')) return true
  try { return new URL(v).protocol === 'https:' } catch { return false }
}

/** Inline timings, checked: a non-empty array of `{w, s, e, br?}` in order. */
export function parseVoiceEcardTimings(v: unknown): { ok: true; words: VoiceEcardTiming[] } | { ok: false; error: string } {
  if (!Array.isArray(v) || !v.length) return { ok: false, error: 'timings must be a non-empty list of {w, s, e} words, or the address of one' }
  if (v.length > MAX_VOICE_ECARD_WORDS) return { ok: false, error: `timings holds at most ${MAX_VOICE_ECARD_WORDS} words` }
  const words: VoiceEcardTiming[] = []
  let last = -Infinity
  for (let i = 0; i < v.length; i++) {
    const t = v[i] as Record<string, unknown> | null
    const ok = t && typeof t === 'object' && typeof t.w === 'string' && t.w.trim() && typeof t.s === 'number' && typeof t.e === 'number'
      && Number.isFinite(t.s) && Number.isFinite(t.e) && t.s >= 0 && t.e >= t.s
    if (!ok) return { ok: false, error: `timings word ${i + 1} needs {w: <word>, s: <start seconds>, e: <end seconds>} with e at or after s` }
    if ((t.s as number) < last) return { ok: false, error: `timings word ${i + 1} starts before the word ahead of it` }
    last = t.s as number
    if (t.br !== undefined && t.br !== 0 && t.br !== 1) return { ok: false, error: `timings word ${i + 1}: br is 1 (a paragraph ends here) or absent` }
    words.push({ w: (t.w as string).trim(), s: t.s as number, e: t.e as number, ...(t.br === 1 ? { br: 1 } : {}) })
  }
  return { ok: true, words }
}

/** Where a body and its timings first disagree, by word (normalized), or null when they say the
 *  same words. The card draws its letter from the timings, so a body that says something else
 *  would unfurl and print one letter while the card shows another. */
export function letterMismatch(body: string, words: VoiceEcardTiming[]): string | null {
  const said = words.map((t) => normalizeWord(t.w)).filter(Boolean)
  const written = body.split(/\s+/).map(normalizeWord).filter(Boolean)
  const n = Math.max(said.length, written.length)
  for (let i = 0; i < n; i++) {
    if (said[i] !== written[i]) return `the letter and its timings disagree at word ${i + 1}: the body says "${written[i] ?? '(nothing)'}", the timings say "${said[i] ?? '(nothing)'}"`
  }
  return null
}

/** The card's lines from the front matter, checked. `d` is the whole front matter. */
export function parseVoiceEcard(d: Record<string, unknown>, body: string): { ok: true; voiceEcard: VoiceEcardSpec; timingsUrl?: string } | { ok: false; error: string } {
  for (const k of NOT_ON_A_VOICE_ECARD) if (d[k] !== undefined && d[k] !== null) return { ok: false, error: `a voice eCard's voice is its audio: line, so it takes no ${k}` }
  if (typeof d.to !== 'string' || !d.to.trim()) return { ok: false, error: 'a voice eCard needs to: (who it is for)' }
  const from = typeof d.from === 'string' ? d.from.trim() : ''
  if (!from || from.length > MAX_FROM_CHARS || /[\r\n]/.test(from)) return { ok: false, error: `a voice eCard needs from: one line naming who sent it, 1 to ${MAX_FROM_CHARS} characters` }
  const occasion = d.occasion ?? 'other'
  if (!VOICE_ECARD_OCCASIONS.includes(occasion as VoiceEcardOccasion)) return { ok: false, error: `occasion must be one of: ${VOICE_ECARD_OCCASIONS.join(', ')}` }
  const envelope = d.envelope ?? DEFAULT_ENVELOPE[occasion as VoiceEcardOccasion]
  if (envelope !== 'brand' && !ENVELOPE_COLORS.includes(envelope as EnvelopeColor)) return { ok: false, error: `envelope must be brand or one of: ${ENVELOPE_COLORS.join(', ')}` }
  const spec: VoiceEcardSpec = { from, occasion: occasion as VoiceEcardOccasion, envelope: envelope as EnvelopeChoice, mark: true }
  for (const k of ['cover', 'inner', 'background', 'audio'] as const) {
    const v = d[k]
    if (v === undefined || v === null) continue
    if (!isVoiceEcardUrl(v)) return { ok: false, error: `${k} must be an https address or a path on this host (the publisher uploads a local file first)` }
    if (k !== 'cover') spec[k] = v
  }
  if (d.cinemagraph !== undefined && d.cinemagraph !== null) {
    if (typeof d.cinemagraph !== 'string' || !CINEMAGRAPH_ID.test(d.cinemagraph)) return { ok: false, error: 'cinemagraph must be a Flixel cinemagraph id (lowercase letters and digits)' }
    spec.cinemagraph = d.cinemagraph
  }
  if (d.font !== undefined && d.font !== null) {
    if (!VOICE_ECARD_FONTS.includes(d.font as VoiceEcardFont)) return { ok: false, error: `font must be one of: ${VOICE_ECARD_FONTS.join(', ')}` }
    spec.font = d.font as VoiceEcardFont
  }
  if (d.mark !== undefined && d.mark !== null) {
    if (d.mark !== true && d.mark !== false && d.mark !== 'none') return { ok: false, error: 'mark must be true or false on a voice eCard' }
    spec.mark = d.mark === true
  }
  if (d.names !== undefined && d.names !== null) {
    // YAML 1.1 readers turn a bare off/on into false/true, so both spellings mean the same.
    const v = typeof d.names === 'string' ? d.names.trim().toLowerCase() : d.names
    if (v === 'off' || v === false) spec.names = false
    else if (v !== 'on' && v !== true) return { ok: false, error: 'names must be on or off on a voice eCard' }
  }
  if (d.greeting !== undefined && d.greeting !== null) {
    const v = typeof d.greeting === 'string' ? d.greeting.trim().toLowerCase() : d.greeting
    if (v === 'reader') spec.greeting = 'reader'
    else if (v !== 'off' && v !== false) return { ok: false, error: 'greeting must be reader or off on a voice eCard' }
  }
  let timingsUrl: string | undefined
  if (d.timings !== undefined && d.timings !== null) {
    if (typeof d.timings === 'string') {
      if (!isVoiceEcardUrl(d.timings)) return { ok: false, error: 'timings must be a list of {w, s, e} words, or an https address or a path on this host holding one' }
      timingsUrl = d.timings
    } else {
      const t = parseVoiceEcardTimings(d.timings)
      if (!t.ok) return { ok: false, error: t.error }
      if (body.trim()) {
        const why = letterMismatch(body, t.words)
        if (why) return { ok: false, error: why }
      }
      spec.words = t.words
    }
    if (!spec.audio) return { ok: false, error: 'timings follow a recording: add audio:' }
  }
  return { ok: true, voiceEcard: spec, ...(timingsUrl ? { timingsUrl } : {}) }
}

/** A first name a greeting may print: letters, then letters, marks, apostrophes, dots or hyphens,
 *  at most 40 characters. Anything else (markup, an address, a number) prints no greeting at all. */
export const GREETING_NAME = /^\p{L}[\p{L}\p{M}'\u2019.-]{0,39}$/u

/** The line a `greeting: reader` card opens with for this link: "Dear <first word of its label>,",
 *  or null for the owner's link, a group link, a forward, no link, or a label whose first word is
 *  not a name. Only that one word of the label ever reaches the page. */
export function readerGreeting(spec: Pick<VoiceEcardSpec, 'greeting'>, link: { label: string; owner: boolean; group: boolean; forwarded?: boolean } | undefined | null): string | null {
  if (spec.greeting !== 'reader' || !link || link.owner || link.group || link.forwarded) return null
  const first = (link.label ?? '').trim().split(/\s+/)[0]?.replace(/[,;:]+$/, '') ?? ''
  return GREETING_NAME.test(first) ? `Dear ${first},` : null
}

/** A timings file as fetched: BlessOut's bare array, or `{ words: [...] }` as narration writes it. */
export function timingsFromJson(json: unknown): VoiceEcardTiming[] {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? (json as { words?: unknown }).words : null
  const r = parseVoiceEcardTimings(list)
  return r.ok ? r.words : []
}

/** The letter's paragraphs, rebuilt from the timings the way the stored letter was built: a
 *  paragraph ends after every word marked `br`. The text is the timings', so the two cannot drift. */
export function letterParagraphs(words: VoiceEcardTiming[]): { word: string; index: number }[][] {
  const out: { word: string; index: number }[][] = [[]]
  words.forEach((t, index) => {
    out[out.length - 1].push({ word: t.w, index })
    if (t.br) out.push([])
  })
  if (!out[out.length - 1].length) out.pop()
  return out
}

/** The letter's paragraphs as lines: the greeting and the sign-off on lines of their own, by the
 *  letter rule in letter-breaks.ts (letterLineBreaksIn). Every word keeps its index, so the
 *  read-along's timing is untouched; only where a line ends changes. */
export function letterLines(words: VoiceEcardTiming[]): { word: string; index: number }[][][] {
  return withLines(letterParagraphs(words))
}

/** Any letter's paragraphs (from timings or from the body) as lines, by the same rule. */
export function withLines(paras: { word: string; index: number }[][]): { word: string; index: number }[][][] {
  return paras.map((p, i) => {
    const cuts = letterLineBreaksIn(p.map((x) => x.word), i === 0, i === paras.length - 1)
    const lines: { word: string; index: number }[][] = [[]]
    p.forEach((x, k) => { lines[lines.length - 1].push(x); if (cuts.includes(k) && k < p.length - 1) lines.push([]) })
    return lines
  })
}

/** The letter as text with its lines, for the envelope's peek. */
export const letterPreview = (words: VoiceEcardTiming[]) => letterLines(words).map((p) => p.map((l) => l.map((x) => x.word).join(' ')).join('\n')).join('\n')

/** A letter with no timings, from the body: one paragraph per blank-line block, words split on
 *  whitespace, so the same component draws it. */
export function letterFromText(text: string): { word: string; index: number }[][] {
  let index = 0
  return text.split(/\n\s*\n/).map((p) => p.split(/\s+/).filter(Boolean).map((word) => ({ word, index: index++ }))).filter((p) => p.length)
}

// ---- The choreography. BlessOut's phases and timings, unchanged.

export type VoiceEcardPhase = 'idle' | 'rising' | 'opening' | 'zooming' | 'open' | 'closing'
export const RISE_MS = 800
export const OPEN_MS = 950
export const ZOOM_MS = 700
export const CLOSE_MS = 450
/** The reduced-motion path: one cross-fade each way, no flight (an addition: BlessOut jumps). */
export const FADE_MS = 320

/** The phase that follows `p` on its timer, with how long `p` lasts; null when `p` waits for the
 *  reader (idle, open). */
export function nextPhase(p: VoiceEcardPhase): { next: VoiceEcardPhase; after: number } | null {
  switch (p) {
    case 'rising': return { next: 'opening', after: RISE_MS }
    case 'opening': return { next: 'zooming', after: OPEN_MS }
    case 'zooming': return { next: 'open', after: ZOOM_MS }
    case 'closing': return { next: 'idle', after: CLOSE_MS }
    default: return null
  }
}

/** The whole opening, start to the letter in hand: 2450 ms. */
export const OPENING_MS = RISE_MS + OPEN_MS + ZOOM_MS

// ---- Geometry: lib/cardGeometry.ts, unchanged.

export type ViewportSize = { vw: number; vh: number }
export type SpreadGeometry = {
  /** The folded card's size while it rises and opens (3:4). */
  fw: number; fh: number
  /** Top of the risen folded card. */
  riseTop: number
  /** The open page (inside-right) and where it sits: REF_PAGE times `scale`. */
  pw: number; ph: number
  /** The spine: the pages mirror around it. */
  spineX: number
  pTop: number
  /** The one factor the whole open card is drawn at, from its reference size. */
  scale: number
  /** The air kept between the open card and the screen's edge. */
  margin: number
  vw: number; vh: number
}

/** THE OPEN CARD HAS ONE SHAPE (the operator, 2026-11-24, an iPhone held sideways: "the card should shrink
 *  proportionally to what a card would, like card proportions. So the text could be very small,
 *  which is okay"). Each page is laid out at this reference size, 3:4, and the whole card, art,
 *  letter, type, buttons and frame, is scaled as one unit to fit the screen. The letter never
 *  reflows to the screen's shape. */
export const REF_PAGE = { w: 480, h: 640 } as const
/** The letter's type size on the reference page. */
export const REF_LETTER_FONT = 24
/** The letter's type size on screen. */
export const letterFontPx = (g: Pick<SpreadGeometry, 'scale'>) => REF_LETTER_FONT * g.scale

type ViewportWindow = {
  innerWidth: number; innerHeight: number
  document: { documentElement: { clientWidth: number; clientHeight: number } }
  visualViewport?: { width: number; height: number; scale: number } | null
}

/** What is actually visible. iOS Safari updates documentElement.client* late after a rotation,
 *  and 100vh includes what hides behind the collapsible toolbars, so visualViewport is the ground
 *  truth; take the smaller of the two. Ignore visualViewport while pinch-zoomed. */
export function viewportSize(w: ViewportWindow): ViewportSize {
  const layoutW = w.document.documentElement.clientWidth || w.innerWidth
  const layoutH = w.document.documentElement.clientHeight || w.innerHeight
  const vv = w.visualViewport
  if (vv && Math.abs(vv.scale - 1) < 0.02) return { vw: Math.min(layoutW, Math.round(vv.width)), vh: Math.min(layoutH, Math.round(vv.height)) }
  return { vw: layoutW, vh: layoutH }
}

/** Whether a viewport shows one page at a time: narrow AND portrait. Tilting a phone to landscape
 *  shows the whole spread. */
export const onePage = ({ vw, vh }: ViewportSize) => vw < 768 && vh > vw

/** The card's geometry: the folded card rises, slides so its spine lands mid-screen while the
 *  cover swings open, then the spread zooms to its size. The open card is REF_PAGE (one page on a
 *  portrait phone, two either side of the spine otherwise) at the largest scale that fits the
 *  visible screen with a small margin, so nothing is ever cut off. The flight (fw, fh, riseTop)
 *  keeps BlessOut's sizes, at 3:4, held inside the screen. */
export function spreadGeom(v: ViewportSize): SpreadGeometry {
  const { vw, vh } = v
  const m = onePage(v)
  const margin = Math.max(8, Math.min(24, Math.min(vw, vh) * 0.03))
  const across = m ? REF_PAGE.w : 2 * REF_PAGE.w
  const scale = Math.max(0.05, Math.min((vw - 2 * margin) / across, (vh - 2 * margin) / REF_PAGE.h))
  const pw = REF_PAGE.w * scale
  const ph = REF_PAGE.h * scale
  const spineX = m ? (vw - pw) / 2 : vw / 2
  const pTop = (vh - ph) / 2
  const fh = Math.min(m ? Math.min(vw * 0.44, 240) / 0.75 : Math.min(vh * 0.5, 460), vh - 2 * margin)
  const fw = fh * 0.75
  const riseTop = Math.min(Math.max(20, vh * 0.12), vh - margin - fh)
  return { fw, fh, riseTop, pw, ph, spineX, pTop, scale, margin, vw, vh }
}

/** The whole open card on screen: the page on a portrait phone, else both pages round the spine. */
export function openCardBox(g: SpreadGeometry, one: boolean): Box {
  return one ? { top: g.pTop, left: g.spineX, width: g.pw, height: g.ph } : { top: g.pTop, left: g.spineX - g.pw, width: 2 * g.pw, height: g.ph }
}

export type Box = { top: number; left: number; width: number; height: number }

/** Where the card (its inside-right page; the fold mirrors to its left) is in each phase. `from`
 *  is the letter's box in the envelope, where the flight starts; `flown` is false for the one frame
 *  the card sits there before it moves. */
export function cardBox(phase: VoiceEcardPhase, from: Box, flown: boolean, g: SpreadGeometry): Box {
  if (phase === 'rising' && !flown) return from
  if (phase === 'rising') return { top: g.riseTop, left: (g.vw - g.fw) / 2, width: g.fw, height: g.fh }
  if (phase === 'opening') return { top: g.riseTop, left: g.vw / 2, width: g.fw, height: g.fh }
  return { top: g.pTop, left: g.spineX, width: g.pw, height: g.ph }
}

/** The close control perched on the open card's top-right corner, kept on screen. */
export function closeSpot(g: SpreadGeometry): { top: number; left: number } {
  return { top: Math.max(10, g.pTop - 18), left: Math.min(g.vw - 52, g.spineX + g.pw - 24) }
}

/** Whether the open card says "Tilt your phone to see the whole card". */
export const tiltHint = (phase: VoiceEcardPhase, v: ViewportSize) => phase === 'open' && onePage(v)

/** The wrap cover rule: a cover is a landscape image whose RIGHT half is the front cover (its left
 *  half is the back). Drawn on the 3:4 front at twice its width, pinned right. */
export const WRAP_FRONT = { backgroundSize: '200% 100%', backgroundPosition: '100% 50%' } as const

/** The part of a wrap cover the front shows, in the image's own pixels: its right half. */
export function wrapFrontCrop(width: number, height: number): { x: number; y: number; width: number; height: number } {
  return { x: width / 2, y: 0, width: width / 2, height }
}

/** The word states of the read-along: said (full ink), saying (lit), coming (faded). */
export type WordState = 'said' | 'saying' | 'coming'

/** Where the read-along is at `now`, by the package's karaoke rules (`litWordIndex`, `begunCount`):
 *  the lit word (or -1 in a pause), and how many words have begun. Nothing is dimmed until the
 *  recording has started. */
export function readAlong(words: VoiceEcardTiming[], now: number, started: boolean): { lit: number; begun: number } {
  return started ? { lit: litWordIndex(words, now, true), begun: begunCount(words, now) } : { lit: -1, begun: 0 }
}

/** One word's state: the lit word, the words already begun (full ink, so a pause never fades
 *  what was said), and the rest still to come. Null when nothing plays: no word is dimmed. */
export function wordState(i: number, at: { lit: number; begun: number }, started: boolean): WordState | null {
  if (!started) return null
  return i === at.lit ? 'saying' : i < at.begun ? 'said' : 'coming'
}

/** Whether the recording has reached its last word: the play counts as listened to the end. */
export function reachedLastWord(words: VoiceEcardTiming[], now: number): boolean {
  return words.length > 0 && now >= words[words.length - 1].s
}
