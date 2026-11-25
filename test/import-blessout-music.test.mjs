// scripts/import-blessout-music.mjs (0.75.0): copies every catalog track from a source to the host's
// own storage. Fakes only: no audio is fetched or written by these tests.
import { describe, it, expect, vi } from 'vitest'
import { importMusic, parseImportArgs } from '../scripts/import-blessout-music.mjs'
import { MUSIC_TRACKS } from '../src/artifacts/music.ts'

const okFetch = () => vi.fn(async (url) => new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/wav' } }))

describe('importMusic', () => {
  it('copies every catalog track, by its file name, from the source base to the uploader', async () => {
    const fetch = okFetch()
    const upload = vi.fn(async () => {})
    const r = await importMusic({ tracks: MUSIC_TRACKS, source: 'https://old.example.com/bg/', upload, fetch, log: () => {} })
    expect(fetch).toHaveBeenCalledTimes(MUSIC_TRACKS.length)
    expect(fetch).toHaveBeenCalledWith('https://old.example.com/bg/hilltoptrio_silent-night.wav')
    expect(upload).toHaveBeenCalledTimes(MUSIC_TRACKS.length)
    expect(upload).toHaveBeenCalledWith('hilltoptrio_silent-night.wav', expect.any(Uint8Array), 'audio/wav')
    expect(r).toMatchObject({ copied: MUSIC_TRACKS.length, skipped: 0, failed: [] })
  })
  it('skips a track the destination already holds, so a rerun copies only what is missing', async () => {
    const fetch = okFetch()
    const upload = vi.fn(async () => {})
    const r = await importMusic({ tracks: MUSIC_TRACKS.slice(0, 3), source: 'https://old.example.com/bg', upload, exists: async (f) => f === MUSIC_TRACKS[0].file, fetch, log: () => {} })
    expect(r).toMatchObject({ copied: 2, skipped: 1 })
    expect(fetch).not.toHaveBeenCalledWith(`https://old.example.com/bg/${MUSIC_TRACKS[0].file}`)
  })
  it('a source that answers an error, or an empty file, is a named failure and nothing is uploaded for it', async () => {
    const fetch = vi.fn(async (url) => (url.endsWith(MUSIC_TRACKS[0].file) ? new Response('no', { status: 404 }) : new Response(new Uint8Array(0), { status: 200 })))
    const upload = vi.fn(async () => {})
    const r = await importMusic({ tracks: MUSIC_TRACKS.slice(0, 2), source: 'https://old.example.com/bg', upload, fetch, log: () => {} })
    expect(upload).not.toHaveBeenCalled()
    expect(r.failed).toEqual([{ file: MUSIC_TRACKS[0].file, why: 'the source answered 404' }, { file: MUSIC_TRACKS[1].file, why: 'the source sent an empty file' }])
  })
  it('--dry-run lists what it would copy and fetches nothing', async () => {
    const fetch = okFetch()
    const upload = vi.fn(async () => {})
    const lines = []
    const r = await importMusic({ tracks: MUSIC_TRACKS.slice(0, 2), source: 'https://old.example.com/bg', upload, fetch, dryRun: true, log: (l) => lines.push(l) })
    expect(fetch).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(r.copied).toBe(0)
    expect(lines.join('\n')).toContain(MUSIC_TRACKS[1].file)
  })
})

describe('the command line', () => {
  it('needs an https source and exactly one destination', () => {
    expect(parseImportArgs(['--source', 'https://old.example.com/bg', '--to-dir', '/tmp/music'])).toEqual({ ok: true, source: 'https://old.example.com/bg', toDir: '/tmp/music', dryRun: false })
    expect(parseImportArgs(['--source', 'https://old.example.com/bg', '--uploader', './up.mjs', '--dry-run'])).toEqual({ ok: true, source: 'https://old.example.com/bg', uploader: './up.mjs', dryRun: true })
    expect(parseImportArgs(['--to-dir', '/tmp/music']).ok).toBe(false)
    expect(parseImportArgs(['--source', 'http://old.example.com', '--to-dir', '/x']).ok).toBe(false)
    expect(parseImportArgs(['--source', 'https://old.example.com']).ok).toBe(false)
    expect(parseImportArgs(['--source', 'https://old.example.com', '--to-dir', '/x', '--uploader', './u.mjs']).ok).toBe(false)
  })
})
