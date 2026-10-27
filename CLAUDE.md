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
# once the publish run is green, in each consuming host (see below):
npm run update-artifacts -- <version>
```

**Stage `package-lock.json` with `package.json`, always.** The workflow runs `npm ci`, which
refuses a lockfile that disagrees with the manifest.

**The workflow refuses a tag that disagrees with `package.json`, and a version already on npm.**
Both refusals mean a step above was skipped. **A tag is not movable**: a fix after the tag is the
next version.

**Before tagging, run the workflow as a dry run** (`gh workflow run publish -f dry_run=true`) when
the workflow itself changed.

## The release is not done until the hosts run it

**Last step of every release, after the tag's publish run is green: update each consuming host
from this machine.** Every host carries `npm run update-artifacts -- <version>`, which waits for
the registry, installs the version, runs that host's tests and build, and pushes only a green
result (the push deploys). The hosts are the repos named in this repo's `CONSUMING_HOSTS` variable
(`gh variable get CONSUMING_HOSTS`), kept out of the source so this public repo does not list
them. A release that stops at the tag is published and reaches nobody's site.

**The hosts include the hubs.** An operator's own artifacts domain can run on Firebase App Hosting
rather than on a host's Vercel project, and a push deploys nothing there. A host's
`update-artifacts` ends by redeploying every hub that machine deploys (the Supersuit hub skill's
`hub.mjs update`, which redeploys each hub with its own remembered settings), and fails when one
did not take. Until that step existed a release reached the Vercel host and left a hub on the old
code, unnoticed until a route it shipped answered 404 there.

Hosts used to update themselves through a GitHub Action, triggered by the publish workflow's
`repository_dispatch` (still sent, and harmless) and an hourly schedule. That stopped on
2026-10-15 when a host's org could no longer start Actions jobs, and nothing reported it: releases
kept succeeding here while production stayed on the old version. Running the update from the
machine that cut the release is the step that cannot fail without you seeing it.

## What must never land in this repo

It is public. No brand pack carrying anyone's trademark, no tenant tables, no customer names, no
real people in test fixtures (use `example.com` and invented names), no secrets, no default that
points at one company's service. Before a release, `rg -i` for the names of the hosts that consume
this package and justify or remove every hit.

## Proving the package, not the checkout

`npm test` proves the source. `npm run test:packed` proves the tarball the way users run it: it
unpacks it into `test/fixture` (a small Next.js app), runs `next build`, checks the share route's
trace carries the font, then `next start`s it and fetches a page, a share card and a route handler.
Unit tests were green through both defects below; only the fixture caught them.

- **Relative imports end in `.js`; `next/*` imports NEVER do.** `next/navigation.js` bypasses the
  alias Next applies per layer, and every route handler then fails at "collecting page data" on a
  missing `app-route/vendored/contexts/app-router-context.js`. The cost is that plain Node ESM
  cannot load the shell (`next` has no `exports` map), so hosts inline it in Vitest.
- **The font is found from `process.cwd()` and carried by the host's `outputFileTracingIncludes`.**
  Next's tracer does not follow the package's own literal into `node_modules`.
- **The shell never imports from a host** (`src/no-instance-imports.test.ts`).
