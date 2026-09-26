// Where each note on a page shows, and the few names both sides share. Kept free of the
// markdown parser on purpose: the notes widget runs in the reader's browser and imports this,
// and the parser has no business in that bundle.
export const NOTES_SLOT = 'notes'
export const MAX_NOTE_CHARS = 4000

export type Heading = { depth: number; line: number; text: string; slug: string }
export type NoteValue = { slug: string; heading: string; note: string }
/** A note as a reader's page holds it: the stored value plus who and when. */
export type PlacedNote = NoteValue & { id: string; name: string; at: string; mine: boolean }

/** Where each note shows: under the heading with its slug, else under a heading with its exact
 *  text (a repeated heading renumbered), else under "notes on earlier versions". Never under a
 *  heading that merely looks close: a note on the wrong section is worse than one set aside. */
export function placeNotes(headings: Pick<Heading, 'slug' | 'text'>[], notes: PlacedNote[]): { bySlug: Record<string, PlacedNote[]>; earlier: PlacedNote[] } {
  const bySlug: Record<string, PlacedNote[]> = {}
  const earlier: PlacedNote[] = []
  const slugs = new Set(headings.map((h) => h.slug))
  const byText = new Map<string, string>()
  for (const h of headings) if (!byText.has(h.text)) byText.set(h.text, h.slug)
  for (const n of notes) {
    const at = slugs.has(n.slug) ? n.slug : byText.get(n.heading)
    if (at) (bySlug[at] ??= []).push(n)
    else earlier.push(n)
  }
  return { bySlug, earlier }
}
