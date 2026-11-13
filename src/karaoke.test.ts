import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as entry from './karaoke.js'

// Every module the entry loads, followed through relative imports, so a React import anywhere
// under it fails here rather than in a host that imports the rules without React.
function importsUnder(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return []
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1])
  return specs.flatMap((s) => (s.startsWith('.') ? [s, ...importsUnder(join(dirname(file), s.replace(/\.js$/, '.ts')), seen)] : [s]))
}

describe('the ./karaoke entry', () => {
  it('exports the karaoke rules and the word CSS', () => {
    expect(typeof entry.litWordIndex).toBe('function')
    expect(typeof entry.begunCount).toBe('function')
    expect(typeof entry.litDeclarations).toBe('function')
    expect(typeof entry.wordStateCss).toBe('function')
    const words = [{ w: 'a', s: 0, e: 0.4 }, { w: 'b', s: 0.5, e: 0.9 }]
    expect(entry.litWordIndex(words, 0.6, true)).toBe(1)
    expect(entry.begunCount(words, 0.6)).toBe(2)
  })

  it('loads no React and no package at all', () => {
    expect(importsUnder('src/karaoke.ts').filter((s) => !s.startsWith('.'))).toEqual([])
  })

  it('draws the word, the lit word and the words to come under the scope, in the accent', () => {
    expect(entry.wordStateCss('[data-x]', 'red')).toBe(
      '[data-x] .vn-word{border-radius:3px;cursor:pointer;transition:background-color 120ms,opacity 200ms;-webkit-tap-highlight-color:transparent}' +
        '[data-x] .vn-word:hover{background:var(--a-surface-strong,rgba(127,127,127,0.12))}' +
        '[data-x] .vn-word.vn-ahead{opacity:0.5}' +
        `[data-x] .vn-word.vn-word-lit{${entry.litDeclarations('red')}opacity:1}`,
    )
    expect([entry.WORD_CLASS, entry.AHEAD_CLASS, entry.LIT_CLASS]).toEqual(['vn-word', 'vn-ahead', 'vn-word-lit'])
  })

  it('is one copy: the voice note draws its words with wordStateCss', () => {
    const note = readFileSync('src/widgets/voice-note.tsx', 'utf8')
    expect(note).toContain("wordStateCss('[data-artifact-voicenote]', 'var(--a-accent)')")
    expect(note).not.toContain('.vn-word{')
  })

  it('is in the exports map, pointing at the build', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.exports['./karaoke']).toEqual({ types: './lib/karaoke.d.ts', default: './lib/karaoke.js' })
  })
})
