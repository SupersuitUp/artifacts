// Transcription: the host decides, the browser is the floor.
//
// A host that has a key for a transcription service passes `transcribe` to createArtifactRoutes,
// and the reader's finished voice memo is sent there from the server, so the key never reaches a
// browser. Without it the transcribe route answers 404 and the reader keeps whatever the browser
// transcribed live (or an empty box). The two adapters below are ready to pass as they are.
//
// THE KEY NEVER LEAVES THIS FILE. An adapter answers null on any failure and never throws: a
// thrown error travels into logs and error bodies, and a service that echoes the credential back
// in its own error text (some do) would carry the key with it. Nothing here reads a response body
// on a failure, and nothing here puts the key anywhere but the Authorization header.
import { audioExtFor, baseMime } from './audio.js'

/** A finished recording in, the transcript out; null when the service could not produce one. */
export type Transcriber = (audio: Blob, mime: string) => Promise<{ text: string } | null>

// Under the route's own 30-second budget, so a slow service ends in a clean null, not a timeout.
const TIMEOUT_MS = 25_000

async function post(url: string, init: RequestInit): Promise<unknown> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

const textOf = (t: unknown) => (typeof t === 'string' ? { text: t.trim() } : null)

/** Deepgram Nova-3: the raw recording as the body, its type as Content-Type. */
export function deepgramTranscriber(key: string): Transcriber {
  return async (audio, mime) => {
    if (!key) return null
    const body = await post('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': baseMime(mime) },
      body: audio,
    }) as { results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] } } | null
    return textOf(body?.results?.channels?.[0]?.alternatives?.[0]?.transcript)
  }
}

/** OpenAI's transcription endpoint: a multipart form, the file named so the format is detected. */
export function openaiTranscriber(key: string, model = 'gpt-4o-mini-transcribe'): Transcriber {
  return async (audio, mime) => {
    const ext = audioExtFor(mime)
    if (!key || !ext) return null
    const form = new FormData()
    form.append('file', new File([audio], `memo.${ext}`, { type: baseMime(mime) }))
    form.append('model', model)
    const body = await post('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    }) as { text?: unknown } | null
    return textOf(body?.text)
  }
}
