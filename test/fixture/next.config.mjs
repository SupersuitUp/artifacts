import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export default {
  // The fixture's peers (next, react, firebase-admin) resolve from the package repo's own
  // node_modules two levels up, so Turbopack's root has to include them.
  turbopack: { root: resolve(here, '../..') },
  outputFileTracingRoot: resolve(here, '../..'),
  outputFileTracingIncludes: { '/*/share.png': ['./node_modules/@supersuit/artifacts/fonts/**'] },
}
