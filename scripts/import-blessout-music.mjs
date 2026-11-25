// Copy the music library's tracks (src/artifacts/music.ts) from where BlessOut kept them into a
// hub's OWN storage, so `musicLibrary` can point at them. The package ships no audio: the tracks
// are other artists' music, and the package is public MIT. This script moves files a host is
// licensed to hold; it never runs on its own and nothing in the package calls it.
//
//   node scripts/import-blessout-music.mjs --source <https base> --to-dir <dir> [--dry-run]
//   node scripts/import-blessout-music.mjs --source <https base> --uploader <module.mjs> [--dry-run]
//
// --uploader names a module whose default export is `async (file, bytes, contentType) => void`,
// and which may export `exists(file) => Promise<boolean>` so a rerun copies only what is missing.
// Needs the package built (`npm run build`), since it reads the catalog from lib/.
// Exit codes: 0 every track copied or already there; 1 at least one failed; 2 usage.
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'

export const IMPORT_USAGE = 'usage: import-blessout-music --source <https base url> (--to-dir <dir> | --uploader <module.mjs>) [--dry-run]'

/** Copy each track's file from `<source>/<file>` through `upload`. Fails per track, never all at once. */
export async function importMusic({ tracks, source, upload, exists, fetch = globalThis.fetch, dryRun = false, log = console.log }) {
  const base = source.replace(/\/+$/, '')
  const out = { copied: 0, skipped: 0, failed: [] }
  for (const t of tracks) {
    if (exists && (await exists(t.file))) { out.skipped++; log(`already there: ${t.file}`); continue }
    if (dryRun) { log(`would copy: ${base}/${t.file}`); continue }
    const r = await fetch(`${base}/${t.file}`)
    if (!r.ok) { out.failed.push({ file: t.file, why: `the source answered ${r.status}` }); log(`FAILED ${t.file}: ${r.status}`); continue }
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (!bytes.length) { out.failed.push({ file: t.file, why: 'the source sent an empty file' }); log(`FAILED ${t.file}: empty`); continue }
    await upload(t.file, bytes, r.headers.get('content-type') || 'audio/wav')
    out.copied++
    log(`copied: ${t.file} (${bytes.length} bytes)`)
  }
  return out
}

export function parseImportArgs(args) {
  const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1] }
  const source = flag('--source'), toDir = flag('--to-dir'), uploader = flag('--uploader')
  let https = false
  try { https = !!source && new URL(source).protocol === 'https:' } catch { /* not an address */ }
  if (!https || (toDir ? 1 : 0) + (uploader ? 1 : 0) !== 1) return { ok: false, error: IMPORT_USAGE }
  return { ok: true, source, ...(toDir ? { toDir } : { uploader }), dryRun: args.includes('--dry-run') }
}

async function main(argv) {
  const p = parseImportArgs(argv.slice(2))
  if (!p.ok) { process.stderr.write(p.error + '\n'); return 2 }
  const { MUSIC_TRACKS } = await import(/* @vite-ignore */ new URL('../lib/artifacts/music.js', import.meta.url).href)
  let upload, exists
  if (p.toDir) {
    await mkdir(p.toDir, { recursive: true })
    upload = (file, bytes) => writeFile(join(p.toDir, file), bytes)
    exists = (file) => access(join(p.toDir, file)).then(() => true, () => false)
  } else {
    const m = await import(pathToFileURL(resolve(p.uploader)).href)
    upload = m.default
    exists = m.exists
    if (typeof upload !== 'function') { process.stderr.write('--uploader: the module needs a default export (file, bytes, contentType) => Promise\n'); return 2 }
  }
  const r = await importMusic({ tracks: MUSIC_TRACKS, source: p.source, upload, exists, dryRun: p.dryRun })
  console.log(`${r.copied} copied, ${r.skipped} already there, ${r.failed.length} failed`)
  return r.failed.length ? 1 : 0
}

const entry = process.argv[1] ? (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href } catch { return '' } })() : ''
if (entry === import.meta.url) main(process.argv).then((c) => { process.exitCode = c })
