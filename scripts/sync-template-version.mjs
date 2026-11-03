// Pin template/hub's @supersuit/artifacts to this package's own version. `npm version` runs this
// (the `version` lifecycle script) right after it bumps package.json, so the host an operator
// deploys always installs the very package it was copied out of. test/hub-template.test.mjs holds it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const file = join(root, 'template/hub/package.json')
const pkg = JSON.parse(readFileSync(file, 'utf8'))
if (pkg.dependencies['@supersuit/artifacts'] !== version) {
  pkg.dependencies['@supersuit/artifacts'] = version
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`template/hub now installs @supersuit/artifacts ${version}`)
}
