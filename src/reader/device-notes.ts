// Personal notes for a reader who is not signed in, kept in their browser and nowhere else. They
// never reach any server, so a page owner running their own host cannot read them either. On
// sign-in the comment layer posts them to the reader's account and clears them here.
//
// Plain functions over localStorage, so the layer and its tests share one small surface.
import type { PersonalNote, PersonalNoteValue } from '../artifacts/personal-store.js'

export const deviceNotesKey = (artifactId: string) => `artifact-notes:${location.host}:${artifactId}`

function read(artifactId: string): PersonalNote[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(deviceNotesKey(artifactId)) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((n): n is PersonalNote =>
      !!n && typeof n === 'object' && typeof n.id === 'string' && typeof n.at === 'string' && !!n.value && typeof n.value === 'object')
  } catch {
    return []
  }
}
function write(artifactId: string, notes: PersonalNote[]) {
  try {
    if (notes.length) window.localStorage.setItem(deviceNotesKey(artifactId), JSON.stringify(notes))
    else window.localStorage.removeItem(deviceNotesKey(artifactId))
  } catch {
    // Storage full or blocked (a private window): the note is lost with the tab, and nothing breaks.
  }
}

export const deviceNotes = (artifactId: string): PersonalNote[] => read(artifactId)

export function addDeviceNote(artifactId: string, value: PersonalNoteValue): PersonalNote {
  const n: PersonalNote = { id: `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, value, at: new Date().toISOString() }
  write(artifactId, [...read(artifactId), n])
  return n
}
export function replaceDeviceNote(artifactId: string, id: string, value: PersonalNoteValue) {
  write(artifactId, read(artifactId).map((n) => (n.id === id ? { ...n, value, updatedAt: new Date().toISOString() } : n)))
}
export function removeDeviceNote(artifactId: string, id: string) {
  write(artifactId, read(artifactId).filter((n) => n.id !== id))
}
