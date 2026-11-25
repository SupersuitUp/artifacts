// The music library (0.75.0): the beds a voice eCard's voice is mixed over. PORTED FROM BlessOut's
// lib/bgAudioOptions.ts, track for track (its 23 options less "none"), as DATA ONLY: the audio files
// are other artists' music, so none ship in this public package. A host keeps them in its own
// storage and says where (the routes config's `musicLibrary`); `scripts/import-blessout-music.mjs`
// copies them there.
//
// `startAt` is BlessOut's `fadeInTime`, renamed for what it is: BlessOut's mixer seeks the track to
// it (`ffmpeg -ss <fadeInSecs>`) and its preview sets `audio.currentTime` to it, so the bed starts
// at the part of the song worth hearing. In the recipe it is the mix's `musicStart`.
import type { VoiceEcardOccasion } from './voice-ecard.js'

/** BlessOut's message types (lib/types.ts MessageTypeEnum), which the catalog is tagged with. */
export const MESSAGE_TYPES = [
  'supportivePrayer', 'supportiveEncouragement', 'thankYouMessage', 'shoutoutMessage', 'birthdayMessage', 'holidayMessage',
  'weddingMessage', 'anniversaryMessage', 'thinkingOfYouMessage', 'congratulationsMessage', 'safeTravelsMessage', 'iLoveYouMessage', 'freeformMessage',
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

export type MusicTrack = {
  id: string
  /** BlessOut's label, emoji and all. */
  name: string
  /** The file's name in the host's library. */
  file: string
  /** Seconds into the file the bed starts at (BlessOut's fadeInTime). */
  startAt: number
  addedDate: string
  idealFor: MessageType[]
  artist?: string
  song?: string
  genres?: string[]
  sourceUrl?: string
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: "reflective-piano", name: "Reflective Piano 🎹", file: "second-light_escalation.wav", startAt: 77, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "hopeful-piano", name: "Hopeful Piano 🌟", file: "ian-post_delicate-frost.wav", startAt: 39, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "uplifting-orchestral", name: "Uplifting Orchestral 🎻", file: "david-morton_transformation.wav", startAt: 26, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "peaceful-orchestral", name: "Peaceful Orchestral 🕊️", file: "roie-shpigler_peace.wav", startAt: 50, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "pensive-orchestral", name: "Pensive Orchestral 🤔", file: "alon-peretz_waves.wav", startAt: 156, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "empowering-electronic", name: "Empowering Electronic ⚡", file: "borden-lulu_hymn.wav", startAt: 53, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "peaceful-hip-hop", name: "Peaceful Hip Hop 🎧", file: "warmkeys_looseleaf.wav", startAt: 85, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "playful-funk", name: "Playful Funk 🕺", file: "aves_smile.wav", startAt: 50, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"] },
  { id: "nature-ocean", name: "Nature (Ocean) 🌊", file: "nature-ocean.wav", startAt: 0, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"], sourceUrl: "https://youtu.be/bCskp5Ge3mk" },
  { id: "nature-forest", name: "Nature (Forest) 🌳", file: "nature-forest.wav", startAt: 0, addedDate: "2024-10-17", idealFor: ["supportivePrayer", "supportiveEncouragement"], sourceUrl: "https://youtu.be/TOHYkccYfUk" },
  { id: "peaceful-electronic", name: "Peaceful Electronic 🌫️", file: "dor-ben-lulu_mist.wav", startAt: 4, addedDate: "2024-11-02", idealFor: ["supportivePrayer", "supportiveEncouragement"], artist: "Dor Ben Lulu", song: "Mist", genres: ["Electronic", "Ambient"] },
  { id: "inspiring-classical", name: "Inspiring Classical 🎻", file: "borrtex_beyond-the-horizon.wav", startAt: 129, addedDate: "2024-11-02", idealFor: ["supportivePrayer", "supportiveEncouragement"], artist: "Borrtex", song: "Beyond the Horizon", genres: ["Classical"] },
  { id: "inspiring-cinematic", name: "Inspiring Cinematic 🎥", file: "amir-marcus_ascension.wav", startAt: 85, addedDate: "2024-11-02", idealFor: ["supportivePrayer", "supportiveEncouragement"], artist: "Amir Marcus", song: "Ascension", genres: ["Cinematic", "Orchestral"] },
  { id: "funky-lofi", name: "Funky LoFi 🎧", file: "aves_sparks.wav", startAt: 20, addedDate: "2024-11-02", idealFor: ["supportivePrayer", "supportiveEncouragement", "shoutoutMessage"], artist: "Aves", song: "Sparks", genres: ["Lo-Fi", "Funk"] },
  { id: "acoustic-folk", name: "Acoustic Folk 🎸", file: "mika-sade_birthday.wav", startAt: 80, addedDate: "2024-11-02", idealFor: ["supportiveEncouragement", "thankYouMessage", "birthdayMessage"], artist: "Mika Sade", song: "Birthday", genres: ["Folk", "Acoustic"] },
  { id: "folksy-birthday-song", name: "Folksy Birthday Song 🎂", file: "ziggy_happy-birthday-around-the-campfire.wav", startAt: 4, addedDate: "2024-11-02", idealFor: ["birthdayMessage"], artist: "Ziggy", song: "Happy Birthday - Around the Campfire", genres: ["Folk", "Acoustic"] },
  { id: "orchestral-birthday-song", name: "Orchestral Birthday Song 🎂", file: "imaginarium_happy-birthday.wav", startAt: 67, addedDate: "2024-11-02", idealFor: ["birthdayMessage"], artist: "Imaginarium", song: "Happy Birthday", genres: ["Orchestral"] },
  { id: "we-wish-you-a-merry-christmas", name: "We Wish You A Merry Christmas 🎄", file: "idokay_we-wish-you-a-merry-christmas.wav", startAt: 8, addedDate: "2024-11-02", idealFor: ["holidayMessage"], artist: "idokay", song: "We Wish You A Merry Christmas", genres: ["Holiday"] },
  { id: "silent-night", name: "Silent Night 🎄", file: "hilltoptrio_silent-night.wav", startAt: 88, addedDate: "2024-11-02", idealFor: ["holidayMessage"], artist: "HillTopTrio", song: "Silent Night", genres: ["Holiday", "Folk"] },
  { id: "jingle-bells", name: "Jingle Bells 🎄", file: "ofer-koren_jingle-bells.wav", startAt: 23, addedDate: "2024-11-02", idealFor: ["holidayMessage"], artist: "Ofer Koren", song: "Jingle Bells", genres: ["Holiday", "Folk"] },
  { id: "chill-folk", name: "Chill Folk 🎸", file: "paper-planes_countdown.wav", startAt: 10, addedDate: "2024-11-02", idealFor: ["supportiveEncouragement", "thinkingOfYouMessage"], artist: "Paper Planes", song: "Countdown", genres: ["Folk", "Acoustic"] },
  { id: "asian-vibe", name: "Asian Vibe 🌏", file: "idokay_issho-together.wav", startAt: 8, addedDate: "2024-11-12", idealFor: ["supportiveEncouragement", "thinkingOfYouMessage"], artist: "idokay", song: "Issho (Together)", genres: ["Asian", "Electronic"] },
]

/** One track by id, or null ("none" and unknown ids). */
export const musicTrack = (id: string): MusicTrack | null => MUSIC_TRACKS.find((t) => t.id === id) ?? null

/** "Music: Mist by Dor Ben Lulu", where the catalog knows the song; null where it does not. */
export const musicCredit = (t: MusicTrack): string | null => (t.song && t.artist ? `Music: ${t.song} by ${t.artist}` : null)

/** What a voice eCard's `music:` names: a track of the catalog, or a file at an https address. */
export type MusicRef = { track: string } | { url: string }

const MUSIC_ERROR = 'music must be a track id from the music library (see MUSIC_TRACKS), an https address of a music file, or none'

/** The `music:` line, checked: `none` is no music (null). */
export function parseMusicRef(v: unknown): { ok: true; music: MusicRef | null } | { ok: false; error: string } {
  if (v === 'none') return { ok: true, music: null }
  if (typeof v !== 'string' || !v) return { ok: false, error: MUSIC_ERROR }
  if (musicTrack(v)) return { ok: true, music: { track: v } }
  try { if (new URL(v).protocol === 'https:') return { ok: true, music: { url: v } } } catch { /* not an address */ }
  return { ok: false, error: `${MUSIC_ERROR}: "${v}" is neither` }
}

/** Where the host keeps the library: a base address the files sit under, or a function that answers
 *  a file's (signed) address, for a private bucket. */
export type MusicLibrary = string | ((file: string) => Promise<string>)

/** Where a bed plays from and where in it to start; null when it cannot play (an unknown track, or a
 *  track on a host with no library). */
export async function resolveMusic(ref: MusicRef, library: MusicLibrary | undefined): Promise<{ url: string; startAt: number; track: MusicTrack | null } | null> {
  if ('url' in ref) return { url: ref.url, startAt: 0, track: null }
  const t = musicTrack(ref.track)
  if (!t || !library) return null
  const url = typeof library === 'string' ? `${library.replace(/\/+$/, '')}/${t.file}` : await library(t.file)
  return { url, startAt: t.startAt, track: t }
}

/** The message type each occasion of a voice eCard reads as. */
export const OCCASION_MESSAGE: Record<VoiceEcardOccasion, MessageType> = {
  thanksgiving: 'thankYouMessage', christmas: 'holidayMessage', newyear: 'holidayMessage', birthday: 'birthdayMessage', other: 'supportiveEncouragement',
}

/** Tracks to offer for a message type or a voice eCard's occasion: the ones the catalog marks as made
 *  for it, in the catalog's order. A type nothing is marked for gets the encouragement tracks, so the
 *  list is never empty. (BlessOut kept these tags on every track but its create flow listed the whole
 *  catalog unranked; this is the first code to read them.) */
export function suggestTracks(o: { messageType?: MessageType; occasion?: VoiceEcardOccasion }, limit?: number): MusicTrack[] {
  const type = o.messageType ?? (o.occasion ? OCCASION_MESSAGE[o.occasion] : 'supportiveEncouragement')
  let out = MUSIC_TRACKS.filter((t) => t.idealFor.includes(type))
  if (!out.length) out = MUSIC_TRACKS.filter((t) => t.idealFor.includes('supportiveEncouragement'))
  return limit ? out.slice(0, limit) : out
}
