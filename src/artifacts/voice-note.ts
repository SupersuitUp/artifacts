// Voice notes: an audio line in a page with its own words, timed, so they light up as they are
// spoken. Written as an ordinary audio line followed directly by a ```transcript fence:
//
//   ![Robin, to the family](hello.m4a)
//
//   ```transcript
//   0.00 0.62 Hello!
//   0.80 1.10 I
//   1.10 1.30 hope
//
//   2.00 2.40 Love,
//   ```
//
// One word per line: its start and end in seconds, then the word as it should read (a phrase
// timed together is fine). A blank line starts a new paragraph. The audio stays plain image
// syntax, so the publisher uploads it like any clip and needs no change; the words travel in the
// page. Pure and server-safe: parsing, the publish-time check, and the fence the helper writes.
import type { Root, RootContent, Code, Paragraph, Image } from 'mdast'
import type { WordTiming } from '../reader/karaoke.js'

export const TRANSCRIPT_LANG = 'transcript'
/** `![caption](x.mp3)` / `.m4a` is a clip the reader plays. */
export const AUDIO_SRC = /\.(mp3|m4a)(?:[?#].*)?$/i
export const isAudioSrc = (src: unknown): src is string => typeof src === 'string' && AUDIO_SRC.test(src)

/** A page this long is a book, not a voice note. */
export const MAX_TRANSCRIPT_WORDS = 20000

export type TranscriptParagraphs = WordTiming[][]

const ROW = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\S.*)$/
const GRAMMAR = 'a transcript line is "<start> <end> <word>" in seconds, like "1.10 1.30 hope"'

/** Parses a transcript fence's body. `line` is the line the fence opens on in the file, so every
 *  error names the line the author sees in their editor. */
export function parseTranscriptFence(value: string, line: number):
  { ok: true; paragraphs: TranscriptParagraphs } | { ok: false; error: string } {
  const paragraphs: TranscriptParagraphs = []
  let current: WordTiming[] = []
  let prev: WordTiming | null = null
  let count = 0
  const rows = value.split('\n')
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].trim()
    const at = line + 1 + i
    if (!raw) {
      if (current.length) paragraphs.push(current)
      current = []
      continue
    }
    const m = ROW.exec(raw)
    if (!m) return { ok: false, error: `line ${at}: ${GRAMMAR}` }
    const s = Number(m[1])
    const e = Number(m[2])
    if (e < s) return { ok: false, error: `line ${at}: this word ends before it starts (${m[1]} to ${m[2]})` }
    if (prev && s < prev.s) return { ok: false, error: `line ${at}: this word starts at ${m[1]}, before the word above it (${prev.s}); words go in the order they are spoken` }
    if (++count > MAX_TRANSCRIPT_WORDS) return { ok: false, error: `line ${at}: a transcript takes at most ${MAX_TRANSCRIPT_WORDS} words` }
    prev = { w: m[3].trim(), s, e }
    current.push(prev)
  }
  if (current.length) paragraphs.push(current)
  if (!count) return { ok: false, error: `line ${line}: this transcript has no words; ${GRAMMAR}` }
  return { ok: true, paragraphs }
}

/** The audio image a paragraph holds and nothing else (whitespace aside), or null. */
export function soleAudio(n: RootContent | undefined): Image | null {
  if (!n || n.type !== 'paragraph') return null
  const kids = (n as Paragraph).children.filter((c) => !(c.type === 'text' && !c.value.trim()))
  return kids.length === 1 && kids[0].type === 'image' && isAudioSrc(kids[0].url) ? kids[0] : null
}

type Parent = { children: RootContent[] }
const isParent = (n: unknown): n is Parent => !!n && typeof n === 'object' && Array.isArray((n as Parent).children)

/** Visits every transcript fence with the sibling right above it, at any depth. */
function eachTranscript(tree: Root, visit: (fence: Code, above: RootContent | undefined) => void) {
  const walk = (p: Parent) => {
    p.children.forEach((n, i) => {
      if (n.type === 'code' && n.lang === TRANSCRIPT_LANG) visit(n, p.children[i - 1])
      else if (isParent(n) && n.type !== 'paragraph' && n.type !== 'heading') walk(n)
    })
  }
  walk(tree)
}

/** The publish-time check: every transcript fence parses, takes no name, and sits directly under
 *  an audio line. `offset` is how many lines of the file sit above the body. */
export function scanVoiceNotes(tree: Root, offset: number): { ok: true; count: number } | { ok: false; error: string } {
  let error: string | null = null
  let count = 0
  eachTranscript(tree, (fence, above) => {
    if (error) return
    const line = (fence.position?.start.line ?? 1) + offset
    if (fence.meta?.trim()) { error = `line ${line}: the transcript block takes no name`; return }
    if (!soleAudio(above)) {
      error = `line ${line}: a transcript belongs directly under its voice note: put an audio line like ![caption](note.m4a) right above it`
      return
    }
    const r = parseTranscriptFence(fence.value, line)
    if (!r.ok) { error = r.error; return }
    count++
  })
  return error ? { ok: false, error } : { ok: true, count }
}

/** What the renderer draws for one voice note. */
export type VoiceNoteBlock = { src: string; label: string; paragraphs: TranscriptParagraphs }

/** Replaces each audio line + transcript pair with one node the renderer draws as a voice note,
 *  keeping the audio line's position so its comment anchor (blocksOf) is unchanged. A pair that
 *  does not parse is left alone: the audio plays as before and the fence draws nothing. `found`
 *  collects the notes; the node carries its index. */
export function remarkVoiceNotes(found: VoiceNoteBlock[]) {
  return () => (tree: Root) => {
    const walk = (p: Parent) => {
      const out: RootContent[] = []
      for (const n of p.children) {
        const above = out[out.length - 1]
        const audio = n.type === 'code' && n.lang === TRANSCRIPT_LANG && !n.meta?.trim() ? soleAudio(above) : null
        const r = audio ? parseTranscriptFence((n as Code).value, 0) : null
        if (audio && r?.ok) {
          found.push({ src: audio.url, label: audio.alt ?? '', paragraphs: r.paragraphs })
          out[out.length - 1] = {
            type: 'artifactVoiceNote',
            position: above!.position,
            data: { hName: 'div', hProperties: { dataArtifactVoicenoteAt: String(found.length - 1) } },
            children: [],
          } as unknown as RootContent
          continue
        }
        if (isParent(n) && n.type !== 'paragraph' && n.type !== 'heading') walk(n)
        out.push(n)
      }
      p.children = out
    }
    walk(tree)
  }
}

/** A word as a transcriber reports it (mlx_whisper / openai-whisper `word_timestamps`). */
export type TimedWord = { word: string; start: number; end: number }

/** The body of a transcript fence for a list of timed words: one word per line, and a blank line
 *  wherever the speaker paused at least `paragraphGap` seconds. Times never run backwards, so the
 *  result always passes the publish check. Correct a word's spelling afterwards; keep its times. */
export function transcriptFenceFromWords(words: TimedWord[], opts: { paragraphGap?: number } = {}): string {
  const gap = opts.paragraphGap ?? 1.5
  const lines: string[] = []
  let prev: { start: number; end: number } | null = null
  for (const w of words) {
    const text = w.word.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const start = Math.max(0, prev ? Math.max(w.start, prev.start) : w.start)
    const end = Math.max(start, w.end)
    if (prev && start - prev.end >= gap) lines.push('')
    lines.push(`${start.toFixed(2)} ${end.toFixed(2)} ${text}`)
    prev = { start, end }
  }
  return lines.length ? lines.join('\n') + '\n' : ''
}

/** The timed words in a whisper JSON result (`segments[].words[]`, written by `mlx_whisper` or
 *  `whisper` with word timestamps on). Anything else in the file is ignored. */
export function wordsFromWhisperJson(json: unknown): TimedWord[] {
  const segments = (json as { segments?: unknown })?.segments
  if (!Array.isArray(segments)) return []
  const out: TimedWord[] = []
  for (const seg of segments) {
    const words = (seg as { words?: unknown })?.words
    if (!Array.isArray(words)) continue
    for (const w of words) {
      const { word, start, end } = (w ?? {}) as Record<string, unknown>
      if (typeof word === 'string' && typeof start === 'number' && typeof end === 'number') out.push({ word, start, end })
    }
  }
  return out
}
