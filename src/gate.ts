// Routes every instance serves without its site gate. The trailing slash on '/a/' is
// load-bearing: a bare '/a' prefix also matched /admin on the pilot (2026-09-11).
// On a dedicated host every path is public and this list is moot; it exists for an
// instance that mounts artifacts inside a gated site under the '/a/' prefix.
export const ARTIFACT_PUBLIC_PREFIXES = ['/a/', '/api/artifacts'] as const
