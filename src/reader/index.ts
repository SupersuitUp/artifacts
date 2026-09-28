// The `./reader` entry: both readers and the bar they share. Each component module carries its
// own 'use client'; this barrel is plain re-exports so it can be imported from either side.
export { ArtifactReader, wrapWords, seekableWord, litWordIndex, type WordTiming } from './artifact-reader.js'
export { BrowserReader } from './browser-reader.js'
export { PlayerBar } from './player-bar.js'
export { planSentences, wordAt, sentenceOf, fromWord, MAX_SENTENCE_WORDS, type Sentence } from './speech-plan.js'
