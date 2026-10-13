import { describe, it, expect } from 'vitest'
import * as api from './index.js'

describe('the artifacts entry point', () => {
  it('exports the per-reader names a host needs and none of the signing internals', () => {
    for (const k of ['createRecipientsStore', 'memoryRecipientsStore', 'summarizeViews', 'ridLink', 'parseRidParam', 'verifyRid', 'isUnfurlAgent', 'usableSecret', 'RECIPIENT_SECRET_MIN', 'ridOfReaderKey', 'PRIVATE_READ_TTL_MS'])
      expect(api, k).toHaveProperty(k)
    for (const k of ['beatKey', 'mintRenderToken', 'verifyRenderToken', 'newRid', 'ridSig', 'ridCookieName', 'TOKEN_MAX_AGE_MS', 'VIEW_AFTER_MS', 'RID_RE', 'RID_COOKIE_MAX_AGE', 'UNFURL_AGENTS', 'CAME_BACK_MS'])
      expect(api, k).not.toHaveProperty(k)
  })
  it('exports the page kinds and the list helpers (0.37.0)', () => {
    for (const k of ['ARTIFACT_KINDS', 'kindOf', 'listOfKind']) expect(api, k).toHaveProperty(k)
    expect(api.ARTIFACT_KINDS).toEqual(['document', 'broadcast'])
  })
})
