# Changelog

`@supersuit/artifacts`. One entry per version, newest first. Each entry says what changed, how a
host can tell whether it is affected (DETECTOR), what a host does about it (REMEDY), and the tests.

## 0.1.0 (2026-09-24)

**The site shell behind Freedom's `artifacts.<name>` pages, published as a package.** It was a
private workspace package (`@freedom/site-shell`) inside the one deployment that serves every
operator's pages; it now ships from its own public repository so a fix is one release that every
host picks up, and anyone can file one.

- Everything the host had: the Firestore artifact store with version history, the route factory
  (`createArtifactRoutes`), the read-along reader, brand packs with `freedomDefault`, password
  pages, confidential pages (`access: freedom | invite`) with the readers store, the agreement,
  the watermark and the read record, and the share card.
- **Compiled ESM with declarations** (`lib/`), so a host no longer needs `transpilePackages`.
  Relative imports carry `.js`; `next/*` imports deliberately do NOT. `next/navigation.js` skips
  the alias Next applies per layer, and every route handler then fails to build on a missing
  app-router context module. Plain Node ESM cannot resolve the extensionless form, so a host's
  Vitest inlines the package (README).
- **No sign-in service is assumed.** `signInOrigin` used to default to one company's sign-in
  host. It now has no default, and a confidential page on a host that sets none shows its door
  with no way through: it fails closed rather than sending readers somewhere the host never named.
- **The share-card font ships in the tarball** at `fonts/Newsreader-600.ttf` and is found from a
  host's `node_modules`, where it used to be read from the host's own source tree. Next's tracer
  does not follow it there, so a host names it in `outputFileTracingIncludes` under a key that is
  a glob (`'/*/share.png'`; `'/[id]/share.png'` is a character class and matches nothing).
- **DETECTOR:** a host importing `@freedom/site-shell` is on the pre-package copy.
- **REMEDY:** depend on `@supersuit/artifacts`, rename the imports, drop the package from
  `transpilePackages`, point Tailwind `content` and any `outputFileTracingIncludes` for the font
  at `node_modules/@supersuit/artifacts/`, inline the package in Vitest, and pass `signInOrigin`
  explicitly if the host serves confidential pages.
- 92 tests, including one for the fail-closed door, plus `npm run test:packed`, which packs the
  tarball into a small Next.js app (`test/fixture`), builds it, checks the share route's trace
  carries the font, then serves it and fetches a page, a share card and the publish route. It was
  verified to fail on a `next/navigation.js` import and on a tarball without `fonts/`.
