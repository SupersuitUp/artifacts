// A page with a `password:` in its front matter is shut until the reader opens it, and it
// opens two ways: `?key=<password>` in the URL (the link the author sends; the page then sets
// a cookie so the next visit needs nothing) or that cookie. The cookie holds a hash bound to
// the page id, so a stolen cookie names no password and opens no other page. Same shape as
// the wiki family's `?key=` links (share-a-wiki-page), so an operator learns one convention.
import { createHash } from 'node:crypto'

export function keyHash(id: string, password: string): string {
  return createHash('sha256').update(`${id}\n${password}`).digest('hex')
}

export function unlockCookieName(id: string): string {
  return `artifact_key_${id}`
}

export function isUnlocked({ id, password, key, cookie }: { id: string; password?: string; key?: string | null; cookie?: string | null }): boolean {
  if (!password) return true
  if (typeof key === 'string' && key === password) return true
  if (typeof cookie === 'string' && cookie === keyHash(id, password)) return true
  return false
}

export function unlockedUrl(pageUrl: string, password: string): string {
  return `${pageUrl}?key=${encodeURIComponent(password)}`
}
