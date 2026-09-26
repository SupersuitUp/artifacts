// Proves the TARBALL works inside a real Next.js app, not the checkout.
//
// Unit tests prove the source. They never prove that `files` carries the build, that the
// compiled imports resolve the way Next's bundler resolves them, that route handlers can load
// the shell at all, or that the bundled font reaches the deploy. Two of those failed for real
// while this package was being cut (2026-09-24), with every unit test green:
//   - `next/navigation.js` (with the extension) skips Next's per-layer alias, so every route
//     handler died collecting page data on a missing app-router context module.
//   - The share-card font in node_modules is not followed by Next's file tracer, so it only
//     reaches the deploy through a host's `outputFileTracingIncludes`.
//
// So: pack, unpack into test/fixture/node_modules/@supersuit/artifacts (peers resolve from this
// repo's node_modules, as they would from a host's), `next build` the fixture, check the trace
// carries the font, then `next start` it and fetch a page, a share card and a route handler.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const fixture = join(root, 'test/fixture')
const dest = join(fixture, 'node_modules/@supersuit/artifacts')
const fail = (msg) => { console.error(`check-packed: ${msg}`); process.exit(1) }

rmSync(join(fixture, 'node_modules'), { recursive: true, force: true })
rmSync(join(fixture, '.next'), { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

const out = execFileSync('npm', ['pack', '--json', '--pack-destination', fixture], { cwd: root, encoding: 'utf8' })
const [{ filename, files }] = JSON.parse(out.slice(out.indexOf('[')))
const tgz = join(fixture, filename)
execFileSync('tar', ['-xzf', tgz, '-C', dest, '--strip-components=1'])
rmSync(tgz)

const paths = files.map((f) => f.path)
for (const bad of paths.filter((p) => /\.test\.|^src\/|^test\//.test(p))) fail(`tarball carries ${bad}`)
if (!paths.includes('fonts/Newsreader-600.ttf')) fail('tarball has no fonts/Newsreader-600.ttf')
const reader = readFileSync(join(dest, 'lib/reader/artifact-reader.js'), 'utf8')
if (!/^['"]use client['"]/.test(reader)) fail("compiled reader lost its 'use client' directive")
const notesJs = readFileSync(join(dest, 'lib/widgets/notes.js'), 'utf8')
if (!/^['"]use client['"]/.test(notesJs)) fail("compiled notes widget lost its 'use client' directive")
console.log(`check-packed: ${filename}, ${paths.length} files`)

const next = join(root, 'node_modules/next/dist/bin/next')
execFileSync(process.execPath, [next, 'build'], { cwd: fixture, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } })

const nft = join(fixture, '.next/server/app/[id]/share.png/route.js.nft.json')
if (!existsSync(nft)) fail('no trace for the share-card route')
if (!JSON.parse(readFileSync(nft, 'utf8')).files.some((f) => f.endsWith('Newsreader-600.ttf')))
  fail('the share-card route trace does not carry fonts/Newsreader-600.ttf')

const port = 3000 + Math.floor(Math.random() * 2000)
const server = spawn(process.execPath, [next, 'start', '-p', String(port)], { cwd: fixture, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } })
const base = `http://127.0.0.1:${port}`
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`${base}/abc23456`).then(() => true, () => false)
  }
  if (!up) fail('next start never answered')

  const page = await fetch(`${base}/abc23456`)
  const html = await page.text()
  if (page.status !== 200 || !html.includes('Fixture')) fail(`page answered ${page.status}`)

  const png = await fetch(`${base}/abc23456/share.png?v=1`)
  const bytes = Buffer.from(await png.arrayBuffer())
  if (png.status !== 200 || bytes.subarray(1, 4).toString() !== 'PNG' || bytes.readUInt32BE(16) !== 1200)
    fail(`share card answered ${png.status} ${png.headers.get('content-type')}`)

  const publish = await fetch(`${base}/api/artifacts`, { method: 'POST', body: '---\ntitle: T\nsummary: S\n---\nhi' })
  if (publish.status !== 401) fail(`an unauthenticated publish answered ${publish.status}, not 401`)

  const w = await fetch(`${base}/api/artifacts/abc23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ slot: 'vote', op: 'set', value: 'yes' }) })
  const cookie = (w.headers.get('set-cookie') ?? '').split(';')[0]
  if (w.status !== 200 || !cookie.startsWith('artifact_anon=')) fail(`an anonymous answer answered ${w.status}`)
  const r = await (await fetch(`${base}/api/artifacts/abc23456/state`, { headers: { cookie } })).json()
  if (r.slots?.vote?.mine !== 'yes' || r.slots.vote.tally?.anonymous?.yes !== 1) fail(`state read back ${JSON.stringify(r)}`)

  // The notes widget: the page draws a control beside each heading, and a note posts and reads
  // back through the state API as { slug, heading, note }.
  const notesHtml = await (await fetch(`${base}/nts23456`)).text()
  if (!notesHtml.includes('data-note-toggle="sales"') || !notesHtml.includes('data-artifact-notes')) fail('the notes page drew no note controls')
  if (notesHtml.includes('language-notes')) fail('the notes fence rendered as code')
  const nw = await fetch(`${base}/api/artifacts/nts23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' }, body: JSON.stringify({ slot: 'notes', op: 'append', value: { slug: 'sales', heading: 'Sales', note: 'packed' } }) })
  const ncookie = (nw.headers.get('set-cookie') ?? '').split(';')[0]
  if (nw.status !== 200) fail(`a note answered ${nw.status}`)
  const bad = await fetch(`${base}/api/artifacts/nts23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10', cookie: ncookie }, body: JSON.stringify({ slot: 'notes', op: 'append', value: 'loose' }) })
  if (bad.status !== 400) fail(`a malformed note answered ${bad.status}, not 400`)
  const nr = await (await fetch(`${base}/api/artifacts/nts23456/state`, { headers: { cookie: ncookie } })).json()
  if (nr.slots?.notes?.shared?.[0]?.value?.note !== 'packed') fail(`notes read back ${JSON.stringify(nr)}`)

  console.log('check-packed: fixture builds; page, share card, publish, state routes and the notes widget answer correctly')
} finally {
  server.kill()
}
rmSync(join(fixture, 'node_modules'), { recursive: true, force: true })
rmSync(join(fixture, '.next'), { recursive: true, force: true })
