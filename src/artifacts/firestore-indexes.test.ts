// The composite indexes the Firestore stores' queries need, as data a host deploys
// (firestore.indexes.json), and the error Firestore throws when one is missing, read so a route can
// name it instead of answering a bare 500.
import { describe, it, expect } from 'vitest'
import { firestoreIndexesFor, missingIndexOf, COMMENTS_FEED_INDEX } from './firestore-indexes.js'

describe('firestoreIndexesFor', () => {
  it('names the comments feed composite on <base>State by its collection id: slot ASC, at ASC', () => {
    expect(firestoreIndexesFor(['tenants/gary/artifact'])).toEqual({
      indexes: [{
        collectionGroup: 'artifactState', queryScope: 'COLLECTION',
        fields: [{ fieldPath: 'slot', order: 'ASCENDING' }, { fieldPath: 'at', order: 'ASCENDING' }],
      }],
      fieldOverrides: [],
    })
  })

  it('one entry per collection id, however many tenants share it', () => {
    const out = firestoreIndexesFor(['tenants/a/artifact', 'tenants/b/artifact', 'pages'])
    expect(out.indexes.map((i) => i.collectionGroup)).toEqual(['artifactState', 'pagesState'])
  })

  it('COMMENTS_FEED_INDEX describes the same fields in words', () => {
    expect(COMMENTS_FEED_INDEX).toMatch(/slot ASC, at ASC/)
  })
})

describe('missingIndexOf', () => {
  const firestoreError = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc'), { code: 9 })

  it('reads Firestore\'s missing-index refusal and its create link', () => {
    expect(missingIndexOf(firestoreError)).toEqual({ create: 'https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc' })
  })

  it('a link-less refusal still counts, with create null', () => {
    expect(missingIndexOf(Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 }))).toEqual({ create: null })
  })

  it('anything else is not a missing index', () => {
    expect(missingIndexOf(new Error('boom'))).toBeNull()
    expect(missingIndexOf(Object.assign(new Error('9 FAILED_PRECONDITION: transaction aborted'), { code: 9 }))).toBeNull()
    expect(missingIndexOf(null)).toBeNull()
    expect(missingIndexOf('requires an index')).toBeNull()
  })
})
