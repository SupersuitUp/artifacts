// Where an artifact's files live (cover, images, narration audio and timings). The shell
// only knows the interface; the instance hands in a bucket. Before this existed the
// publisher shelled out to gsutil against the maintainer's bucket, which no other operator
// could do, so every operator gets the same door: PUT bytes with their key, get a URL back.
import { createHash } from 'node:crypto'
import type { Bucket } from '@google-cloud/storage'

export interface ArtifactAssets {
  /** Store `bytes` for artifact `id` under `name`; return the public URL. */
  put(id: string, name: string, bytes: Buffer, contentType: string): Promise<string>
}

/** Names are one path segment: letters, digits, dot, dash, underscore. */
export const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

export const ASSET_TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
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
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
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
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      })
      try {
        await file.makePublic()
      } catch {
        // A bucket with uniform public access has nothing to make public; the URL below still serves.
      }
      return `https://storage.googleapis.com/${bucket.name}/${key}`
    },
  }
}
