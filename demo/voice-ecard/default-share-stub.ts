// The browser stand-in for src/brand/default-share.ts, which reads a font file from disk for share
// cards and so cannot load in a browser bundle. The demo never draws a share card.
export async function newsreader(): Promise<never> { throw new Error('no share cards in the demo') }
