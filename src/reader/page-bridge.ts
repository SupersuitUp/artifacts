// Small bridges between the page menu and the parts of the page it drives, so neither has to
// import the other. Both run in the same window; a window event is the whole wire.

/** The menu asks the comment layer to show (true) or hide (false) its pins. */
export const PINS_SET = 'artifact:pins-set'
/** The comment layer says whether its pins are showing, on mount and on every change. */
export const PINS_STATE = 'artifact:pins-state'

export function requestPins(show: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(PINS_SET, { detail: show }))
}
export function announcePins(show: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(PINS_STATE, { detail: show }))
}

/** A recording's "Note at 0:14" button asks the comment layer to open a note at that second.
 *  Detail: { block: string; at: number }. */
export const NOTE_AT = 'artifact:note-at'
/** A comment's "At 0:14" line asks the recording in that block to move there. Same detail. */
export const SEEK_TO = 'artifact:seek-to'

/** The sign-in link, returning to this exact address, hash included, so a reader who signs in
 *  lands where they were (a linked comment, a section). */
export function signInBack(signIn: string): string {
  try {
    const u = new URL(signIn)
    u.searchParams.set('to', window.location.href)
    return u.toString()
  } catch { return signIn }
}
