// MOVE READERS' VOICE MEMOS OUT OF THE PUBLIC BUCKET (0.38.0). Before 0.38.0 a memo was written to
// the public bucket under `<prefix>/<id>/comments/<memo>` or `<prefix>/<id>/personal/<dir>/<memo>`,
// unlisted, and every read the package handed out was signed. But that bucket carries a bucket-wide
// public read grant, so the memo itself answered an unsigned GET to anyone who had its path.
//
// This copies each such memo to the SAME key in the private bucket, confirms the copy is there, and
// only then deletes the public one. Re-running is safe: a memo already moved is skipped. The package
// reads the private bucket first and the public one second, so a page keeps playing its memos
// before, during and after the move.
import type { Bucket } from '@google-cloud/storage'

/** A reader's memo, by key under the prefix: `<id>/comments/<memo>.<ext>` or `<id>/personal/<dir>/<memo>.<ext>`. */
export const MEMO_KEY = /^[^/]+\/(?:comments\/[^/]+|personal\/[^/]+\/[^/]+)\.(?:webm|m4a|mp4|ogg|wav)$/

export interface MemoMigration { moved: string[]; alreadyPrivate: string[]; failed: { key: string; error: string }[] }

export async function migrateMemosToPrivate(bucket: Bucket, privateBucket: Bucket, prefix: string, { dryRun = false } = {}): Promise<MemoMigration> {
  if (privateBucket.name === bucket.name) throw new Error('the private bucket must be a different bucket from the public one')
  const clean = prefix.replace(/^\/+|\/+$/g, '')
  const [files] = await bucket.getFiles({ prefix: `${clean}/` })
  const out: MemoMigration = { moved: [], alreadyPrivate: [], failed: [] }
  for (const f of files) {
    const rel = f.name.slice(clean.length + 1)
    if (!MEMO_KEY.test(rel)) continue
    try {
      const dest = privateBucket.file(f.name)
      if ((await dest.exists())[0]) {
        if (!dryRun) await f.delete()
        out.alreadyPrivate.push(f.name)
        continue
      }
      if (dryRun) { out.moved.push(f.name); continue }
      await f.copy(dest)
      if (!(await dest.exists())[0]) throw new Error('the copy did not arrive in the private bucket')
      await f.delete()
      out.moved.push(f.name)
    } catch (e) {
      out.failed.push({ key: f.name, error: (e as Error).message })
    }
  }
  return out
}
