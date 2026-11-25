// What the server hands the voice eCard scene for one stored page: the papers as CSS image values,
// the Gilded Stationer's navy and gold or the page's own brand, the face, the letter and its words.
// Server-side (it reads the papers, which only reach the page a voice eCard uses). Pure apart from
// that, so the route and the tests read one answer.
import { musicCredit, musicTrack } from './music.js'
import { blockId } from './anchor.js'
import { narrationTextFromMarkdown } from './narration.js'
import { LINER_FOR, timingsFromJson, type VoiceEcardSpec, type VoiceEcardTiming } from './voice-ecard.js'
import { ENVELOPE_PAPER, LETTER_PAPER, LINER_PAPER } from './voice-ecard-assets.js'

/** BlessOut's "Gilded Stationer" (docs/design-language.md): navy #09164d, gold foil #e7cb75. */
export const GILDED = { navy: '#09164d', foil: '#e7cb75' } as const

export const FACES = {
  serif: '"Cormorant Garamond", "EB Garamond", "Newsreader", Georgia, "Times New Roman", serif',
  script: '"Dancing Script", "Snell Roundhand", "Apple Chancery", "Segoe Script", cursive',
} as const

export type VoiceEcardLook = {
  envelope: string; liner: string; paper: string; foil: string; navy: string; face: string; italic: boolean; title: string
}

/** How a voice eCard looks: its paper envelope and gold, or with `envelope: brand` the page's own
 *  accent as the foil and its colours as the envelope; the face its `font:` names (the pack's
 *  display face for `display`, its body face for `sans`), a serif by default and the pack's display
 *  face by default on a brand envelope. Every face but the script is set in italic, as BlessOut sets
 *  every non-cursive face. */
export function voiceEcardLook(spec: VoiceEcardSpec, type: { display: string; body: string }): VoiceEcardLook {
  const brand = spec.envelope === 'brand'
  const font = spec.font ?? (brand ? 'display' : 'serif')
  const face = font === 'display' ? type.display : font === 'sans' ? type.body : FACES[font]
  return {
    envelope: brand
      ? 'linear-gradient(140deg, color-mix(in srgb, var(--a-accent) 42%, var(--a-ground)) 0%, color-mix(in srgb, var(--a-accent) 18%, var(--a-ground)) 55%, var(--a-ground) 100%)'
      : `url("${ENVELOPE_PAPER[spec.envelope]}")`,
    liner: `url("${LINER_PAPER[brand ? 'white' : LINER_FOR[spec.occasion]]}")`,
    paper: `url("${LETTER_PAPER}")`,
    foil: brand ? 'var(--a-accent)' : GILDED.foil,
    navy: brand ? 'color-mix(in srgb, var(--a-accent) 22%, #141623)' : GILDED.navy,
    face,
    italic: font !== 'script',
    title: type.display,
  }
}

/** The letter as plain paragraphs (blank line between), from the body's words. */
export function letterText(markdown: string): string {
  return narrationTextFromMarkdown(markdown).split('\n').join('\n\n')
}

/** A voice eCard's timed words: the ones it carries, else its `timings:` file, else none. A file that
 *  cannot be read leaves the letter static rather than failing the page. */
export async function voiceEcardWords(spec: VoiceEcardSpec, timingsUrl: string | undefined, fetchJson: (url: string) => Promise<unknown>): Promise<VoiceEcardTiming[]> {
  if (spec.words?.length) return spec.words
  if (!timingsUrl) return []
  try { return timingsFromJson(await fetchJson(timingsUrl)) } catch { return [] }
}

/** The stored file's name, as play tracking names it: the last path segment before any query. */
export function recordingName(src: string): string {
  const last = src.split(/[?#]/)[0].split('/').pop() ?? ''
  let name = last
  try { name = decodeURIComponent(last) } catch { /* keep it as written */ }
  // The /seen route takes letters, digits, dots, dashes and underscores.
  return name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 141) || 'recording'
}

/** The block the letter is, for a reply pinned to it: stable across republishes of the same letter. */
export const letterBlockId = (to: string, from: string) => blockId('card', 0, `${to}\n${from}`)

/** "November 24, 2026", the line under the letter (BlessOut's createdAt line), in UTC so the server
 *  and the reader's browser agree. */
export function dateLine(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/** The credit line a card draws under its letter (0.75.0): a catalog track with a known artist,
 *  "Music: <song> by <artist>". A custom track, a track with no artist on file, or none: nothing. */
export function voiceEcardMusicCredit(spec: VoiceEcardSpec): string | undefined {
  if (!spec.music || !('track' in spec.music)) return undefined
  const t = musicTrack(spec.music.track)
  return (t && musicCredit(t)) ?? undefined
}
