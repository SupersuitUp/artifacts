# @supersuit/artifacts

## Releasing: npm publishing runs in GitHub Actions, never on this machine

**Never run `npm publish` here, and never go looking for an npm token.** `npm whoami` answering
`E401` on a laptop is the expected state. Publishing is done by `.github/workflows/publish.yml`
through **OIDC trusted publishing**: GitHub mints a short-lived identity for the workflow and npm
verifies it against the trusted-publisher record on the package. There is deliberately no
`NODE_AUTH_TOKEN`, no `registry-url` and no `environment:` in that workflow; adding any of them
breaks the publish. The workflow header explains each trap. The same rules, and the incidents
that earned them, live in SupersuitUp/docusaurus-preset-wiki's CLAUDE.md and publish.yml.

**The release is a tag push:**

```bash
npm version patch --no-git-tag-version   # or minor/major
# write the CHANGELOG entry: what changed, the DETECTOR, the REMEDY, the tests
git add package.json package-lock.json CHANGELOG.md
git commit -m "<version>: <one line>"
git push origin main
git tag v<version> && git push origin v<version>
```

**Stage `package-lock.json` with `package.json`, always.** The workflow runs `npm ci`, which
refuses a lockfile that disagrees with the manifest.

**The workflow refuses a tag that disagrees with `package.json`, and a version already on npm.**
Both refusals mean a step above was skipped. **A tag is not movable**: a fix after the tag is the
next version.

**Before tagging, run the workflow as a dry run** (`gh workflow run publish -f dry_run=true`) when
the workflow itself changed.

## Hosts update themselves; this repo tells them

After a publish, the workflow sends a `repository_dispatch` (`supersuit-artifacts-published`) to
every repo in its `HOSTS` list, using the `HOSTS_DISPATCH_TOKEN` secret. Each host's own workflow
bumps the dependency, runs its tests and build, and pushes only a green result. Hosts also check
npm daily, so a missing token delays an update and loses nothing. Adding a host is one word in
`HOSTS` plus that host's workflow.

## What must never land in this repo

It is public. No brand pack carrying anyone's trademark, no tenant tables, no customer names, no
real people in test fixtures (use `example.com` and invented names), no secrets, no default that
points at one company's service. Before a release, `rg -i` for the names of the hosts that consume
this package and justify or remove every hit.

## Proving the package, not the checkout

`npm test` proves the source. `npm run test:packed` proves the tarball: every export resolves
under plain Node ESM from a host-shaped `node_modules`, the font ships and is found there, and the
reader keeps `'use client'`. A consumer installs the tarball, so the second one is the check that
matches what users run.

- **Every relative import ends in `.js`, and every `next/*` import names its file**
  (`next/server.js`). `next` has no `exports` map, so an extensionless subpath works in a bundler
  and crashes plain Node ESM. `tsc` (NodeNext) refuses the extensionless form, which is the guard.
- **The shell never imports from a host** (`src/no-instance-imports.test.ts`).
