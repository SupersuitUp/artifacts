// Proves the TARBALL works, not the checkout. Passing unit tests prove the source; they never
// prove that `files` carries the build, that every `exports` entry resolves under plain Node
// ESM (where a missing `.js` extension is a crash, not a warning), or that the bundled font is
// where the share card looks for it once the package sits in someone's node_modules.
//
// It packs, unpacks into .packed/node_modules/@supersuit/artifacts (inside this repo, so the
// peers resolve from this repo's node_modules exactly as they would from a host's), then imports
// every entry and renders the default font from a host-shaped working directory.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stage = join(root, '.packed')
rmSync(stage, { recursive: true, force: true })
const dest = join(stage, 'node_modules/@supersuit/artifacts')
mkdirSync(dest, { recursive: true })

const out = execFileSync('npm', ['pack', '--json', '--pack-destination', stage], { cwd: root, encoding: 'utf8' })
const [{ filename, files }] = JSON.parse(out.slice(out.indexOf('[')))
execFileSync('tar', ['-xzf', join(stage, filename), '-C', dest, '--strip-components=1'])

const fail = (msg) => { console.error(`check-packed: ${msg}`); process.exit(1) }
const paths = files.map((f) => f.path)
for (const bad of paths.filter((p) => /\.test\.|^src\//.test(p))) fail(`tarball carries ${bad}`)
if (!paths.includes('fonts/Newsreader-600.ttf')) fail('tarball has no fonts/Newsreader-600.ttf')

const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
const entries = Object.keys(pkg.exports).filter((k) => !k.includes('*') && k !== './package.json')
const script = `
  const entries = ${JSON.stringify(entries)};
  for (const e of entries) {
    const spec = e === '.' ? '@supersuit/artifacts' : '@supersuit/artifacts' + e.slice(1);
    const m = await import(spec);
    if (!Object.keys(m).length) throw new Error(spec + ' exports nothing');
    console.log('ok', spec, Object.keys(m).length, 'exports');
  }
  const { freedomDefault } = await import('@supersuit/artifacts/brand');
  const font = await freedomDefault.share.font();
  if (font.data.byteLength < 10000) throw new Error('font is empty');
  console.log('ok default share font from node_modules,', font.data.byteLength, 'bytes');
`
// cwd is the stage, which is shaped like a host root: node_modules/@supersuit/artifacts/...
// and NOT this repo's root, so the font can only be found the way a host finds it.
execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: stage, stdio: 'inherit' })
if (!existsSync(join(dest, 'lib/reader/artifact-reader.js'))) fail('no compiled reader')
const reader = readFileSync(join(dest, 'lib/reader/artifact-reader.js'), 'utf8')
if (!reader.startsWith("'use client'") && !reader.startsWith('"use client"')) fail("compiled reader lost its 'use client' directive")
rmSync(stage, { recursive: true, force: true })
console.log(`check-packed: ${filename} ok (${paths.length} files)`)
