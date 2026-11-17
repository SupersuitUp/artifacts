#!/usr/bin/env node
// Give a tenant's private bucket the CORS rule its hub needs (supersuit-dev#2519), so a reader's
// browser can open a private file and upload a voice memo. A shared host runs this for each tenant
// in its tenant setup and in update-artifacts; re-running changes nothing.
//   node scripts/ensure-private-bucket-cors.mjs --bucket <private bucket> --host <hub host> [--host <another>] [--dry-run]
// Uses Application Default Credentials. Prints what it found or set; exits 1 on a failure.
import { Storage } from '@google-cloud/storage'
import { ensurePrivateBucketCors } from '../lib/artifacts/bucket-cors.js'

const argv = process.argv.slice(2)
const bucket = argv[argv.indexOf('--bucket') + 1]
const hosts = argv.flatMap((a, i) => (a === '--host' && argv[i + 1] ? [argv[i + 1]] : []))
if (!argv.includes('--bucket') || !bucket || !hosts.length) {
  console.error('usage: ensure-private-bucket-cors.mjs --bucket <private bucket> --host <hub host> [--host <another>] [--dry-run]')
  process.exitCode = 2
} else {
  try {
    const r = await ensurePrivateBucketCors(new Storage().bucket(bucket), hosts, { dryRun: argv.includes('--dry-run') })
    console.log(JSON.stringify(r, null, 2))
  } catch (e) {
    console.error(`gs://${bucket}: ${e.message}`)
    process.exitCode = 1
  }
}
