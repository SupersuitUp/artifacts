// A page's language and its translations (supersuit-dev#2156): `lang:` is a BCP 47 tag, and
// `translations:` maps a tag to the id of the same document in that language on this host.
import { ARTIFACT_ID_RE } from '../routes/ids.js'

/** A BCP 47 language tag, loosely: a primary subtag of 2 or 3 letters, then subtags. */
export const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** The most translations one page may name: a switch, not a directory. */
export const MAX_TRANSLATIONS = 12

export function parseLang(v: unknown): { ok: true; lang: string } | { ok: false; error: string } {
  if (typeof v !== 'string' || !LANG_TAG.test(v.trim())) return { ok: false, error: 'lang must be a language tag, like en, es or es-MX' }
  return { ok: true, lang: v.trim() }
}

export function parseTranslations(v: unknown): { ok: true; translations: Record<string, string> } | { ok: false; error: string } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'translations must be a map of language tag to page id, like {"es": "abcd2345"}' }
  const out: Record<string, string> = {}
  for (const [k, id] of Object.entries(v as Record<string, unknown>)) {
    if (!LANG_TAG.test(k)) return { ok: false, error: `translations: ${k} is not a language tag` }
    if (typeof id !== 'string' || !ARTIFACT_ID_RE.test(id)) return { ok: false, error: `translations: ${k} must name a page id on this host (the publisher resolves the file to its id)` }
    out[k] = id
  }
  if (Object.keys(out).length > MAX_TRANSLATIONS) return { ok: false, error: `translations: at most ${MAX_TRANSLATIONS}` }
  return { ok: true, translations: out }
}

/** A language named in itself ("Español" for es), capitalised; the tag itself when unknown. */
export function languageName(tag: string): string {
  try {
    const n = new Intl.DisplayNames([tag], { type: 'language', fallback: 'none' }).of(tag)
    if (!n) return tag
    return n.charAt(0).toLocaleUpperCase(tag) + n.slice(1)
  } catch {
    return tag
  }
}

/** og:locale's shape: en, es_MX. */
export function ogLocale(tag: string): string {
  return tag.replace(/-/g, '_')
}
