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
