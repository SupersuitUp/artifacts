// A FILE PAGE (any-file artifacts, 2026-11-11): one file, served as itself, with no markdown around
// it. The record keeps the file's name, size, its path in the operator's workspace (so a republish
// of the same path finds this page through the hub's page list) and, once uploaded, its private
// stored name. The type is never the publisher's word: it is read from the stored name, which is
// what the bucket serves the bytes as.
import { PRIVATE_REF, fileTypeFor, showsInline } from './assets.js'

export type FileBody = { name: string; bytes: number; source: string; type: string; ref?: string }

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const NAME = /^[^/\\\r\n]{1,200}$/

export function parseFileBody(raw: unknown): { ok: true; file: FileBody } | { ok: false; error: string } {
  if (!isMap(raw)) return { ok: false, error: 'a file page needs file: with name, bytes and source' }
  for (const k of Object.keys(raw)) if (!['name', 'bytes', 'source', 'ref'].includes(k)) return { ok: false, error: `file has an unknown key: ${k}` }
  const { name, bytes, source, ref } = raw
  if (typeof name !== 'string' || !NAME.test(name) || name === '.' || name === '..') return { ok: false, error: 'file.name must be the file name, 1 to 200 characters, with no slash' }
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1) return { ok: false, error: 'file.bytes must be the size in bytes' }
  if (typeof source !== 'string' || !source.trim() || source.length > 400 || /[\r\n]/.test(source)) return { ok: false, error: "file.source must be the file's path, one line of up to 400 characters" }
  if (ref !== undefined && (typeof ref !== 'string' || !PRIVATE_REF.test(ref))) return { ok: false, error: 'file.ref must be private:<stored name>' }
  const stored = typeof ref === 'string' ? PRIVATE_REF.exec(ref)![1] : name
  return { ok: true, file: { name, bytes, source: source.trim(), type: fileTypeFor(stored), ...(typeof ref === 'string' ? { ref } : {}) } }
}

export type PrivateUrl = (id: string, stored: string, opts?: { download?: string }) => Promise<string>

/** The reader's two links: `open` only for the safe list, read from the STORED name (what the bucket
 *  serves the bytes as); `download` always, signed as an attachment. Null until the file arrives. */
export async function fileLinks(id: string, file: FileBody, privateUrl: PrivateUrl): Promise<{ open: string | null; download: string } | null> {
  const stored = file.ref ? PRIVATE_REF.exec(file.ref)?.[1] : undefined
  if (!stored) return null
  const download = await privateUrl(id, stored, { download: file.name })
  const open = showsInline(fileTypeFor(stored)) ? await privateUrl(id, stored) : null
  return { open, download }
}

/** Whether the reader's browser draws the file as a table (Task 25): judged, like `fileLinks`, from
 *  the STORED name. Null-safe before the file arrives. The hub server never reads the bytes. */
export function showsAsSheet(file: FileBody): boolean {
  const stored = file.ref ? PRIVATE_REF.exec(file.ref)?.[1] : undefined
  return !!stored && /\.(xlsx|xls|csv|ods)$/i.test(stored)
}

const NOUNS: [RegExp, string, string][] = [
  [/^application\/pdf$/, 'PDF', 'PDF'],
  [/^image\//, 'Image', 'image'],
  [/^video\//, 'Video', 'video'],
  [/^audio\//, 'Sound', 'sound file'],
  [/spreadsheet|ms-excel|^text\/csv$/, 'Spreadsheet', 'spreadsheet'],
  [/wordprocessing|msword/, 'Document', 'document'],
  [/presentation/, 'Slides', 'slide deck'],
  [/zip/, 'Archive', 'zip file'],
]
/** What to call the file on the page: the box's cap line and the noun in a sentence. */
export function fileNoun(type: string): { cap: string; noun: string } {
  const hit = NOUNS.find(([re]) => re.test(type))
  return hit ? { cap: hit[1], noun: hit[2] } : { cap: 'File', noun: 'file' }
}

export function sizeWords(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, '')} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} bytes`
}
