// The deployable hub host ships inside this package at template/hub/ (supersuit-dev#1630), so an
// operator with no access to any private repository can stand up their own artifact hub. Supersuit's
// create-or-update-my-artifact-hub copies the folder out of the installed package and deploys it, and
// it refuses a source that is not a deployable Next.js app before any cloud call (supersuit-dev#1606).
// These hold the three things that refusal checks, that the folder actually ships, and that the host
// installs the very version of the package it came out of.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const hub = join(root, 'template/hub')
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))

describe('the hub host template', () => {
  it('ships in the tarball', () => {
    expect(json(join(root, 'package.json')).files).toContain('template')
  })

  it('is what the hub setup accepts as a deployable Next.js host', () => {
    const pkg = json(join(hub, 'package.json'))
    expect(pkg.scripts.build).toMatch(/\bnext\s+build\b/)
    expect(pkg.dependencies.next).toBeTruthy()
    expect(existsSync(join(hub, 'app'))).toBe(true)
  })

  it('installs the version of @supersuit/artifacts it ships in (npm version runs scripts/sync-template-version.mjs)', () => {
    const version = json(join(root, 'package.json')).version
    expect(json(join(hub, 'package.json')).dependencies['@supersuit/artifacts']).toBe(version)
    expect(json(join(root, 'package.json')).scripts.version).toMatch(/sync-template-version\.mjs/)
  })

  it('carries the App Hosting settings shape and the Firestore index the setup reads', () => {
    const yaml = readFileSync(join(hub, 'apphosting.yaml'), 'utf8')
    for (const v of ['HUB_TENANT', 'FIREBASE_STORAGE_BUCKET', 'ARTIFACT_PRIVATE_BUCKET', 'TENANT_PUBLISH_KEY_HUB', 'ARTIFACT_PASS_SECRET', 'ARTIFACT_RECIPIENT_SECRET']) {
      expect(yaml).toContain(`variable: ${v}`)
    }
    expect(json(join(hub, 'firestore.indexes.json')).indexes[0].collectionGroup).toBe('artifactState')
  })

  it('serves every route the setup and the publisher call', () => {
    for (const r of ['[id]/page.tsx', '[id]/share.png/route.tsx', 'api/artifacts/route.ts', 'api/reader/enter/route.ts',
      'api/reader/ack/route.ts', 'api/reader/ask/route.ts', 'api/health/route.ts', 'api/comments/route.ts', 'api/artifact-pass/route.ts', 'api/activity/route.ts',
      'artifact/sign-in/page.tsx', 'brand.json/route.ts', 'frapp/route.ts']) {
      expect(existsSync(join(hub, 'app', r)), r).toBe(true)
    }
  })
  it('shows its owner the dashboard on the home (HubHome) and everyone else the plain front page', () => {
    const home = readFileSync(join(hub, 'app/page.tsx'), 'utf8')
    expect(home).toMatch(/hubRoutes\(\)\.HubHome\(\{ searchParams \}\)/)
    expect(home).toContain('shares by link')
  })
})
