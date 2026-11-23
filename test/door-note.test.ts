// A private page's door names the sign-in a reader can actually use. With Microsoft on, a Microsoft
// 365 reader was told to use "the Google account it was shared with" (a client's hub, 2026-11-23).
import { describe, it, expect } from 'vitest'
import { signInNoteFor } from '../template/hub/src/lib/door-note'

describe("the private page's door line", () => {
  it('names Google alone on a Google-only hub', () => {
    expect(signInNoteFor(['google'])).toBe('This page is private. Sign in with the Google account it was shared with.')
  })
  it('names Microsoft too when the hub turned Microsoft sign-in on', () => {
    const note = signInNoteFor(['google', 'microsoft'])
    expect(note).toBe('This page is private. Sign in with the Google or Microsoft account it was shared with.')
  })
  it('names Microsoft alone when only Microsoft is on', () => {
    expect(signInNoteFor(['microsoft'])).toBe('This page is private. Sign in with the Microsoft account it was shared with.')
  })
  it('names the email address when the hub has the email link door, since any address can use it', () => {
    expect(signInNoteFor(['email'])).toBe('This page is private. Sign in with the email address it was shared with.')
    expect(signInNoteFor(['google', 'microsoft', 'email'])).toBe('This page is private. Sign in with the email address it was shared with.')
  })
  it('falls back to Google when no providers are given', () => {
    expect(signInNoteFor(undefined)).toBe(signInNoteFor(['google']))
  })
})
