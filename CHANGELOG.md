# Changelog

`@supersuit/artifacts`. One entry per version, newest first. Each entry says what changed, how a
host can tell whether it is affected (DETECTOR), what a host does about it (REMEDY), and the tests.

## 0.4.5 (2026-09-27)

**The bubble ground looks as it did in 0.4.2, and stays smooth.**

- The palette and layout changes of 0.4.3 and 0.4.4 are reverted: the six original pastels, the
  original stacking and gradient. What stays is the performance fix, done differently: each bubble
  carries its own `filter: blur(40px)` on its own layer (`will-change: transform`), so it is
  rasterised once and slid, instead of one blur over the whole screen re-rasterised every frame.
  The hard-light blend stays off; side by side the render is indistinguishable.
- **DETECTOR:** the ground shows saturated magenta, teal or pink bubbles (0.4.3/0.4.4).
- **REMEDY:** update the dependency.
- **Tests:** the blur sits on the bubble, never on a full-screen wrapper; no blend; one bubble per
  default colour.

## 0.4.4 (2026-09-26)

**The glow stays on the cool-to-magenta arc.**

- 0.4.3's nine colours included coral, amber and lime, which put the warm half of the spectrum on
  the page and read as a rainbow. `GLOW_PASTELS` is now brand blue, magenta, teal, purple, pink,
  cyan, violet, sky and lavender: as many colours, none of them red, orange, yellow or green.
- **DETECTOR:** the animated ground shows orange, yellow or green.
- **REMEDY:** update the dependency. A pack that passes its own `backdrop.colors` keeps them.
- **Tests:** every default colour's hue sits between cyan and pink.

## 0.4.3 (2026-09-26)

**The bubble ground runs smooth on a phone, and the glow runs the whole spectrum.**

- The backdrop blurred the whole viewport (`filter: blur(40px)`) and hard-light blended every
  bubble, so each frame re-rasterised the full screen and stuttered on a phone. Both are gone:
  only `transform` animates, on its own layer (`will-change`, `translate3d`). The softness now
  comes from the gradient itself (`closest-side`, fading to zero inside the bubble), which also
  stops the gradients showing hard edges without the blur.
- `GLOW_PASTELS` grows from six washed pastels to nine saturated hues (blue, violet, magenta,
  rose, coral, amber, lime, mint, cyan), one bubble each, spread over the page so neighbours
  overlap at their edges instead of averaging to grey in the middle.
- **DETECTOR:** the animated ground stutters on a phone, or reads as grey-beige rather than colour.
- **REMEDY:** update the dependency. A pack that passes its own `backdrop.colors` keeps them.
- **Tests:** no full-screen blur or blend in the backdrop and `will-change:transform` present; the
  default palette has at least nine colours and renders one bubble per colour.

## 0.4.2 (2026-09-26)

**The read-along highlight waits for play.**

- The first word's timing starts at 0, so an untouched page sat with its first word lit before
  anything played. `ArtifactReader` now lights nothing until the first play or seek. The word
  choice is exported as `litWordIndex(words, now, started)`.
- **DETECTOR:** a narrated page shows its first word highlighted at 0:00 before play.
- **REMEDY:** update the dependency; no host change.
- **Tests:** nothing lit before start; the word under the playhead once started; nothing in a
  gap after a word ends.

## 0.4.1 (2026-09-26)

**Big files upload straight to the bucket.**

- A route handler on Vercel refuses a body over 4.5 MB (`FUNCTION_PAYLOAD_TOO_LARGE`), about five
  minutes of narration, so a long page's audio could never publish; `PUT_ASSET`'s own 16 MiB cap
  was never reached. New route `UPLOAD` (`POST /api/artifacts/<id>/uploads/<name>`, publish key,
  JSON `{ digest }`) returns a v4 signed URL and the headers to send; the publisher PUTs the bytes
  there, then calls again with `{ digest, done: true }`, which makes the object readable and
  returns its URL (409 if nothing arrived). The key is the same hashed name `put()` writes, with
  the same `immutable` cache header. `ArtifactAssets` gains optional `signUpload` and
  `finishUpload`; `createArtifactAssets` implements both. `storedName`, `hashedName` and
  `ASSET_DIGEST` are exported.
- **DETECTOR:** publishing a page whose narration is longer than about five minutes fails with
  `narration upload failed 413: ... FUNCTION_PAYLOAD_TOO_LARGE`.
- **REMEDY:** add `app/api/artifacts/[id]/uploads/[name]/route.ts` exporting `POST` that calls
  the routes' `UPLOAD`, the same shape as the assets route. The bucket's service account needs no
  new permission when the host signs with a service-account key. Until the route exists the
  publisher gets a 404 and falls back to `PUT_ASSET`.
- **Tests:** signing targets put()'s key with its cache header; finishing refuses a missing
  object; the route's refusals match `PUT_ASSET`'s, a bad digest is 400, and a host whose assets
  cannot sign answers 501.

## 0.4.0 (2026-09-26)

**Light and dark modes, a table of contents, and an animated ground.**

- **Modes.** `BrandPack` gains `light` (a second palette), `mode` (`light`, `dark` or `system`,
  default `dark`) and `backdrop`. A page may override the mode with `theme:` in its front matter.
  Every colour the page draws is now a CSS variable set by `BrandGround` for the mode, so `system`
  follows the reader's device. `freedomDefault` carries a light palette.
- **Table of contents.** Built from the page's `##` headings: a sticky rail in the left margin at
  `xl` widths, highlighting the section being read, and a closed "Contents" list above the body
  below that. Both are `data-nospeak`. It appears once a page has four sections; `toc: false`
  removes it and `toc: true` draws it from one. Every heading now carries its slug as an `id`,
  with or without the notes widget.
- **Bubbles.** `backdrop: { kind: 'bubbles' }` draws drifting colour behind the page in plain CSS,
  held still under `prefers-reduced-motion`. A pack with its own `Wrapper` draws its own ground
  and ignores `backdrop`.
- **Long words wrap.** The body is `break-words`, so a bare URL in prose no longer pushes a phone
  sideways (a 390px screen scrolled 7px on the first page checked).
- **DETECTOR:** a page's root carries `data-artifact-theme`; an open page with four sections
  carries `data-artifact-toc`. A host whose pages still show zinc-on-black text in a light mode is
  building from a Tailwind `content` list that does not scan this package's `lib/`.
- **REMEDY:** none required. A pack with no `mode` keeps its dark look, and `theme`/`toc` are new
  optional keys. A host whose publisher strips unknown front matter keys must forward `theme` and
  `toc` for pages to set them.
- **Tests:** theme CSS per mode and the fallback light palette; the ground, the wrapper-pack path
  and the backdrop; `theme` and `toc` parsed, refused, stored and cleared on republish; heading ids
  without notes; the route's mode and both contents placements.

## 0.3.0 (2026-09-25)

**Notes, the first widget.** A ```` ```notes ```` block in a page puts a small "note" control
beside every heading, so readers can leave notes on a section and, on a `shared` page, read each
other's. Poll, form and checklist follow in a later release.

- **Fence:** ```` ```notes ```` with an optional `visibility: private | shared` line. At most one
  per page. It declares slot `notes` of shape `many` itself, merged into `state:` at parse time
  (a page with no `state:` gets `writers: signed-in`, `visibility: private`), so the 0.2.0 state
  API takes notes unchanged. Refused at publish with the file's line number: a second block, a
  name, an unknown key, `tally`, a `notes` slot declared `one`, a visibility that disagrees with
  `state:`. `poll`, `form` and `checklist` fences are refused until they ship.
- **A note is `{ slug, heading, note }`**, checked by the server on a page with a notes block.
  Headings carry their GitHub-style slug as an `id`; the renderer finds each heading by its source
  line, so the slug on the page and the slug a note stores come from one derivation.
- **A renamed or removed heading keeps its notes**, shown under "Notes on earlier versions" with
  the heading they were left under, never attached to another section.
- **Narration skips the widget**: the fence is not spoken and everything drawn is `data-nospeak`.
- **Password pages with `state:`** now set the answer API's unlock cookie on every open, not only
  on `?key=`. Readers who unlocked such a page before 0.2.0 are no longer refused (the item parked
  in 0.2.0).
- **The replace-at-cap check** reads one document (`StateStore.hasOne`, optional, implemented by
  both shipped stores) instead of every answer on the page.
- **DETECTOR:** a page with a notes block published to a host with no state store gets `warning:
  this host keeps no answers` and draws no controls. A notes page whose readers see no "note"
  button beside its headings is on 0.2.0 or earlier.
- **REMEDY (hosts):** take 0.3.0. No new routes: the notes widget uses the 0.2.0 state routes
  (`app/api/artifacts/[id]/state/route.ts`), which a host must already mount. A host with its own
  `StateStore` may add `hasOne`; without it the old full read is used.
- **Tests:** `widgets.test.ts` (slugs, fence parsing, one per page, reserved widgets, merge,
  note shape, placement), `front-matter.test.ts` (line numbers in the file, the first real page's
  front matter), `render.test.tsx` (controls beside headings, fence never drawn as code),
  `widgets/notes.test.tsx` (jsdom: shared notes under their heading, earlier versions, posting
  appends `{ slug, heading, note }`, sign-in offer, removal, no-store host), `narration.test.ts`,
  `state.test.tsx` (note shape refused, shared read, `hasOne` path), `artifacts.test.tsx` (API
  cookie on every open, page wiring, publish refusal), `state-store.test.ts` (`hasOne`), and the
  packed fixture (a notes page draws its controls, a note posts and reads back, a malformed one is
  refused, the compiled widget keeps `'use client'`).

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
