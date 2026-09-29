// The `./reader` entry: both readers and the bar they share. Each component module carries its
// own 'use client'; this barrel is plain re-exports so it can be imported from either side.
export { ArtifactReader, wrapWords, seekableWord, litWordIndex, type WordTiming } from './artifact-reader.js'
export { BrowserReader } from './browser-reader.js'
export { PlayerBar } from './player-bar.js'
export { planSentences, wordAt, sentenceOf, fromWord, MAX_SENTENCE_WORDS, type Sentence } from './speech-plan.js'
export { CommentLayer } from './comment-layer.js'
export { CommentCard, warningLine, DEVICE_LINE } from './comment-card.js'
export { deviceNotes, deviceNotesKey, addDeviceNote, replaceDeviceNote, removeDeviceNote } from './device-notes.js'
export { indexText, offsetAt, rangeOf, headingAt, placeAnchor, boxOf, regionFrom, type TextIndex, type Placement } from './comment-place.js'
