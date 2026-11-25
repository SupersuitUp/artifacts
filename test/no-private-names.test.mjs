// This repository is public. No real person's or client's name belongs in its files: a quote is
// attributed to "the operator", and test data uses made-up names (Dana, Sam). The names are held
// here only as truncated SHA-256 hashes, so this test refuses them without publishing them.
// Add a name: `printf '%s' <lowercase name> | shasum -a 256 | cut -c1-16`.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, extname } from 'node:path'

const BLOCKED = new Set([
  '21dfc18dd04cd6a3', 'c9d4581ce914fab4', '976e761dab368049', 'afac327e73694e68', '2a2c676c42a5a64d',
  '7975eba5c586171d', '919e680ee460849a', '4c2c99819a510dbb', 'ef7c6cba58cf8299', '4aaa4f213fdffa6a',
  '40405cea63a5d1da', '62865e1183f651c6', '6ffa280d27a9441e',
])
const TEXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.md', '.json', '.yaml', '.yml', '.css', '.html', '.txt'])
// The voice eCard's papers are base64 image data, not words, and scanning half a megabyte of it
// only slows the test.
const SKIP = (f) => f === 'package-lock.json' || f.startsWith('vendor/') || f.includes('/vendor/') || f === 'src/artifacts/voice-ecard-assets.ts'
const root = resolve(__dirname, '..')
const hash = (w) => createHash('sha256').update(w).digest('hex').slice(0, 16)

describe('the public repository', () => {
  it('names no real person or client in any tracked text file', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
      .filter((f) => f && TEXT.has(extname(f)) && !SKIP(f))
    const hits = []
    for (const f of files) {
      const words = readFileSync(resolve(root, f), 'utf8').toLowerCase().match(/[a-z]+/g) ?? []
      for (const w of new Set(words)) if (BLOCKED.has(hash(w))) hits.push(`${f}: a blocked name (hash ${hash(w)})`)
    }
    expect(hits).toEqual([])
  })
})
