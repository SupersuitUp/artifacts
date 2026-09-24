import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The shell is what every operator's site runs. An import from the instance ('@/...')
// would tie it to one site, which is the one thing the package exists to avoid.
function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

describe('site-shell isolation', () => {
  it('never imports from the instance', () => {
    const offenders = walk(__dirname).filter((p) => /from '@\//.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
})
