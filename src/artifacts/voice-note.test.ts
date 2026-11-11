import { describe, it, expect } from 'vitest'
import { parseTranscriptFence, transcriptFenceFromWords, isAudioSrc, wordsFromWhisperJson } from './voice-note.js'
import { parseArtifactSource } from './front-matter.js'
import { blocksOf } from './widgets.js'
import { remarkVoiceNotes, type VoiceNoteBlock } from './voice-note.js'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root } from 'mdast'

// A voice note is an ordinary audio line followed by a ```transcript fence of timed words. The
// publisher needs no change; the fence is checked here, at publish, with the line the author sees.

const page = (body: string) => `---\ntitle: A letter\nsummary: For the family\n---\n${body}`
const NOTE = [
  '![Robin, to the family](hello.m4a)',
  '',
  '```transcript',
  '0.00 0.62 Hello!',
  '0.80 1.10 I',
  '1.10 1.30 hope',
  '',
  '2.00 2.40 Love,',
  '2.40 2.90 Robin',
  '```',
].join('\n')

describe('parseTranscriptFence', () => {
  it('reads one timed word per line and a blank line as a new paragraph', () => {
    const r = parseTranscriptFence('0.00 0.62 Hello!\n0.80 1.10 I\n\n\n2.00 2.40 Love,\n', 10)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paragraphs).toEqual([
      [{ w: 'Hello!', s: 0, e: 0.62 }, { w: 'I', s: 0.8, e: 1.1 }],
      [{ w: 'Love,', s: 2, e: 2.4 }],
    ])
  })
  it('keeps words in any script, and a phrase timed together', () => {
    const r = parseTranscriptFence('0 0.6 你好!\n1 2 thank you', 1)
    expect(r.ok && r.paragraphs[0].map((w) => w.w)).toEqual(['你好!', 'thank you'])
  })
  it('refuses a malformed line, naming its line in the file', () => {
    const r = parseTranscriptFence('0.00 0.62 Hello\nhope\n', 10)
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^line 12: /) })
  })
  it('refuses an end before its start, and a word that starts before the one above it', () => {
    expect(parseTranscriptFence('1.0 0.5 x', 3)).toEqual({ ok: false, error: expect.stringMatching(/^line 4: .*ends before it starts/) })
    expect(parseTranscriptFence('1.0 1.5 x\n0.5 0.9 y', 3)).toEqual({ ok: false, error: expect.stringMatching(/^line 5: .*before the word above/) })
  })
  it('refuses an empty transcript', () => {
    expect(parseTranscriptFence('\n\n', 3)).toEqual({ ok: false, error: expect.stringMatching(/^line 3: .*no words/) })
  })
})

describe('a voice note at publish', () => {
  it('takes an audio line followed by its transcript', () => {
    expect(parseArtifactSource(page(NOTE)).ok).toBe(true)
  })
  it('refuses a malformed transcript with the line number in the file', () => {
    const r = parseArtifactSource(page(NOTE.replace('1.10 1.30 hope', '1.10 hope')))
    // front matter is 4 lines, the fence opens on body line 3, `hope` is its 3rd row.
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^line 10: /) })
  })
  it('refuses a transcript with no audio line directly above it', () => {
    const r = parseArtifactSource(page('Some words.\n\n```transcript\n0 1 hi\n```'))
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^line 7: .*audio line/) })
    const img = parseArtifactSource(page('![a photo](x.png)\n\n```transcript\n0 1 hi\n```'))
    expect(img.ok).toBe(false)
  })
  it('refuses a second transcript under one voice note, and a transcript fence with a name', () => {
    expect(parseArtifactSource(page(NOTE + '\n```transcript\n0 1 again\n```')).ok).toBe(false)
    expect(parseArtifactSource(page(NOTE.replace('```transcript', '```transcript robin'))).ok).toBe(false)
  })
  it('a transcript is not a comment block: blocksOf gives the voice note its image id and the fence none', () => {
    const ids = [...blocksOf(NOTE).values()]
    expect(ids).toHaveLength(1)
    expect(ids[0]).toMatch(/^b-img-/)
  })
})

describe('isAudioSrc', () => {
  it('is an mp3 or m4a, with or without a query', () => {
    expect(isAudioSrc('a/b.m4a')).toBe(true)
    expect(isAudioSrc('https://cdn.example.com/b.abc12345.mp3?x=1')).toBe(true)
    expect(isAudioSrc('b.mp4')).toBe(false)
  })
})

describe('transcriptFenceFromWords', () => {
  it('writes a fence body that parses back to the same words, with a blank line at a long pause', () => {
    const words = [
      { word: ' Hello', start: 0, end: 0.5 },
      { word: ' there.', start: 0.5, end: 1.0 },
      { word: ' Friend', start: 3.2, end: 3.6 },
    ]
    const body = transcriptFenceFromWords(words, { paragraphGap: 1.5 })
    expect(body).toBe('0.00 0.50 Hello\n0.50 1.00 there.\n\n3.20 3.60 Friend\n')
    const r = parseTranscriptFence(body, 1)
    expect(r.ok && r.paragraphs.map((p) => p.map((w) => w.w))).toEqual([['Hello', 'there.'], ['Friend']])
  })
  it('drops empty words and never writes a start before the previous one', () => {
    const body = transcriptFenceFromWords([{ word: 'a', start: 1, end: 1.2 }, { word: '  ', start: 1.2, end: 1.3 }, { word: 'b', start: 0.9, end: 1.4 }])
    expect(body).toBe('1.00 1.20 a\n1.00 1.40 b\n')
  })
})

describe('wordsFromWhisperJson', () => {
  it('reads segments[].words[] and skips anything malformed', () => {
    const json = { text: 'x', segments: [{ words: [{ word: ' Hello', start: 0, end: 0.3, probability: 0.9 }, { word: 3 }] }, { words: [{ word: ' friend.', start: 0.62, end: 0.88 }] }, {}] }
    expect(wordsFromWhisperJson(json)).toEqual([{ word: ' Hello', start: 0, end: 0.3 }, { word: ' friend.', start: 0.62, end: 0.88 }])
    expect(wordsFromWhisperJson(null)).toEqual([])
  })
  // A real take (2026-11-11): nine seconds of low rumble and clicks, no voice. whisper-large-v3-turbo invented
  // "I'm going to go to the next video." and squeezed all eight words into the last 0.16 s (avg_logprob -1.77).
  // large-v3 heard nothing. A failed decode with words packed faster than anyone speaks is not words.
  it('drops a failed decode whose words are squeezed together (a hallucination)', () => {
    const squeezed = ["I'm", 'going', 'to', 'go', 'to', 'the', 'next', 'video.'].map((w, i) => ({ word: ' ' + w, start: 8.64 + i * 0.02, end: 8.66 + i * 0.02 }))
    const json = { segments: [{ start: 8.64, end: 8.8, avg_logprob: -1.77, no_speech_prob: 1e-10, words: squeezed }] }
    expect(wordsFromWhisperJson(json)).toEqual([])
  })
  it('drops a segment whisper itself calls silence (no_speech_prob over 0.6 and a failed decode)', () => {
    const json = { segments: [{ start: 0, end: 2, avg_logprob: -1.2, no_speech_prob: 0.8, words: [{ word: ' Thank', start: 0.2, end: 0.6 }, { word: ' you.', start: 0.6, end: 1 }] }] }
    expect(wordsFromWhisperJson(json)).toEqual([])
  })
  it('keeps quiet or mumbled real speech: a low score alone, or fast words alone, is not enough', () => {
    const slowLow = { start: 0, end: 2, avg_logprob: -1.3, no_speech_prob: 0.1, words: [{ word: ' um', start: 0, end: 0.5 }, { word: ' yes', start: 1, end: 1.5 }] }
    const fastSure = { start: 3, end: 3.3, avg_logprob: -0.2, no_speech_prob: 0, words: ['a', 'b', 'c', 'd'].map((w, i) => ({ word: ' ' + w, start: 3 + i * 0.05, end: 3.05 + i * 0.05 })) }
    expect(wordsFromWhisperJson({ segments: [slowLow, fastSure] })).toHaveLength(6)
  })
})

describe('a recording: an mp4 line above its words', () => {
  const REC = NOTE.replace('![Robin, to the family](hello.m4a)', '![sound: The bug](take.mp4)')
  it('publishes like a voice note', () => {
    expect(parseArtifactSource(page(REC)).ok).toBe(true)
  })
  // Regression guard (R10): this already passes before the change, so it cannot go red; it pins the refusal wording.
  it('a picture above a transcript is still refused, with the same words an older page saw', () => {
    const r = parseArtifactSource(page('![a photo](x.png)\n\n```transcript\n0 1 hi\n```'))
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/a transcript belongs directly under its voice note.*audio line/) })
  })
  it('the block says it is a video, and its label drops the sound: mark', () => {
    const found: VoiceNoteBlock[] = []
    const tree = unified().use(remarkParse).parse(REC) as Root
    remarkVoiceNotes(found)()(tree)
    expect(found).toEqual([{ src: 'take.mp4', label: 'The bug', kind: 'video', paragraphs: expect.any(Array) }])
  })
  it('an audio note says it is audio', () => {
    const found: VoiceNoteBlock[] = []
    remarkVoiceNotes(found)()(unified().use(remarkParse).parse(NOTE) as Root)
    expect(found[0].kind).toBe('audio')
  })
})
