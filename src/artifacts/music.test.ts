// The music library (0.75.0): BlessOut's background-music catalog, ported as data with no audio in
// the package; a voice eCard's `music:` names a track or an https file, and the host says where the
// track files live.
import { describe, it, expect } from 'vitest'
import { MUSIC_TRACKS, MESSAGE_TYPES, musicTrack, parseMusicRef, resolveMusic, suggestTracks, musicCredit } from './music.js'

describe('the catalog', () => {
  it('holds BlessOut\'s 22 tracks (its 23 options less "none"), each fully described', () => {
    expect(MUSIC_TRACKS).toHaveLength(22)
    const ids = new Set<string>()
    for (const t of MUSIC_TRACKS) {
      expect(t.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(ids.has(t.id)).toBe(false)
      ids.add(t.id)
      expect(t.name.trim()).toBe(t.name)
      expect(t.file).toMatch(/^[a-z0-9][a-z0-9._-]*\.wav$/)
      expect(t.startAt).toBeGreaterThanOrEqual(0)
      expect(t.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(t.idealFor.length).toBeGreaterThan(0)
      for (const m of t.idealFor) expect(MESSAGE_TYPES).toContain(m)
    }
  })
  it('keeps BlessOut\'s numbers: where each track starts (its fadeInTime), the file, the credits', () => {
    expect(musicTrack('reflective-piano')).toMatchObject({ file: 'second-light_escalation.wav', startAt: 77, addedDate: '2024-10-17' })
    expect(musicTrack('pensive-orchestral')!.startAt).toBe(156)
    expect(musicTrack('nature-ocean')).toMatchObject({ startAt: 0, sourceUrl: 'https://youtu.be/bCskp5Ge3mk' })
    expect(musicTrack('peaceful-electronic')).toMatchObject({ artist: 'Dor Ben Lulu', song: 'Mist', genres: ['Electronic', 'Ambient'], startAt: 4 })
    expect(musicTrack('asian-vibe')).toMatchObject({ artist: 'idokay', song: 'Issho (Together)', addedDate: '2024-11-12' })
    expect(musicTrack('none')).toBeNull()
  })
  it('credits a track when it knows the song', () => {
    expect(musicCredit(musicTrack('peaceful-electronic')!)).toBe('Music: Mist by Dor Ben Lulu')
    expect(musicCredit(musicTrack('reflective-piano')!)).toBeNull()
  })
})

describe('music: on a voice eCard', () => {
  it('takes a track id, an https file, or none', () => {
    expect(parseMusicRef('silent-night')).toEqual({ ok: true, music: { track: 'silent-night' } })
    expect(parseMusicRef('https://cdn.example.com/bed.mp3')).toEqual({ ok: true, music: { url: 'https://cdn.example.com/bed.mp3' } })
    expect(parseMusicRef('none')).toEqual({ ok: true, music: null })
  })
  it('refuses an unknown track and anything that is not https, in words', () => {
    for (const v of ['silent-nite', 'http://cdn.example.com/a.mp3', 'bed.mp3', 7, '']) {
      const r = parseMusicRef(v)
      expect(r.ok, String(v)).toBe(false)
      if (!r.ok) expect(r.error).toContain('music must be')
    }
  })
})

describe('where a track plays from', () => {
  it('a track resolves through the host\'s library: a base address, or a function the host signs with', async () => {
    expect(await resolveMusic({ track: 'silent-night' }, 'https://media.example.com/music/')).toEqual({ url: 'https://media.example.com/music/hilltoptrio_silent-night.wav', startAt: 88, track: musicTrack('silent-night') })
    expect(await resolveMusic({ track: 'silent-night' }, 'https://media.example.com/music')).toMatchObject({ url: 'https://media.example.com/music/hilltoptrio_silent-night.wav' })
    expect(await resolveMusic({ track: 'aves-sparks' as never }, 'https://media.example.com/m')).toBeNull()
    const signed = await resolveMusic({ track: 'funky-lofi' }, async (file) => `https://storage.example.com/${file}?sig=1`)
    expect(signed).toMatchObject({ url: 'https://storage.example.com/aves_sparks.wav?sig=1', startAt: 20 })
  })
  it('a custom https file plays from its start; a track with no library is unplayable, said as null', async () => {
    expect(await resolveMusic({ url: 'https://cdn.example.com/bed.mp3' }, undefined)).toEqual({ url: 'https://cdn.example.com/bed.mp3', startAt: 0, track: null })
    expect(await resolveMusic({ track: 'silent-night' }, undefined)).toBeNull()
  })
})

describe('suggested tracks', () => {
  it('by message type: the tracks made for it, in the catalog\'s order', () => {
    expect(suggestTracks({ messageType: 'birthdayMessage' }).map((t) => t.id)).toEqual(['acoustic-folk', 'folksy-birthday-song', 'orchestral-birthday-song'])
    expect(suggestTracks({ messageType: 'holidayMessage' }).map((t) => t.id)).toEqual(['we-wish-you-a-merry-christmas', 'silent-night', 'jingle-bells'])
  })
  it('by a voice eCard\'s occasion, and never empty', () => {
    expect(suggestTracks({ occasion: 'christmas' }).map((t) => t.id)).toEqual(['we-wish-you-a-merry-christmas', 'silent-night', 'jingle-bells'])
    expect(suggestTracks({ occasion: 'birthday' })[0].id).toBe('acoustic-folk')
    expect(suggestTracks({ occasion: 'thanksgiving' }).map((t) => t.id)).toEqual(['acoustic-folk'])
    expect(suggestTracks({ occasion: 'other' }).length).toBeGreaterThan(5)
    expect(suggestTracks({ messageType: 'weddingMessage' }).length).toBeGreaterThan(0)
    expect(suggestTracks({ occasion: 'other' }, 3)).toHaveLength(3)
  })
})
