// The Freedom look's share-card font: Newsreader 600 (OFL, a static instance from Google
// Fonts), the nearest open face to the Georgia the pack renders pages in. Bundled with the
// package so an operator with no pack of their own still unfurls as a title card rather than
// as nothing. It ships at `fonts/Newsreader-600.ttf` in the package root.
//
// WHY THE PATHS ARE LITERALS JOINED TO process.cwd(). A Next app bundles this module, so
// `import.meta.url` points into `.next/`, not at the package, and cannot find the font. The
// file tracer Next uses to decide which files reach a serverless function reads literal
// `join(process.cwd(), '...')` calls, so these literals are also what carries the font into
// the deploy. A host whose cwd is not its project root adds the font to
// `outputFileTracingIncludes` itself (see README).
//
// Only type imports reach this module from anything client-side, so the node imports are safe.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CANDIDATES = [
  // Installed as a dependency: the normal case for every host.
  join(process.cwd(), 'node_modules/@supersuit/artifacts/fonts/Newsreader-600.ttf'),
  // This package's own checkout, where its tests run.
  join(process.cwd(), 'fonts/Newsreader-600.ttf'),
]

async function firstReadable(paths: string[]): Promise<Buffer> {
  for (const p of paths) {
    try {
      return await readFile(p)
    } catch {
      // try the next place
    }
  }
  throw new Error(`@supersuit/artifacts: Newsreader-600.ttf not found. Looked in: ${paths.join(', ')}`)
}

export async function newsreader() {
  const b = await firstReadable(CANDIDATES)
  return { name: 'Newsreader', data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, weight: 600 }
}
