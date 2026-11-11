import { it, expect } from 'vitest'
import { findCommand } from './transcript-fence.js'

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
