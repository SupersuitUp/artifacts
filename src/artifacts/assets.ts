// Where an artifact's files live (cover, images, narration audio and timings). The shell
// only knows the interface; the instance hands in a bucket. Before this existed the
// publisher shelled out to gsutil against the maintainer's bucket, which no other operator
// could do, so every operator gets the same door: PUT bytes with their key, get a URL back.
import { createHash } from 'node:crypto'
import type { Bucket } from '@google-cloud/storage'
import { MAX_AUDIO_BYTES } from './audio.js'

export interface ArtifactAssets {
  /** Store `bytes` for artifact `id` under `name`; return the public URL. */
  put(id: string, name: string, bytes: Buffer, contentType: string): Promise<string>
  /**
   * A signed URL the publisher PUTs a big file to directly, skipping the route handler.
   * `digest` is the first 8 hex of the bytes' sha256, so the key is the one put() would use.
   * Optional: a host without it answers 501 and the publisher falls back to put().
   */
  signUpload?(id: string, name: string, digest: string, contentType: string): Promise<{ uploadUrl: string; headers: Record<string, string>; url: string }>
  /** After a signed upload: make it readable and return its URL, or null if nothing arrived. */
  finishUpload?(id: string, name: string, digest: string): Promise<string | null>

  // READERS' VOICE MEMOS. Never made public: every read is a short-lived signed URL, issued only
  // where the route already shows the comment or note the recording belongs to. `path` is under
  // the page (`comments/<memo>.webm`, `personal/<dir>/<memo>.m4a`), checked by the route first.
  // All four are optional; a host without them keeps memos on the reader's device.
  /** A signed URL a reader PUTs one recording to, at most MAX_AUDIO_BYTES. */
  signAudioUpload?(id: string, path: string, contentType: string): Promise<{ uploadUrl: string; headers: Record<string, string> }>
  /** After the PUT: the stored size, or null if nothing arrived. */
  audioSize?(id: string, path: string): Promise<number | null>
  /** The recording's bytes, for the transcriber; null when there is none. */
  readAudio?(id: string, path: string): Promise<Buffer | null>
  /** A signed URL to play the recording, valid for about an hour. */
  audioUrl?(id: string, path: string): Promise<string>
}

/** The digest half of a stored name: the first 8 hex of the bytes' sha256. */
export const ASSET_DIGEST = /^[0-9a-f]{8}$/

const CACHE_CONTROL = 'public, max-age=31536000, immutable'


/** Names are one path segment: letters, digits, dot, dash, underscore. */
export const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

export const ASSET_TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  json: 'application/json',
}

export function contentTypeFor(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ASSET_TYPES[ext]
}

/**
 * The stored name carries a hash of the bytes: `21-the-fork.9f3c1a22.png`.
 *
 * WITHOUT THIS, `immutable` IS A LIE AND THE READER PAYS FOR IT. Assets are served
 * `public, max-age=31536000, immutable`, which instructs every browser and cache never to
 * revalidate for a year, and republishing an artifact overwrote the object under the SAME
 * filename. So a reader who opened a page once kept the first version they ever loaded,
 * permanently, while the publisher's own `curl` fetched fresh bytes and reported everything fine.
 * Measured 2026-09-23: an operator kept seeing a retired diagram on his phone after four
 * republishes, and every check from this machine said the host was correct. It was. His copy was
 * the one nobody could see.
 *
 * Hashing the bytes into the name is what `immutable` is designed for: changed bytes get a new
 * URL, so nothing has to be invalidated and nothing can go stale. Unchanged bytes keep the same
 * URL and stay cached, which is the whole benefit.
 */
export function hashedName(name: string, bytes: Buffer): string {
  return storedName(name, createHash('sha256').update(bytes).digest('hex').slice(0, 8))
}

/** `name` with `digest` spliced in before the extension, the way hashedName stores it. */
export function storedName(name: string, digest: string): string {
  const dot = name.lastIndexOf('.')
  // A name with no extension is legal here, so append rather than assume there is a dot.
  return dot <= 0 ? `${name}.${digest}` : `${name.slice(0, dot)}.${digest}${name.slice(dot)}`
}

export function createArtifactAssets(bucket: Bucket, prefix: string): ArtifactAssets {
  const clean = prefix.replace(/^\/+|\/+$/g, '')
  return {
    async put(id, name, bytes, contentType) {
      const key = `${clean}/${id}/${hashedName(name, bytes)}`
      const file = bucket.file(key)
      await file.save(bytes, {
        contentType,
        resumable: false,
        metadata: { cacheControl: CACHE_CONTROL },
      })
      try {
        await file.makePublic()
      } catch {
        // A bucket with uniform public access has nothing to make public; the URL below still serves.
      }
      return `https://storage.googleapis.com/${bucket.name}/${key}`
    },
    // A route handler on Vercel refuses a body over 4.5 MB (FUNCTION_PAYLOAD_TOO_LARGE), which is
    // about five minutes of narration. An hour-long paper's audio (~55 MB) could never publish.
    // So a big file goes to the bucket directly, on a URL signed with the host's own service
    // account, to the same hashed key and with the same cache header put() writes.
    async signUpload(id, name, digest, contentType) {
      const key = `${clean}/${id}/${storedName(name, digest)}`
      const headers = { 'content-type': contentType, 'cache-control': CACHE_CONTROL }
      const [uploadUrl] = await bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType,
        extensionHeaders: { 'cache-control': CACHE_CONTROL },
      })
      return { uploadUrl, headers, url: `https://storage.googleapis.com/${bucket.name}/${key}` }
    },
    async finishUpload(id, name, digest) {
      const key = `${clean}/${id}/${storedName(name, digest)}`
      const file = bucket.file(key)
      const [there] = await file.exists()
      if (!there) return null
      try {
        await file.makePublic()
      } catch {
        // uniform bucket access: already public
      }
      return `https://storage.googleapis.com/${bucket.name}/${key}`
    },
    // The size cap rides in the signature (`x-goog-content-length-range`), so the bucket itself
    // refuses an oversize body; the browser must send the returned headers verbatim.
    async signAudioUpload(id, path, contentType) {
      const range = `0,${MAX_AUDIO_BYTES}`
      const headers = { 'content-type': contentType, 'cache-control': 'private, max-age=3600', 'x-goog-content-length-range': range }
      const [uploadUrl] = await bucket.file(`${clean}/${id}/${path}`).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType,
        extensionHeaders: { 'cache-control': headers['cache-control'], 'x-goog-content-length-range': range },
      })
      return { uploadUrl, headers }
    },
    async audioSize(id, path) {
      const file = bucket.file(`${clean}/${id}/${path}`)
      const [there] = await file.exists()
      if (!there) return null
      const [meta] = await file.getMetadata()
      return Number(meta.size ?? 0)
    },
    async readAudio(id, path) {
      const file = bucket.file(`${clean}/${id}/${path}`)
      const [there] = await file.exists()
      if (!there) return null
      const [bytes] = await file.download()
      return bytes
    },
    async audioUrl(id, path) {
      const [url] = await bucket.file(`${clean}/${id}/${path}`).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000 })
      return url
    },
  }
}
