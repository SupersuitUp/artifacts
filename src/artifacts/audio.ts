// Voice memos: which recordings a page takes, and what each one is called. Pure, so the reader's
// browser, the routes and the transcribers all agree on one table.
//
// Chrome records `audio/webm` (with a codec suffix), iPhone Safari records `audio/mp4`. Both have
// to survive the whole trip: the recorder's choice, the upload allowlist, the stored extension,
// and the Content-Type the transcription service is told. `.m4a`, never `.mp4`, for mp4 audio:
// the publisher's `.mp4` is a video, and a transcriber that detects by file name needs to know
// this one is audio.

/** Extension -> the type it is stored and transcribed as. */
export const AUDIO_TYPES: Record<string, string> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
}

/** The type without parameters: `audio/webm;codecs=opus` -> `audio/webm`. */
export const baseMime = (mime: string): string => mime.split(';')[0].trim().toLowerCase()

/** The extension a recording of this type is stored under, or null when a page does not take it. */
export function audioExtFor(mime: string): string | null {
  const base = baseMime(mime)
  for (const [ext, type] of Object.entries(AUDIO_TYPES)) if (type === base) return ext
  return null
}

/** The type of a stored recording, from its path's extension; null when it is not one. */
export function audioTypeFor(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return Object.hasOwn(AUDIO_TYPES, ext) ? AUDIO_TYPES[ext] : null
}

/** A memo is capped at 3 minutes in the recorder, a bit under 3 MB at voice bitrate; this is the
 *  ceiling the upload and the transcriber enforce whatever the browser sent. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024
export const MAX_MEMO_MS = 3 * 60 * 1000

/** A memo's file name: a random id the browser draws, and the extension of its type. */
export const MEMO_NAME = /^[A-Za-z0-9_-]{16,64}\.(webm|m4a|mp3|ogg)$/

/** Where a shared comment's recording lives under its page. */
export const commentAudioPath = (name: string) => `comments/${name}`
export const isCommentAudioPath = (p: unknown): p is string =>
  typeof p === 'string' && p.startsWith('comments/') && MEMO_NAME.test(p.slice('comments/'.length))

/** A signed-in reader's personal-note recording, under a directory only their uid derives
 *  (`personalAudioDir` in personal-store.ts). Anything else is not theirs. */
export const personalAudioPath = (dir: string, name: string) => `personal/${dir}/${name}`
export const isPersonalAudioPath = (p: unknown, dir: string): p is string =>
  typeof p === 'string' && p.startsWith(`personal/${dir}/`) && MEMO_NAME.test(p.slice(`personal/${dir}/`.length))
