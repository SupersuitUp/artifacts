// A reader who taps the verification link and then reloads the page holds a user whose email is
// verified but a cached ID token that still says email_verified: false. The pass route reads the
// token, so it answered 403 and the page showed a dead end: "That account has no verified email"
// (Gary, Firefly's hub, Microsoft 365 account, 2026-11-23). The pass request now always sends a fresh
// token, and a 403 offers Continue (reload, refresh, try again) instead of a dead end.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '../template/hub/app/artifact/sign-in/sign-in.tsx'), 'utf8')
const openPage = src.slice(src.indexOf('async function openPage'), src.indexOf('async function openPage') + 700)

describe('the hub sign-in page after a reader verifies their email', () => {
  it('asks for the pass with a freshly minted ID token, never the cached one', () => {
    expect(openPage).toContain('getIdToken(true)')
    expect(openPage).not.toMatch(/getIdToken\(\)/)
  })
  it('offers Continue on a refused pass instead of a dead end', () => {
    const line = src.split('\n').find((l) => l.includes("state === 'unverified'"))
    expect(line).toBeTruthy()
    const at = src.indexOf("if (state === 'unverified')")
    expect(src.slice(at, at + 600)).toContain('continueAfterVerify')
  })
})
