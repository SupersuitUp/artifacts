import { it, expect } from 'vitest'
import { findCommand, transcriberArgs } from './transcript-fence.js'

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
