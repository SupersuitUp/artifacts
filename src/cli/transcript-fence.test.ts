import { it, expect } from 'vitest'
import { findCommand, transcriberArgs, fenceFromWhisper, NO_WORDS_EXIT } from './transcript-fence.js'

it('asks `where` on Windows and `command -v` elsewhere', () => {
  const calls: unknown[] = []
  const run = ((cmd: string, args: string[]) => { calls.push([cmd, args]); return { status: 0 } }) as never
  expect(findCommand('whisper', 'win32', run)).toBe(true)
  expect(findCommand('mlx_whisper', 'darwin', run)).toBe(true)
  expect(calls).toEqual([['where', ['whisper']], ['sh', ['-c', 'command -v mlx_whisper']]])
})

it('a name that is not a plain command word is never handed to a shell', () => {
  const run = (() => { throw new Error('ran') }) as never
  expect(findCommand('x; rm -rf /', 'darwin', run)).toBe(false)
})

// A five-minute recording with long pauses (2026-11-11): with Whisper's defaults, mlx_whisper repeated "Number 1."
// forty times after the fourth spoken line and invented a line in every silent 30 seconds. Not carrying the last
// window's words into the next, and skipping a made-up line inside a long silence, heard all five lines and nothing else.
it('asks either transcriber not to carry words across windows, and to skip a made-up line inside a long silence', () => {
  expect(transcriberArgs('mlx_whisper', 'a.wav', '/o', 'm', undefined)).toEqual(['a.wav', '--word-timestamps', 'True', '-f', 'json', '-o', '/o', '--model', 'm', '--condition-on-previous-text', 'False', '--hallucination-silence-threshold', '2'])
  expect(transcriberArgs('whisper', 'a.wav', '/o', 'turbo', 'en')).toEqual(['a.wav', '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', '/o', '--model', 'turbo', '--condition_on_previous_text', 'False', '--hallucination_silence_threshold', '2', '--language', 'en'])
})

// A take of only noise: every segment is dropped, the tool says so on stderr line by line, and exits 4 (its own code
// for "heard no words", distinct from 1, a transcriber that failed), so a caller never has to match the words.
it('heard no words: exit 4, and each dropped line printed to stderr with its time', () => {
  expect(NO_WORDS_EXIT).toBe(4)
  const squeezed = ['Thank', 'you.'].map((w, i) => ({ word: ' ' + w, start: 8.64 + i * 0.01, end: 8.65 + i * 0.01 }))
  const r = fenceFromWhisper({ segments: [{ start: 8.64, end: 8.8, avg_logprob: -1.77, no_speech_prob: 0, words: squeezed }] }, { gap: 1.5, body: true })
  expect(r.code).toBe(4)
  expect(r.stdout).toBe('')
  expect(r.stderr).toBe('dropped a made-up line at 8.64 s: Thank you.\nthe transcriber heard no words\n')
})

it('words heard: exit 0 with the fence, the body alone with --body', () => {
  const json = { segments: [{ start: 0, end: 1, avg_logprob: -0.2, no_speech_prob: 0, words: [{ word: ' Hi', start: 0, end: 0.4 }] }] }
  expect(fenceFromWhisper(json, { gap: 1.5, body: true })).toEqual({ code: 0, stdout: '0.00 0.40 Hi\n', stderr: '' })
  expect(fenceFromWhisper(json, { gap: 1.5, body: false }).stdout).toBe('```transcript\n0.00 0.40 Hi\n```\n')
})
