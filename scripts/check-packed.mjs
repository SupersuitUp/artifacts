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
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
for (const f of ['player-bar.js', 'comment-layer.js', 'comment-card.js', 'page-menu.js', 'version-history.js', 'settings-sheet.js']) {
  if (!/^['"]use client['"]/.test(readFileSync(join(dest, 'lib/reader', f), 'utf8'))) fail(`compiled ${f} lost its 'use client' directive`)
}
// GUARD: nothing the package ships may speak with the browser's own voice.
const scan = spawnSync('grep', ['-rl', 'speechSynthesis', join(dest, 'lib')], { encoding: 'utf8' })
if (scan.status === 2) fail(`could not scan the package: ${scan.stderr}`)
const speakers = scan.stdout.trim()
if (speakers) fail(`the package speaks with the browser voice: ${speakers}`)
const notesJs = readFileSync(join(dest, 'lib/widgets/notes.js'), 'utf8')
if (!/^['"]use client['"]/.test(notesJs)) fail("compiled notes widget lost its 'use client' directive")
if (!/^['"]use client['"]/.test(readFileSync(join(dest, 'lib/widgets/checklist.js'), 'utf8'))) fail("compiled checklist widget lost its 'use client' directive")
if (!/^['"]use client['"]/.test(readFileSync(join(dest, 'lib/widgets/voice-note.js'), 'utf8'))) fail("compiled voice-note widget lost its 'use client' directive")
// The transcript-fence bin is a file an author runs with npx: it must ship, as a node script.
if (!readFileSync(join(dest, 'lib/cli/transcript-fence.js'), 'utf8').startsWith('#!/usr/bin/env node')) fail('the supersuit-transcript-fence bin lost its shebang')
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
  if ((html.match(/data-defined-term="harness"/g) ?? []).length !== 1) fail('the defined term is not underlined exactly once')
  // GUARD: the fixture page has no narration, so it has NO player at all. A page is read by the
  // audio recorded at publish (Kokoro, or ElevenLabs on request) or not read; never by the
  // browser's own voice (the operator, 2026-09-29: "NEVER PUT DEFAULT SAFARI VOICE DICTATION").
  if (html.includes('data-artifact-reader') || html.includes('<audio')) fail('the un-narrated page mounts a player')

  // Version history: the page names its version and carries the History control; a past version
  // renders under its banner at its own URL; a version that does not exist is a 404.
  if (!html.includes('Version 2') || !html.includes('data-version-history') || !html.includes('First draft')) fail('the page has no version line or history')
  // The page menu (0.30.0): its server marker names the role and the items, and carries the
  // version list for readers with scripts off.
  if (!html.includes('data-page-menu-for="visitor"') || !html.includes('data-page-menu-items="share history"')) fail('the page has no page menu')
  const v1 = await fetch(`${base}/abc23456/v/1`)
  const v1html = await v1.text()
  if (v1.status !== 200 || !v1html.includes('the first body') || !v1html.includes('You are reading version 1 of 2')) fail(`version 1 answered ${v1.status}`)
  const v9 = await fetch(`${base}/abc23456/v/9`)
  if (v9.status !== 404) fail(`a missing version answered ${v9.status}, not 404`)

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

  // The checklist widget: the fence draws the known component with its ids and count, raw HTML
  // in it stays text, and a Send posts the ticked ids through the state API and reads back.
  const kHtml = await (await fetch(`${base}/chk23456`)).text()
  const kIds = [...kHtml.matchAll(/data-checklist-item="([^"]+)"/g)].map((m) => m[1]).join(',')
  if (kIds !== 'update,sign-in-with-your-personal-apple-account,install-chrome-and-sign-in,gh-send') fail(`the checklist drew items ${kIds}`)
  if (!kHtml.includes('0 of 4 done') || !kHtml.includes('data-checklist-send')) fail('the checklist drew no count or no Send')
  if (kHtml.includes('<b>raw') || kHtml.includes('language-checklist')) fail('the checklist rendered raw HTML or its fence as code')
  const kw = await fetch(`${base}/api/artifacts/chk23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' }, body: JSON.stringify({ slot: 'checklist', op: 'set', value: { done: ['update'] } }) })
  if (kw.status !== 200) fail(`a checklist send answered ${kw.status}`)
  const kbad = await fetch(`${base}/api/artifacts/chk23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' }, body: JSON.stringify({ slot: 'checklist', op: 'set', value: { done: ['nope'] } }) })
  if (kbad.status !== 400) fail(`a send naming an unknown item answered ${kbad.status}, not 400`)

  // Comments: the page draws the layer with what this reader may do, every block carries its id,
  // a shared comment posts through the state API and reads back through /responses, and a reader
  // who is not signed in is told to keep personal notes on the device.
  const cHtml = await (await fetch(`${base}/cmt23456`)).text()
  if (!cHtml.includes('data-comment-layer="anyone"') || !cHtml.includes('data-comment-can-share="yes"')) fail('the comments page drew no comment layer')
  if (!/data-block="b-p-[0-9a-f]{8}"/.test(cHtml)) fail('the page carries no block ids')
  const comment = { anchor: { kind: 'text', quote: 'river', prefix: 'The ', suffix: ' runs north.' }, body: 'packed comment', version: 1 }
  const cw = await fetch(`${base}/api/artifacts/cmt23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' }, body: JSON.stringify({ slot: 'comments', op: 'append', value: comment }) })
  if (cw.status !== 200) fail(`a comment answered ${cw.status}`)
  const cbad = await fetch(`${base}/api/artifacts/cmt23456/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' }, body: JSON.stringify({ slot: 'comments', op: 'append', value: { body: 'no anchor', version: 1 } }) })
  if (cbad.status !== 400) fail(`a malformed comment answered ${cbad.status}, not 400`)
  const cr = await (await fetch(`${base}/api/artifacts/cmt23456/responses`, { headers: { authorization: 'Bearer k' } })).json()
  if (cr.responses?.[0]?.slot !== 'comments' || cr.responses[0].value?.body !== 'packed comment') fail(`responses read back ${JSON.stringify(cr)}`)
  // The comments feed: the same comment, with a link that lands on it; refused without the key.
  const fd = await (await fetch(`${base}/api/comments?since=2000-01-01T00:00:00Z`, { headers: { authorization: 'Bearer k' } })).json()
  const fc = fd.comments?.find((c) => c.body === 'packed comment')
  if (!fc || fc.artifactId !== 'cmt23456' || fc.link !== `http://localhost/cmt23456#comment-${fc.entryId}` || typeof fd.now !== 'string') fail(`the comments feed read back ${JSON.stringify(fd)}`)
  const fno = await fetch(`${base}/api/comments?since=2000-01-01T00:00:00Z`)
  if (fno.status !== 401) fail(`the comments feed without the key answered ${fno.status}, not 401`)
  // Resolving (0.33.0): refused without the key; with it the thread is resolved, the feed says so,
  // and `open=1` leaves it out.
  const rno = await fetch(`${base}/api/artifacts/cmt23456/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry: fc.entryId }) })
  if (rno.status !== 401) fail(`resolve without the key answered ${rno.status}, not 401`)
  const rok = await fetch(`${base}/api/artifacts/cmt23456/resolve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ entry: fc.entryId, note: 'packed fix' }) })
  const rb = await rok.json()
  if (rok.status !== 200 || rb.resolved?.note !== 'packed fix') fail(`resolve answered ${rok.status} ${JSON.stringify(rb)}`)
  const fr = await (await fetch(`${base}/api/comments?since=2000-01-01T00:00:00Z`, { headers: { authorization: 'Bearer k' } })).json()
  if (fr.comments?.find((c) => c.entryId === fc.entryId)?.resolved?.note !== 'packed fix') fail(`the feed did not carry the resolution: ${JSON.stringify(fr)}`)
  const fo = await (await fetch(`${base}/api/comments?since=2000-01-01T00:00:00Z&open=1`, { headers: { authorization: 'Bearer k' } })).json()
  if (fo.comments?.some((c) => c.entryId === fc.entryId)) fail('open=1 still listed a resolved thread')
  const pr = await fetch(`${base}/api/artifacts/cmt23456/personal`)
  if (pr.status !== 401 || (await pr.json()).device !== true) fail(`personal notes for a signed-out reader answered ${pr.status}, not 401 device`)

  // Share and comment settings (0.31.0): refused signed out and to a reader; for the fixture's
  // owner, the menu offers both sheets, the endpoint reads and changes a setting, and the page
  // reflects it at once with no republish.
  const { mintGrant, GRANT_COOKIE } = await import(pathToFileURL(join(dest, 'lib/artifacts/reader.js')).href)
  const grant = (email) => `${GRANT_COOKIE}=${mintGrant('fixture-reader-secret', { uid: email, email, name: 'Fixture', member: true })}`
  const ownerCookie = grant('owner@example.com')
  const sNo = await fetch(`${base}/api/artifacts/abc23456/settings`)
  if (sNo.status !== 401) fail(`settings signed out answered ${sNo.status}, not 401`)
  const sReader = await fetch(`${base}/api/artifacts/abc23456/settings`, { headers: { cookie: grant('dana@example.com') } })
  if (sReader.status !== 403) fail(`settings for a reader answered ${sReader.status}, not 403`)
  const ownerHtml = await (await fetch(`${base}/abc23456`, { headers: { cookie: ownerCookie } })).text()
  if (!ownerHtml.includes('data-page-menu-for="owner"') || !ownerHtml.includes('share-settings comment-settings')) fail('the owner\'s page menu has no settings items')
  const readerHtml = await (await fetch(`${base}/abc23456`, { headers: { cookie: grant('dana@example.com') } })).text()
  if (readerHtml.includes('share-settings') || readerHtml.includes('dana@example.com</')) fail('a reader\'s page carries the settings')
  const sw = await fetch(`${base}/api/artifacts/abc23456/settings`, { method: 'POST', headers: { cookie: ownerCookie, origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'on' }) })
  const sb = await sw.json()
  if (sw.status !== 200 || sb.password !== true || !/\?key=[a-z2-9]{12}$/.test(sb.link)) fail(`a settings change answered ${sw.status} ${JSON.stringify(sb)}`)
  const locked = await (await fetch(`${base}/abc23456`)).text()
  if (!/<form[^>]*method="get"/.test(locked) || locked.includes('data-defined-term')) fail('the password set from the menu did not shut the page')
  const foreign = await fetch(`${base}/api/artifacts/abc23456/settings`, { method: 'POST', headers: { cookie: ownerCookie, origin: 'https://evil.example.net', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'off' }) })
  if (foreign.status !== 403) fail(`a cross-origin settings change answered ${foreign.status}, not 403`)
  const off = await fetch(`${base}/api/artifacts/abc23456/settings`, { method: 'POST', headers: { cookie: ownerCookie, origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'off' }) })
  if (off.status !== 200 || (await off.json()).password !== false) fail('the password could not be taken off again')
  if (!(await (await fetch(`${base}/abc23456`)).text()).includes('data-defined-term')) fail('the page did not open again when the password came off')

  // Resolution digests (0.34.0): a signed-in reader's comment, resolved with the key, queues one
  // digest; a dry run reports it and sends nothing; the real flush sends it once; its stop link works.
  const danaCookie = grant('dana@example.com')
  const dc = await fetch(`${base}/api/artifacts/cmt23456/state`, { method: 'POST', headers: { cookie: danaCookie, origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'comments', op: 'append', value: { ...comment, body: 'signed-in comment' } }) })
  const dce = await dc.json()
  if (dc.status !== 200) fail(`a signed-in comment answered ${dc.status} ${JSON.stringify(dce)}`)
  const dfd = await (await fetch(`${base}/api/comments?since=2000-01-01T00:00:00Z`, { headers: { authorization: 'Bearer k' } })).json()
  const dEntry = dfd.comments?.find((c) => c.body === 'signed-in comment')
  if (!dEntry) fail('the signed-in comment is not in the feed')
  const dr = await fetch(`${base}/api/artifacts/cmt23456/resolve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ entry: dEntry.entryId, note: 'fixed in packed' }) })
  if (dr.status !== 200) fail(`resolving the signed-in comment answered ${dr.status}`)
  const early = await (await fetch(`${base}/api/digest-flush?ahead=5`)).json()
  if (early.report.due !== 0 || early.sent.length) fail(`a digest was due inside the quiet window: ${JSON.stringify(early.report)}`)
  const dry = await (await fetch(`${base}/api/digest-flush?ahead=11&dry=1`)).json()
  if (dry.report.wouldSend?.length !== 1 || dry.report.wouldSend[0].to !== 'd***@example.com' || dry.sent.length) fail(`the dry run read back ${JSON.stringify(dry)}`)
  const real = await (await fetch(`${base}/api/digest-flush?ahead=11`)).json()
  const mail = real.sent[0]
  if (real.sent.length !== 1 || mail.to !== 'dana@example.com' || mail.subject !== 'Fixture Co resolved your comment on Comments' || !mail.text.includes('fixed in packed') || !mail.text.includes(`#comment-${dEntry.entryId}`)) fail(`the digest read back ${JSON.stringify(real)}`)
  const again = await (await fetch(`${base}/api/digest-flush?ahead=60`)).json()
  if (again.sent.length !== 1) fail('a second flush sent the digest again')
  const stopLink = /Stop these emails for this page: (\S+)/.exec(mail.text)?.[1]
  const stopRes = stopLink ? await fetch(stopLink.replace('http://localhost', base)) : null
  if (stopRes?.status !== 200 || !(await stopRes.text()).includes('no more emails about resolved comments on &ldquo;Comments&rdquo;')) fail(`the stop link answered ${stopRes?.status}`)

  console.log('check-packed: fixture builds; page, page menu, version history, share card, publish, state routes, the notes and checklist widgets, comments, the comments feed, resolving, resolution digests and the settings sheets answer correctly')
} finally {
  server.kill()
}
rmSync(join(fixture, 'node_modules'), { recursive: true, force: true })
rmSync(join(fixture, '.next'), { recursive: true, force: true })
