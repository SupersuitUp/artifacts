// The `./reader` entry: the reader and the bar it uses. Each component module carries its
// own 'use client'; this barrel is plain re-exports so it can be imported from either side.
export { ArtifactReader, wrapWords, seekableWord, litWordIndex, type WordTiming } from './artifact-reader.js'
export { PlayerBar } from './player-bar.js'
export { CommentLayer } from './comment-layer.js'
export { CommentCard, warningLine, DEVICE_LINE } from './comment-card.js'
export { deviceNotes, deviceNotesKey, addDeviceNote, replaceDeviceNote, removeDeviceNote } from './device-notes.js'
export { indexText, offsetAt, rangeOf, headingAt, placeAnchor, boxOf, regionFrom, type TextIndex, type Placement } from './comment-place.js'
export { VoiceRecorder, AudioPlay, hostVoice, pickRecordingType, newMemoId, recognitionCtor, LIVE_LINE, type VoiceHost, type VoiceMemo, type VoiceScope } from './voice-recorder.js'
export { deviceAudio, isDeviceAudio, type DeviceAudio } from './device-audio.js'
export { type SavedMemo } from './comment-card.js'
