// The composite indexes the Firestore stores' queries need, and how to read the refusal Firestore
// throws when one is missing.
//
// Firestore serves equality-only queries by merging single-field indexes, so most of the stores'
// queries need nothing. The exception is an equality on one field plus a range or order on another:
// that needs a composite, and Firestore refuses the query (gRPC 9, FAILED_PRECONDITION) until it
// exists. Today there is one, the comments feed's `slotSince` on <base>State.
//
// A hub deploys these declaratively: commit `firestoreIndexesFor(<every base it passes to
// createStateStore>)` as firestore.indexes.json and run `firebase deploy --only firestore:indexes`.
// A hub that skipped this answered every GET /api/comments with a bare 500 for five days
// in October 2026, so the feed and HEALTH now name the index instead.

export type FirestoreIndex = {
  collectionGroup: string
  queryScope: 'COLLECTION'
  fields: { fieldPath: string; order: 'ASCENDING' | 'DESCENDING' }[]
}
export type FirestoreIndexesFile = { indexes: FirestoreIndex[]; fieldOverrides: [] }

/** The comments feed's composite in words, for error bodies and health reports. */
export const COMMENTS_FEED_INDEX = '<base>State (collection scope): slot ASC, at ASC'

const collectionIdOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** Every composite index the package's Firestore stores need, for the state-store bases a host
 *  uses, in the shape of firestore.indexes.json. A Firestore index is keyed by the collection's id
 *  (the last path segment), so tenants sharing a base under different parents share one entry. */
export function firestoreIndexesFor(stateBases: string[]): FirestoreIndexesFile {
  const groups = [...new Set(stateBases.map((b) => `${collectionIdOf(b)}State`))]
  return {
    indexes: groups.map((collectionGroup) => ({
      collectionGroup, queryScope: 'COLLECTION' as const,
      fields: [{ fieldPath: 'slot', order: 'ASCENDING' as const }, { fieldPath: 'at', order: 'ASCENDING' as const }],
    })),
    fieldOverrides: [],
  }
}

/** Firestore's missing-index refusal, with the console link it carries to create the index, or
 *  null for any other error. */
export function missingIndexOf(err: unknown): { create: string | null } | null {
  if (!err || typeof err !== 'object') return null
  const message = String((err as { message?: unknown }).message ?? '')
  const code = (err as { code?: unknown }).code
  const precondition = code === 9 || code === 'failed-precondition' || /FAILED_PRECONDITION/.test(message)
  if (!precondition || !/requires an index/i.test(message)) return null
  return { create: message.match(/https:\/\/\S+/)?.[0] ?? null }
}
