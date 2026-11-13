// The `./karaoke` entry: the karaoke rules on their own, with no React and no other package, so a
// surface that lights words (a voice note, a page's narration, another app) imports them instead
// of copying them.
export {
  litWordIndex,
  begunCount,
  litDeclarations,
  wordStateCss,
  WORD_CLASS,
  LIT_CLASS,
  AHEAD_CLASS,
  type WordTiming,
} from './reader/karaoke.js'
