import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Every text field the reader draws must be at least 16px, or iOS Safari zooms the page when it
// takes focus (seen on an iPhone, 2026-09-28). This reads the source rather than one component, so
// a text field added later without NO_ZOOM_FONT fails here instead of on someone's phone.
const DIRS = ['src/reader', 'src/widgets']
/** Each `<textarea ...>` or `<input ...>` opening tag, read to the `>` that closes it outside any
 *  `{...}` expression, so an arrow function inside a handler does not end the tag early. */
function fields(src: string): { kind: string; tag: string }[] {
  const out: { kind: string; tag: string }[] = []
  for (const m of src.matchAll(/<(textarea|input)\b/g)) {
    let depth = 0
    let i = m.index! + m[0].length
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push({ kind: m[1], tag: src.slice(m.index!, i + 1) })
  }
  return out
}

describe('no text field zooms the page on iPhone', () => {
  const files = DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).map((f) => join(d, f)))
  it('finds the reader\'s text fields at all', () => {
    const count = files.map((f) => fields(readFileSync(f, 'utf8')).filter((x) => x.kind === 'textarea').length).reduce((a, b) => a + b, 0)
    expect(count).toBeGreaterThanOrEqual(3)
  })
  for (const f of files) {
    it(f, () => {
      for (const { kind, tag } of fields(readFileSync(f, 'utf8'))) {
        // Radios, ranges and checkboxes take no typing, so they never zoom.
        if (kind === 'input' && /type=["'](radio|range|checkbox|button|submit|hidden|file)["']/.test(tag)) continue
        expect(tag, `${f}: ${tag.slice(0, 80)}`).toContain('NO_ZOOM_FONT')
      }
    })
  }
})
