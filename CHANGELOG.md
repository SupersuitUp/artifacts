# Changelog

`@supersuit/artifacts`. One entry per version, newest first. Each entry says what changed, how a
host can tell whether it is affected (DETECTOR), what a host does about it (REMEDY), and the tests.

## 0.17.0 (2026-09-29)

**A host can accept a signed, hour-long publisher pass wherever it accepts the publish key.** A
shared key cannot be self-served and cannot be revoked for one person without rotating it for
everyone. New routes config `publisherSecret` and `publisherHost`: when both are set, every
publish-key route (publish, read, delete, versions, access, reads, assets, upload, responses, the
comments feed) also accepts `Authorization: Bearer p1.<payload>.<sig>`, a pass naming one person
and this host, signed with the reader pass's HMAC scheme under its own domain
(`artifact-publisher`). New exports `mintPublisherPass`, `verifyPublisherPass`,
`PUBLISHER_PASS_TTL_SECONDS` (3600), `isPublisherAuthed`. `isPublishAuthed` is unchanged.

- DETECTOR: none needed. A host that sets neither field refuses every pass and takes its key
  exactly as on 0.16.0.
- REMEDY: nothing, unless you want admins to publish without the key: set both fields, and have
  your sign-in side mint passes for the people it vouches for.
- Tests: the pass vector pinned byte for byte; a valid pass for the right host gets exactly what
  the key gets on every publish-key handler; wrong host, expired, bad signature, a reader pass
  (`a1`) and a grant (`g1`) are refused on every handler; a `p1` pass never verifies as a reader
  pass or grant; a host missing either field refuses a pass and still takes its key. Broken on
  purpose twice and failed: the host check removed (11 failures), and the comments feed left on
  the bare key check (its pass case failed).

## 0.16.0 (2026-09-29)

**A brand pack can draw a page's structure, and one page can wear a pack of its own.** Four new
optional `BrandPack` fields: `Cover` (the title block), `Article` (what holds the cover and body),
`Section` (each top-level section, with its index, count and the outline, for a break before it
or a wrapper around it) and `figure(src, alt)` (a component in place of an image or embed). New
routes config `packs` (by name) and `packFor(artifact)`, and front matter `pack: <name>`.

- DETECTOR: none needed. A pack that uses none of the new fields renders exactly as on 0.15.0,
  pinned by a golden rendered from 0.15.0 itself (`src/routes/__golden__`).
- REMEDY: nothing, unless you want a page drawn differently: set the fields on a pack of your
  own and register it with `packs` or choose it with `packFor`.
- Tests: the golden (default and wrapped packs, current page and a past version); each extension
  point; a claimed image replacing its paragraph and an unclaimed one untouched; `pack:` by name,
  an unknown name, `packFor` ahead of front matter, other pages untouched, the share card following
  the page's pack; `pack:` parse and refusals and the store round trip; and the read-along: a page
  rendered through all four has exactly the narrated words. Each was broken on purpose once and
  failed (figure left speakable, sections not split, cover and article ignored, `packFor` and
  `pack:` ignored, `pack` not cleared on republish).

## 0.15.0 (2026-09-29)

**A reader signed in with the wrong Google account can change it.** Before, "Sign out" only
cleared this host's grant; the sign-in authority still held the Google session and vouched for
the same account again, so the reader looped back as the wrong person. Now:

- `GET /api/reader/leave?to=/<id>&switch=1` clears the grant and redirects to
  `<signInOrigin>/artifact/sign-in?to=<page>&switch=1`. Without `switch` it still lands on the page.
- `signInUrl(origin, page, { switchAccount: true })` builds that URL.
- The refusal door, the agreement and the confidential banner say "Use a different account" and
  link to the switch.
- An open page now shows a signed-in reader "Signed in as <email> · Use a different account ·
  Sign out" under the version line (not spoken). Before, it showed nothing at all.

- DETECTOR: a reader on a page of yours reports they cannot switch Google accounts.
- REMEDY: bump, AND make the host's `/artifact/sign-in` honor `switch=1` by signing its Firebase
  user out before vouching (and ask Google with `prompt: 'select_account'`). A host whose sign-in
  ignores `switch` still loops.
- Tests: the switch URL, LEAVE with and without switch (grant cleared, redirect, off-host `to`
  refused), the three gated surfaces linking the switch, the open-page reader line present when
  signed in and absent when not.

## 0.14.0 (2026-09-28)

**A page can say who it is for.** `to: Isaiah` in front matter reads "For Isaiah" in three
places: after the kicker on the page (not spoken), in the link preview's title ("For Isaiah:
<title>", og:title, twitter:title and <title>), and as a line above the title on the share card.
1 to 60 characters, one line; a republish without it clears it. Past versions keep the name they
were published with. `audience:` is unchanged: stored, never shown.

- DETECTOR: a page with `to:` whose preview does not name the reader.
- REMEDY: bump; publishers must forward `to`.
- Tests: parse and refusals, store round trip and clear-on-omit, the kicker on open, password,
  gated and version pages, the three metadata titles, the share card markup and PNG, narration
  leaving the name out. Metadata title, share card prop and clear-on-omit mutation-checked.

## 0.13.0 (2026-09-28)

**A publisher can hear about new comments, and every comment has a link to itself.**

- `COMMENTS_FEED`: `GET /api/comments?since=<ISO with zone>`, publish key only. Shared comments
  across the tenant's pages, oldest first, at most 200, `at > since`: `{ now, comments: [{
  artifactId, title, entryId, parent, name, quote, region, body, transcript, audioUrl, at, link }] }`.
  `name` null means an anonymous reader. Personal notes never appear (the privacy test calls it).
  Comments on deleted pages are left out. Callers keep the last row's `at` as their cursor and
  use `now` only on a first run.
- Deep link: `/<id>#comment-<entryId>` scrolls to the comment and opens its thread, on load and
  on `hashchange`; a reply opens its parent's thread; an earlier-versions comment is highlighted.
- New optional `StateStore.slotSince(slot, after, limit)`; a store without it answers 501.
- DETECTOR: a host with no `/api/comments` route.
- REMEDY: bump; add `app/api/comments/route.ts` delegating GET to `COMMENTS_FEED`; create the
  Firestore composite index on `<base>State` (collection scope): `slot` ascending, `at` ascending.
- Tests: `comments-feed.test.tsx`, five deep-link tests, the privacy test, and the packed
  fixture reading a comment back through the feed. Since-exclusivity, the slot filter, the
  personal-note exclusion, reply-to-parent and the hashchange listener are mutation-checked.

## 0.12.1 (2026-09-28)

**Tapping into a comment box no longer zooms the page on iPhone.** iOS Safari zooms the page
when a text field under 16px takes focus, and leaves it zoomed. The comment card, the thread
reply box and the notes widget are 16px now (`NO_ZOOM_FONT`). Pinch-zoom is untouched.

- DETECTOR: on an iPhone, tapping the comment box zooms the page in.
- REMEDY: bump.
- Tests: `no-zoom.test.ts` scans every text field the reader and widgets draw, so a new field
  without the size fails the suite (mutation-checked).

## 0.12.0 (2026-09-28)

**Say a comment instead of typing it.** The comment card has a microphone. While you speak, a
browser with speech recognition (Chrome, Edge, Safari) fills the box live; when you stop, a host
that configured transcription replaces it with a better transcript unless you already edited it.
With neither, the recording is kept and the box stays yours to type in. Memos cap at 3 minutes.
The recording travels with the comment and plays back from the pin, the thread and `/responses`.

- Host config: `transcribe?: Transcriber`, with `deepgramTranscriber(key)` (Nova-3) and
  `openaiTranscriber(key, model?)` from `./artifacts`. The key never reaches the browser and never
  appears in an error.
- New handler `TRANSCRIBE` (`POST /api/artifacts/<id>/transcribe`): 404 when the host passed no
  transcriber, so the reader falls back to the browser; only readers who may write comments, or
  signed-in readers on their own notes; 20 per reader per page per hour.
- Recordings upload through the existing `UPLOAD` route with a signed PUT (`audio` in the body),
  under `comments/` or `personal/<hashed reader>/`; a comment may only name a `comments/` path and
  a note only its own reader's. Playback is by signed URL (`audioUrl` on rows). Reader audio has
  its own allowlist (webm, m4a, mp3, ogg; iPhone `audio/mp4` is stored as `.m4a`).
- Anonymous personal memos stay in the browser (IndexedDB) and move to the account on sign-in.
- The privacy test now covers personal audio: no publisher route returns it or its URL.
- DETECTOR: a comment card with no microphone.
- REMEDY: bump; add `app/api/artifacts/[id]/transcribe/route.ts` delegating to `TRANSCRIBE`;
  pass `transcribe` to get server transcripts; the bucket's CORS must allow `PUT` from the site
  origin with `content-type`, `cache-control` and `x-goog-content-length-range`.
- Tests: adapters against a stubbed fetch, the transcribe route (404, rate limit, refusal),
  upload path guards, the recorder (live transcript, host transcript vs an edited box, no-support
  path, the 3-minute cap, device-only memos), the extended privacy test. All key rules
  mutation-checked.

## 0.11.1 (2026-09-28)

**The comment controls draw in the page's colours.** The comment overlay is portalled onto
`document.body`, outside the wrapper that sets the `--a-*` theme variables, so on a dark page the
Comment chip and the Comment button rendered black text on the dark ground. The overlay now
carries the variables it finds around the page root (`themeVarsAround`), re-read when a `system`
page changes scheme.

- DETECTOR: on a dark page, the Comment button bottom right is hard to read.
- REMEDY: bump.
- Tests: `comment-layer.test.tsx` pins the variables on the portalled overlay (mutation-checked).

## 0.11.0 (2026-09-28)

**Comment on any part of a page.** Select text, or drag a box over anything that is not text
(an image, a table, a heading), and a comment card opens pinned to that spot. Pins sit in the
margin; a toggle hides them. Threads take one level of replies.

- **Shared comments** are per page: `comments: anyone | signed-in | off` (default `off`) and
  `comments_visible: owner | readers` (default `owner`). They ride the state core as a `many`
  slot named `comments`, so caps, rate limits, CSRF, sign-in migration and the agreement gate on
  confidential pages apply unchanged. A gated page forces `signed-in`. The owner, signed in with
  `ownerEmail`, sees every comment with names on the page; `/responses` returns them.
- **Personal notes** work on every page, for every reader. When a reader cannot share, the card
  says before they type: "Only you will see this. <owner> has not opened this page to comments,
  so this is a personal note. They won't see it." Signed-in readers' notes are stored in a new
  store no publisher route reads; anonymous readers' notes never leave the device.
- **Anchors survive a republish**: text by quote plus 32 characters of context, regions by a
  content-hashed block id (`data-block` on every rendered block) and fractions of that block.
  A comment whose spot is gone is listed under "Comments on earlier versions".
- State API: `op: replace` edits your own entry (optional `StateStore.replace`; a store without
  it answers 501); deleting someone else's comment answers 404. Slots gained an internal
  per-slot `writers` so `comments: anyone` can sit beside signed-in-only answers.
- DETECTOR: a host on 0.10.x.
- REMEDY: bump; pass `personal: createPersonalStore(db, base)`, `ownerEmail`, and add
  `app/api/artifacts/[id]/personal/route.ts` delegating to `PERSONAL_GET`, `PERSONAL_POST`,
  `PERSONAL_DELETE`. Without `personal`, signed-in readers' notes stay on their device.
- Tests: anchors (re-find after insertions, duplicates and deletions; block ids stable across
  unrelated edits), comment validation, replies, owner view, `comments: off` refusing a write with
  the UI bypassed, the comment layer and card (the warning line, the share switch, device notes,
  pins, the earlier-versions list), and `personal-privacy.test.tsx`, which calls every handler the
  factory returns as publisher, owner and nobody and fails if any of them returns a personal note.
  The packed fixture posts a comment and reads it back through `/responses`.

## 0.10.0 (2026-09-28)

**Every page can be read aloud.** A page with no recorded narration, or whose timings will not
load, now shows the same player bar and reads itself with the browser's own voice
(`speechSynthesis`), lighting each word from the engine's word-boundary events. It speaks one
sentence at a time, so a drifting engine (Safari on long passages) re-syncs at every sentence.
Clicking a word starts reading there. Browsers without speech synthesis show no bar, as before.
Pages with recorded narration are unchanged.

- New exports from `./reader`: `BrowserReader`, `PlayerBar`, `planSentences`, `wordAt`,
  `sentenceOf`, `fromWord`. `./reader` is now a barrel (`src/reader/index.ts`); everything
  importable before still is.
- `wrapWords` is idempotent, so two readers can never wrap a page twice.
- DETECTOR: an un-narrated page with no player bar.
- REMEDY: bump; nothing to republish.
- Tests: `speech-plan.test.ts` (sentence plan, 60-word cap, block starts, boundary mapping),
  `browser-reader.test.tsx` against a stubbed `speechSynthesis`, route tests for which reader
  mounts, and the packed fixture's un-narrated page mounting the browser reader.

## 0.9.0 (2026-09-27)

**A host can word its own sign-in door.** `signInNote` on `createArtifactRoutes` replaces the
door's line on a gated page. The default still names the Freedom account, so every host that
passes nothing reads exactly as before. A host that signs readers in itself, rather than through
a Freedom account, needs the door to say so, or readers are told to use an account they do not
have.

- DETECTOR: a host whose `signInOrigin` is not a Freedom account service, and whose door still
  says "your Freedom account".
- REMEDY: bump and pass `signInNote`.
- Tests: `gated.test.tsx` pins the default line and a host's own line replacing it.

## 0.8.0 (2026-09-27)

**Pages play audio clips.** `![caption](clip.mp3)` renders a captioned player with native
controls, the way `![alt](x.mp4)` already renders a video. An annotated conversation, a voice
note, or a quote meant to be heard can now sit in the prose it belongs to, instead of on a
second page or a download link. mp3 was already an accepted asset type; nothing rendered it.

- `preload="none"`, never `autoplay`: a page of twenty clips fetches nothing until one is pressed.
- The alt is the clip's caption, shown above the player and escaped as text.
- DETECTOR: a page with an `.mp3` in image syntax that renders a broken image.
- REMEDY: bump; republishing is not needed, the markdown is rendered on request.
- Tests: `render.test.tsx` pins the audio element, its attributes, the caption and the escaping.

## 0.7.1 (2026-09-27)

**The narrator reads the subtitle.** `narrationText` built the spoken text from the title, the
summary and the body, while the page renders a `subtitle:` between the title and the summary with
no `data-nospeak`. So the audio skipped the page's first line under the title, and the highlighter
expected words the narration never said.

- `narrationText` takes an optional `subtitle` and reads it second; the narration-text route
  passes it.
- DETECTOR: a page with a `subtitle:` whose audio goes straight from the title to the summary.
- REMEDY: bump, then republish the page so its narration is regenerated (the spoken text changed,
  so the narration hash no longer matches and the publisher re-narrates).
- Tests: `narration.test.ts` pins title, subtitle, summary, body order.

## 0.7.0 (2026-09-27)

**A real version history: every page names its version, lists every version with its change note,
and serves each past version at its own URL.**

- The line under the summary reads "Version N · Updated <minute> · History". History opens a
  panel (`VersionHistory`, a client component) drawn through a portal on `document.body` like the
  definition layer, so it never reflows the page: a bottom sheet above the narration bar on a
  phone, a side panel on a desk. Each row is the version number, the exact minute in the reader's
  zone, and the note. Authors were hand-writing "Version history" sections at the end of their
  markdown; the store already kept every version, so the page now shows them.
- Past versions render read-only at `/<id>/v/<n>` (`VersionPage`, `generateVersionMetadata`) under
  a banner, "You are reading version N of M", linking the current page. Same password and
  confidential gate as the page, looked up only after the gate opens; no narration, no answers,
  no view counted. The current number redirects to the page; anything else missing is a 404.
- A change note travels with each version: `?note=` on the publish POST or `change:` in the
  front matter. None given, none stored. A note identical to the one it replaces is dropped as a
  stale front matter line.
- `?amend=1` finishes the same publish, so a publisher's image and narration POSTs no longer mint
  two or three versions per publish; a republish with an unchanged body and no note is not a new
  version either. History docs now keep the title, subtitle and summary they were published with.
- New store methods `history`, `version`, `setNote` (optional on the interface); new route
  `VERSIONS` (`GET` lists, `POST {version, note}` backfills a note); `safeReturnPath` accepts
  `/<id>/v/<n>` so signing in from a past version returns to it.
- **DETECTOR:** a page whose line under the summary has no "Version N", or a markdown file ending
  in a hand-written "Version history" section. A host with no `app/[id]/v/[n]/page.tsx` 404s
  every History link.
- **REMEDY:** take 0.7.0, and add two route files: `app/[id]/v/[n]/page.tsx` (default
  `VersionPage`, `generateMetadata` = `generateVersionMetadata`) and
  `app/api/artifacts/[id]/versions/route.ts` (`GET`, `POST` = `VERSIONS`). Publishers pass
  `note=` on the first POST and `amend=1` on the ones that follow it.
- **Tests:** `store.test.ts` (notes ride and move to history, none invented, stale note dropped,
  unchanged body and amend make no version, listing without bodies, one version, legacy array,
  backfill), `versions.test.tsx` (header line, banner, no narration or view, redirect, 404s, gate
  parity for password and confidential pages case by case, no history leaked through a door,
  sign-in returns to the version, the API, note and amend reach the store),
  `version-history.test.tsx` (portal on body, no text change, rows and links, close paths),
  `reader.test.ts` (return paths), `front-matter.test.ts` (`change:`). Mutation-checked: removing
  the gate for versions fails four parity tests; dropping the stale-note rule and the current
  redirect each fail their test.

## 0.6.0 (2026-09-27)

**"Updated" names the exact minute, in the reader's own time zone.**

- The line under an artifact's summary read "Updated September 27, 2026", so a page republished
  three times in one evening looked the same each time. It now reads "Updated September 27, 2026
  at 8:07 AM CDT": the server renders UTC, and a small client component, `UpdatedTime`, swaps in
  the viewer's zone once the page runs. The value is a `<time dateTime>` carrying the ISO stamp.
- New `formatUpdated(iso, timeZone?)` in `src/artifacts/updated-at.ts`; a bad value renders
  nothing rather than an invented time.
- DETECTOR: an artifact page whose "Updated" line has no clock time.
- REMEDY: take 0.6.0; nothing to configure.
- Tests: `updated-at.test.ts` (exact minute and zone, UTC default, bad input), verified red with
  the minute removed.

## 0.5.0 (2026-09-27)

**Inline definitions: a page can define its jargon, and a reader sees it in line.**

- New front matter key `definitions:`, a list of `Term | definition | optional link` (or a map).
  The first occurrence of each term in the prose renders with a dotted underline; hover (desk) or
  tap (phone) opens the definition, drawn by a new client component, `DefinitionLayer`, through a
  portal on `document.body`, so nothing in the paragraph opens or closes and nothing reflows. The
  store keeps the terms and a republish without the key removes them.
- The read-along reader skips `<style>` and `<script>` text (it used to wrap any text node, which
  would have turned an inline stylesheet into word spans) and a click on a defined term no longer
  seeks. Its bar carries `data-artifact-player` so an overlay can sit above it.
- Punctuation that continues a word across an element edge (`Edge` in a term, then `, which`;
  `**bold**,`) is wrapped as a tail of that word rather than a word of its own, so the
  highlighter's word sequence matches the narration's tokens. Found in WebKit, where a comma after
  a defined term had become an extra, clickable word.
- **DETECTOR:** a page with `definitions:` is refused as an unknown key before 0.5.0.
- **REMEDY:** update the dependency; no host change. A publisher that filters keys must pass
  `definitions` through.
- **Tests:** parsing both shapes and refusals; first occurrence only, whole words, case rules and
  every skipped context; the karaoke word spans are identical in number and order with and without
  definitions and equal the narrated words; a tap on a defined word is not a seek; the definition
  opens on `document.body` with the paragraph's markup unchanged, and closes on a second tap,
  Escape or a tap elsewhere; the store round-trips and clears the key.

## 0.4.7 (2026-09-27)

**A page of videos opens as fast as a page of text.**

- 0.4.6 marked every inline video `autoplay`, so all of them downloaded the moment the page opened
  (21 diagrams, 6.8 MB, competing with the text and narration on a phone). The markup now carries
  `preload="metadata"` and `data-artifact-video` instead, and a small client component,
  `VideoAutoplay`, mounted only on pages that embed an `.mp4`, loads and plays each video as it
  comes within a screen of view and pauses it when it leaves.
- **DETECTOR:** a page with many inline videos is slow to become readable on cellular.
- **REMEDY:** update the dependency; no host change.
- **Tests:** the markup no longer autoplays and preloads only metadata; `VideoAutoplay` plays a
  video only once it intersects, raises its preload, and pauses it when it leaves.

## 0.4.6 (2026-09-27)

**Pages play video: `![alt](x.mp4)` is a silent, looping, autoplaying inline video.**

- Animated WebP is decoded frame by frame on the CPU and stuttered on an iPhone at 24fps; video
  is decoded in hardware. Image syntax pointing at an `.mp4` now renders
  `<video autoplay muted loop playsinline>` with the alt text as its `aria-label`, in the same
  rounded frame an image gets. It is written as markup because React leaves `muted` out of
  server HTML, and iOS will not autoplay a video whose markup is not muted.
- `mp4` (`video/mp4`) joins the allowed asset types for `PUT_ASSET` and `UPLOAD`.
- **DETECTOR:** a published `.mp4` renders as a broken image, or its upload answers 415.
- **REMEDY:** update the dependency; no host change.
- **Tests:** an `.mp4` renders a muted, looping, inline, autoplaying video labelled by its alt
  text and a `.png` still renders an image; `d.mp4` maps to `video/mp4`.

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
