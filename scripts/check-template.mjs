// Proves the hub host template builds FROM THE TARBALL, the way an operator gets it
// (supersuit-dev#1630): pack this package, take template/hub out of the tarball into a scratch
// directory outside this repo, install it with the tarball standing in for the registry copy of
// @supersuit/artifacts (the version it pins is the one being released, so it is not on npm yet),
// then `next build` it. Unit tests prove the folder's shape; only this proves it deploys, because
// App Hosting runs exactly this install and build.
//
//   node scripts/check-template.mjs [--keep]    --keep leaves the scratch directory and prints it
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const keep = process.argv.includes('--keep')
const fail = (msg) => { console.error(`check-template: ${msg}`); process.exit(1) }
const scratch = mkdtempSync(join(tmpdir(), 'hub-template-'))
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }

try {
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: root, encoding: 'utf8' })
  const [{ filename, files, version }] = JSON.parse(out.slice(out.indexOf('[')))
  const paths = files.map((f) => f.path)
  for (const need of ['template/hub/package.json', 'template/hub/apphosting.yaml', 'template/hub/app/[id]/page.tsx', 'template/hub/next.config.ts']) {
    if (!paths.includes(need)) fail(`the tarball has no ${need}`)
  }
  for (const bad of paths.filter((p) => /^template\/hub\/(node_modules|\.next)\//.test(p))) fail(`the tarball carries ${bad}`)

  const tgz = join(scratch, filename)
  const unpacked = join(scratch, 'unpacked')
  execFileSync('mkdir', ['-p', unpacked])
  execFileSync('tar', ['-xzf', tgz, '-C', unpacked])
  const host = join(scratch, 'hub')
  cpSync(join(unpacked, 'package/template/hub'), host, { recursive: true })

  const pj = join(host, 'package.json')
  const pkg = JSON.parse(readFileSync(pj, 'utf8'))
  if (pkg.dependencies['@supersuit/artifacts'] !== version) fail(`the template pins @supersuit/artifacts ${pkg.dependencies['@supersuit/artifacts']}, not ${version}`)
  pkg.dependencies['@supersuit/artifacts'] = `file:${tgz}`
  writeFileSync(pj, `${JSON.stringify(pkg, null, 2)}\n`)

  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: host, stdio: 'inherit', env })
  execFileSync('npm', ['run', 'build'], { cwd: host, stdio: 'inherit', env })
  if (!existsSync(join(host, '.next/BUILD_ID'))) fail('next build left no .next/BUILD_ID')
  const nft = join(host, '.next/server/app/[id]/share.png/route.js.nft.json')
  if (!existsSync(nft) || !JSON.parse(readFileSync(nft, 'utf8')).files.some((f) => f.endsWith('Newsreader-600.ttf'))) {
    fail("the share-card route's trace does not carry the package's font")
  }
  console.log(`check-template: template/hub from ${filename} installs and builds${keep ? ` (kept at ${host})` : ''}`)
} finally {
  if (!keep) rmSync(scratch, { recursive: true, force: true })
}
