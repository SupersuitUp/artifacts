#!/usr/bin/env node
// Move readers' voice memos from the public bucket to the private one (0.38.0), for one prefix.
//   node scripts/migrate-memos-private.mjs --public <bucket> --private <bucket> --prefix tenants/<t>/artifacts [--dry-run]
// Uses Application Default Credentials. Prints what moved; exits 1 if any memo failed to move.
import { Storage } from '@google-cloud/storage'
import { migrateMemosToPrivate } from '../lib/artifacts/migrate-memos.js'

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const pub = arg('--public'), priv = arg('--private'), prefix = arg('--prefix')
if (!pub || !priv || !prefix) { console.error('usage: migrate-memos-private.mjs --public <bucket> --private <bucket> --prefix <prefix> [--dry-run]'); process.exit(2) }
const s = new Storage()
const r = await migrateMemosToPrivate(s.bucket(pub), s.bucket(priv), prefix, { dryRun: process.argv.includes('--dry-run') })
console.log(JSON.stringify({ prefix, moved: r.moved.length, alreadyPrivate: r.alreadyPrivate.length, failed: r.failed }, null, 2))
process.exit(r.failed.length ? 1 : 0)
