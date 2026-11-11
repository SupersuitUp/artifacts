#!/usr/bin/env node
// Turns a recording into the ```transcript fence a voice note needs, so nobody times words by
// hand. The package carries no transcriber: this runs one already on the machine, locally,
// `mlx_whisper` (Apple Silicon: `pip install mlx-whisper`) or else openai-whisper's `whisper`,
// with word timestamps on, and prints the fence to paste under the audio line.
//
//   npx -p @supersuit/artifacts supersuit-transcript-fence note.m4a [--language en] [--model M] [--gap 1.5] [--body]
//
// Correct any word afterwards (a name, a phrase in another language); keep its two times.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transcriptFenceFromWords, wordsFromWhisperJson } from '../artifacts/voice-note.js'

const USAGE = 'usage: supersuit-transcript-fence <audio file> [--language en] [--model <whisper model>] [--gap <seconds>] [--body]'

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

/** Whether `cmd` is on PATH: `where` on Windows (which has no sh), `command -v` elsewhere. */
export function findCommand(cmd: string, platform: NodeJS.Platform = process.platform, run: typeof spawnSync = spawnSync): boolean {
  if (!/^[A-Za-z0-9_.-]+$/.test(cmd)) return false
  const r = platform === 'win32' ? run('where', [cmd], { stdio: 'ignore' }) : run('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
  return r.status === 0
}

function main(argv: string[]): number {
  const args = argv.slice(2)
  const file = args.find((a, i) => !a.startsWith('--') && !['--language', '--model', '--gap'].includes(args[i - 1]))
  if (!file || args.includes('--help')) {
    process.stderr.write(USAGE + '\n')
    return file ? 0 : 2
  }
  const path = resolve(file)
  if (!existsSync(path)) {
    process.stderr.write(`no such file: ${path}\n`)
    return 2
  }
  const language = arg(args, '--language')
  const gap = Number(arg(args, '--gap') ?? 1.5)
  const out = mkdtempSync(join(tmpdir(), 'transcript-fence-'))
  try {
    let r
    if (findCommand('mlx_whisper')) {
      const model = arg(args, '--model') ?? 'mlx-community/whisper-large-v3-turbo'
      r = spawnSync('mlx_whisper', [path, '--word-timestamps', 'True', '-f', 'json', '-o', out, '--model', model, ...(language ? ['--language', language] : [])], { stdio: ['ignore', 'ignore', 'inherit'] })
    } else if (findCommand('whisper')) {
      const model = arg(args, '--model') ?? 'turbo'
      r = spawnSync('whisper', [path, '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', out, '--model', model, ...(language ? ['--language', language] : [])], { stdio: ['ignore', 'ignore', 'inherit'] })
    } else {
      process.stderr.write('no local transcriber found: install mlx-whisper (pip install mlx-whisper, Apple Silicon) or openai-whisper (pip install openai-whisper)\n')
      return 3
    }
    if (r.status !== 0) {
      process.stderr.write(`the transcriber exited ${r.status}\n`)
      return 1
    }
    const json = readdirSync(out).find((f) => f.endsWith('.json'))
    if (!json) {
      process.stderr.write('the transcriber wrote no JSON\n')
      return 1
    }
    const body = transcriptFenceFromWords(wordsFromWhisperJson(JSON.parse(readFileSync(join(out, json), 'utf8'))), { paragraphGap: gap })
    if (!body) {
      process.stderr.write('the transcriber heard no words\n')
      return 1
    }
    process.stdout.write(args.includes('--body') ? body : '```transcript\n' + body + '```\n')
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

// Run only when started as a program (the package's bin, or a vendored copy run with node), never on import.
const entry = process.argv[1] ? (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href } catch { return '' } })() : ''
if (entry === import.meta.url) process.exitCode = main(process.argv)
