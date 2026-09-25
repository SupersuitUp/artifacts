# Changelog

`@supersuit/artifacts`. One entry per version, newest first. Each entry says what changed, how a
host can tell whether it is affected (DETECTOR), what a host does about it (REMEDY), and the tests.

## 0.2.0 (2026-09-24)

**Reader answers.** A page can now take input from the people reading it. It declares named
slots under `state:` in its front matter, and readers' answers are kept per reader, beside the
pages, and handed back to the publisher. Nothing renders an answer UI yet: widgets (poll, form,
checklist, notes) and HTML pages are the next releases, and they are the first callers.

- `state:` in front matter: `writers` (`signed-in`, default, or `anyone`), `visibility`
  (`private`, default, `tally` or `shared`), and `slots` of shape `one` (one value per reader,
  replaced) or `many` (an append-only list per reader). A write to an undeclared slot is refused.
- Routes: `GET`/`POST /api/artifacts/<id>/state` for the reader, `GET`/`DELETE
  /api/artifacts/<id>/responses` for the publisher (publish key; JSON or `?format=csv`).
- A reader never receives an email or another reader's key. Shared `one` entries carry an
  opaque id. Tallies count signed-in and anonymous answers apart, because anyone can answer
  again by clearing a cookie. The publisher's CSV escapes cells a spreadsheet would run.
- Anonymous writers (on `writers: anyone` pages) get an HttpOnly `artifact_anon` cookie, limited
  to 30 writes a minute per page per client; their answers move to them when they sign in, on
  every page. A gated page (`access:`) always requires a signed-in reader the page is open to
  who has accepted the agreement. A password page needs its unlock cookie, which is now also
  set for the page's answer API.
- Limits: 8 KB per value, 16 KB per request, 200 `many` entries per reader per slot, 2000
  answers per slot per page, the newest 100 shared entries returned. Cross-origin posts refused.
- Republishing keeps answers; changing a slot's shape is refused (against the previous file and
  against stored answers). Adding and removing slots is allowed.
- **DETECTOR:** a page with `state:` published to a host without a state store gets
  `warning: this host keeps no answers` in the publish response, and its readers get 501.
- **REMEDY (hosts):** pass `state: createStateStore(db, '<base>')` to `createArtifactRoutes`,
  add `app/api/artifacts/[id]/state/route.ts` (GET, POST to `STATE_GET`/`STATE_POST`) and
  `app/api/artifacts/[id]/responses/route.ts` (GET, DELETE to `RESPONSES`), set a Firestore TTL
  policy on `expireAt` in `<base>StateRate`, and pass `clientIp` when not on Vercel. README,
  "Reader answers".
- **Known, fixed next release:** a reader who unlocked a password page before this version holds
  only the page's cookie and must reopen the `?key=` link before answering there.
- **Tests:** `state.test.ts`, `state-store.test.ts` (memory contract), `state-view.test.ts`,
  `routes/state.test.tsx`, and the packed fixture's anonymous answer round trip (`npm run
  test:packed`). The Firestore store has no emulator test; it is proven on a live host.

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
