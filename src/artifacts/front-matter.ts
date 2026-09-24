// The artifact contract: markdown plus a small front matter.
// Documented in README, "Front matter".
import matter from 'gray-matter'
import { ACCESS_LEVELS, type Access } from './reader.js'

export type ArtifactMeta = {
  title: string
  summary: string
  template: 'document'
  /** A line under the title. Title, subtitle and summary are three separate fields; the summary
   *  is the teaser, and the unfurl carries the title and the summary. */
  subtitle?: string
  audience?: string
  cover?: string
  id?: string
  /** Narrator to generate with (a voice id the host's publisher knows). The publisher acts on it; the API stores it. */
  voice?: string
  /** Bucket URLs written by the publisher after narration; absent means no player. */
  narration?: string
  timings?: string
  /** Hash of the narrated text, so a changed body is re-narrated and an unchanged one is not. */
  narrationHash?: string
  /** Shut the page behind this until `?key=<password>` or the cookie it sets. Never rendered. */
  password?: string
  /** Who may read it, checked against a signed-in reader: `invite` is the host-side allowlist
   *  only; `freedom` is any active Freedom account plus that list; `public` opens it again.
   *  ABSENT CHANGES NOTHING: the level is host-side state, so a republish that omits the line
   *  (or a publisher that strips unknown keys) can never reopen a confidential page. */
  access?: Access | 'public'
}

const KNOWN = new Set(['title', 'summary', 'subtitle', 'template', 'audience', 'cover', 'id', 'voice', 'narration', 'timings', 'narrationHash', 'password', 'access'])

export function parseArtifactSource(
  text: string,
): { ok: true; meta: ArtifactMeta; body: string } | { ok: false; error: string } {
  const { data, content } = matter(text)
  const d = data as Record<string, unknown>
  for (const k of Object.keys(d)) {
    if (!KNOWN.has(k)) return { ok: false, error: `front matter has an unknown key: ${k}` }
  }
  for (const k of ['title', 'summary'] as const) {
    const v = d[k]
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `front matter is missing ${k}` }
  }
  const template = d.template ?? 'document'
  if (template !== 'document') return { ok: false, error: 'template must be document' }
  const meta: ArtifactMeta = {
    title: String(d.title).trim(),
    summary: String(d.summary).trim(),
    template: 'document',
  }
  for (const k of ['subtitle', 'audience', 'cover', 'id', 'voice', 'narration', 'timings', 'narrationHash', 'password'] as const) {
    const v = d[k]
    if (typeof v === 'string' && v) meta[k] = v
  }
  if (d.access !== undefined) {
    if (d.access !== 'public' && !ACCESS_LEVELS.includes(d.access as Access))
      return { ok: false, error: `access must be one of: public, ${ACCESS_LEVELS.join(', ')}` }
    meta.access = d.access as Access | 'public'
  }
  return { ok: true, meta, body: content }
}
