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
every repo named in the `CONSUMING_HOSTS` repository variable (space-separated `owner/repo`, kept
out of the source so this public repo does not list its hosts), using the `HOSTS_DISPATCH_TOKEN`
secret. Each host's own workflow
bumps the dependency, runs its tests and build, and pushes only a green result. Hosts also check
npm daily, so a missing token delays an update and loses nothing. Adding a host is one word in
`CONSUMING_HOSTS` plus that host's workflow.

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
