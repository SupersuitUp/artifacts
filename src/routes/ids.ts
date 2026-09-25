// Ids are 8 chars from the safe alphabet; anything else is not a page and never reaches the store.
// No 0/o, 1/l/i: an id read aloud or retyped from a screenshot must survive it.
export const ARTIFACT_ID_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/
