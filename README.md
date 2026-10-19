# @supersuit/artifacts

Publish a markdown file, get a branded page at a short link. `@supersuit/artifacts` is the whole
site shell behind that: the store, the route handlers, the read-along reader, brand packs,
password pages, confidential pages with a signed-in reader list, and the share card a link
unfurls as. You mount it in a Next.js App Router app with a handful of one-line route files.

It is the shell that serves every Supersuit operator's `artifacts.<theirname>` page, published
openly because none of it is secret and all of it is better with more eyes on it.

```bash
npm install @supersuit/artifacts
```

Peers: `next >= 16`, `react >= 19`, `react-dom >= 19`, `firebase-admin >= 13` (the store is
Firestore), and optionally `@google-cloud/storage >= 7` for uploaded files.

## What you get

| Export | What it is |
|---|---|
| `createArtifactRoutes(config)` | Every route handler: the page, its metadata, the publish API, the share card, the reader sign-in exchange, access control |
| `createArtifactStore(db, path)` | Firestore store for pages and their version history, under any collection path |
| `createReadersStore(db, path)` | The record for confidential pages: allowlist, agreements, reading sessions, flags |
| `createArtifactAssets(bucket, prefix, { privateBucket? })` | Uploaded images for a page, in a Cloud Storage bucket; private media in a separate private bucket |
| `freedomDefault`, `BrandPack` | The default look (Supersuit's, the Maison) and the type any other look implements |
| `BrandGround`, `BrandMark` | The pack's page backdrop and mark, for your own pages (a home, a 404) |
| `parseArtifactSource` | The front-matter contract, as a parser you can call before publishing (widget fences included) |
| `headingsOf`, `scanWidgets`, `placeNotes` | The notes widget's pure parts: heading slugs, fence validation, where each note shows |
| `checklistsOf`, `parseChecklistFence`, `checklistStorageKey`, `checklistAnswerIds`, `checklistSyncs` | The checklist widget's pure parts: the fence grammar, every item's id, where a tick is kept |
| `mintPass`, `verifyPass` | The reader pass, for the sign-in side (see below) |
| `mintPublisherPass`, `verifyPublisherPass` | The publisher pass: an hour-long stand-in for the publish key, for one person on one host (see below) |
| `ARTIFACT_PUBLIC_PREFIXES` (`/gate`) | Paths to leave open if you mount artifacts inside a gated site |

Subpath imports: `@supersuit/artifacts/artifacts`, `/routes`, `/brand`, `/reader`, `/gate`.
The package ships compiled ESM with type declarations; no `transpilePackages` needed.

## Mount it in a Next.js app

One module builds the routes; every route file is a one-line delegation.

```ts
// src/lib/artifacts.ts
import { createArtifactRoutes, createArtifactStore, createArtifactAssets, createReadersStore, freedomDefault } from '@supersuit/artifacts'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

export const artifacts = createArtifactRoutes({
  store: createArtifactStore(getFirestore(), 'artifacts'),
  assets: createArtifactAssets(getStorage().bucket(), 'artifacts'),   // optional
  brand: { ...freedomDefault, kicker: 'A page from Sam Rivera' },
  siteUrl: 'https://artifacts.example.com',
  publishKey: () => process.env.ARTIFACTS_PUBLISH_KEY,
  // Only for confidential pages (access:). Leave all three out and such a page stays shut.
  readers: createReadersStore(getFirestore(), 'artifact'),
  readerSecret: () => process.env.ARTIFACT_PASS_SECRET,
  signInOrigin: 'https://accounts.example.com',
})
```

```tsx
// app/[id]/page.tsx
import { artifacts } from '@/lib/artifacts'
export const dynamic = 'force-dynamic'
export const generateMetadata = artifacts.generateMetadata
export default artifacts.Page
```

The rest, each exporting the named handler(s) from `artifacts`:

| File | Handlers |
|---|---|
| `app/[id]/v/[n]/page.tsx` | `default` = `VersionPage`, `generateMetadata` = `generateVersionMetadata` |
| `app/[id]/share.png/route.tsx` | `GET` = `SHARE_IMAGE` |
| `app/api/artifacts/route.ts` | `POST` (publish) |
| `app/api/artifacts/[id]/route.ts` | `GET`, `DELETE` |
| `app/api/artifacts/[id]/assets/[name]/route.ts` | `PUT` = `PUT_ASSET` |
| `app/api/artifacts/[id]/access/route.ts` | `GET`, `POST` = `ACCESS` |
| `app/api/artifacts/[id]/settings/route.ts` | `GET`, `POST` = `SETTINGS` (see [Share settings and Comment settings](#share-settings-and-comment-settings)) |
| `app/api/artifacts/[id]/reads/route.ts` | `GET` = `READS` |
| `app/api/artifacts/[id]/versions/route.ts` | `GET`, `POST` = `VERSIONS` |
| `app/api/reader/enter/route.ts` | `GET` = `ENTER` |
| `app/api/reader/leave/route.ts` | `GET` = `LEAVE` |
| `app/api/reader/ack/route.ts` | `POST` = `ACK` |
| `app/api/reader/track/route.ts` | `POST` = `TRACK` |
| `app/api/artifacts/[id]/resolve/route.ts` | `POST` = `RESOLVE` (see [resolving a thread](#resolving-a-thread)) |
| `app/api/comments/route.ts` | `GET` = `COMMENTS_FEED` (see [the comments feed](#the-comments-feed)) |

Pages live at `/<id>` by default. Mounting inside a larger site, pass `pagePrefix: '/a/'` and put
the page at `app/a/[id]/`. One deployment can serve many sites: build one set of routes per
hostname and pick by the `host` header.

### Three things your build config must know

- **Tailwind**: the shell's markup uses Tailwind classes, so add the package to `content`:
  `'./node_modules/@supersuit/artifacts/lib/**/*.js'`.
- **The share-card font** ships at `node_modules/@supersuit/artifacts/fonts/` and is read from
  `process.cwd()` at request time. Next's file tracer does not follow that path into
  `node_modules`, so tell it, or the default pack's share card has no font in production:

  ```ts
  // next.config.ts
  outputFileTracingIncludes: { '/*/share.png': ['./node_modules/@supersuit/artifacts/fonts/**'] },
  ```

  The key is a glob. `'/[id]/share.png'` reads as a character class and matches nothing, silently.
- **Vitest** (or anything running the shell under plain Node ESM): the shell imports
  `next/navigation`, `next/server` and friends without a file extension, because that is the
  form Next's bundler aliases per layer (with `.js` every route handler fails to build). Plain
  Node cannot resolve that form, so let Vite resolve the package instead:
  `test: { server: { deps: { inline: ['@supersuit/artifacts'] } } }`.

## Publishing a page

`POST /api/artifacts` with `Authorization: Bearer <publish key>` and the markdown file as the
body. The response carries the page's id and URL. Posting a file whose front matter carries
that `id:` republishes it in place, keeping every earlier version.

**Taking a page down keeps its history (0.48.0).** `POST /api/artifacts?id=<id>&unpublish=1`
(publish key, empty body) takes the page off the web: every reader path answers 404, and the
record, every version, every comment and every file are kept. Republishing to that id puts it back
at the same link. `DELETE /api/artifacts/<id>` is the separate act that destroys all of it. A host
older than 0.48.0 answers the unpublish with a 400 and changes nothing, so a publisher can never
mistake it for a delete; a store without `setUnpublished` answers 501, likewise changing nothing.

## The page menu

Every page, past version and door carries one small round **⋯** button in the top right corner
(`aria-label="Page menu"`), the same on every host. Tapping it opens a short menu: a sheet from
the bottom on a phone, a popover under the button on a desk. A tap outside, Escape, or choosing an
item closes it. It paints with the page's own theme variables, so it follows the pack and the
light or dark mode.

The first line says who the reader is to this page, and the items depend on it. **An item a role
cannot use is absent, never greyed out.**

| Role | Role line | Items |
|---|---|---|
| Visitor (signed out) | Not signed in | Share, Show / Hide comments, Sign in |
| Reader (signed in) | Signed in as Dana | Share, Show / Hide comments, Sign out |
| Shut out (at a gated page's door) | Signed in as Dana · not on this page's list | Share, Sign out |
| Owner (`ownerEmail`) | Signed in as Robin · owner of this page | Share, Show / Hide comments, Share settings, Comment settings, Version history, Copy the markdown, Sign out |
| Admin (`admins`) | Signed in as Casey · admin of this hub | the owner's items |

- **Share** opens the phone's own share sheet where there is one, and otherwise copies the link and
  says "Link copied". Public and `access: freedom` pages show it to everyone; `access: invite` pages
  show it with the line "Only people on the list can open it."; a password page shows it to the
  owner and admins only, with the password in the link (`?key=`), since only they hold it.
- **Show / Hide comments** appears only where shared comments are on, and is the same switch as
  the comment panel's own toggle: moving either moves both.
- **Sign in** needs `signInOrigin` and returns to the exact address, hash included. **Sign out** is
  this host's `/api/reader/leave` (the `LEAVE` handler).
- **Version history** is for whoever `history` lets see past versions (the owner and admins by
  default) and opens the panel described below.
- **Copy the markdown** copies the page as published (an `id`, `title`, `summary`, `subtitle` and
  `to` front matter, then the body), ready to paste into a session and republish onto the same page.

The server decides every item and hands the browser only what this reader may use: the markdown
source, a share link carrying a password, and the version list are never in a page rendered for
anyone else. `PageMenu`, `roleLine` and `menuItems` are exported from `/reader`.

### Share settings and Comment settings

The owner and the hub's admins change a page's settings from the menu, with no republish. Each item
opens a sheet (from the bottom on a phone, under the button on a desk):

- **Share settings.** Who can open it: anyone with the link, any Supersuit account (plus the list),
  or only the list. The list itself: add or remove an email. On a page open to anyone, a password
  on or off (on makes a 12-character key). The link to send, with a Copy button: on a password page
  it carries the key. Under them, read-only lines: what a stranger with the bare URL sees and what
  search engines are told. A host that knows more (its robots.txt, who its sign-in admits) passes
  `shareFacts: (artifact) => [{ label, text }]`, whose rows replace those two.
- **Comment settings.** Who can comment (anyone, signed-in readers, nobody) and who can read the
  comments (the owner and admins, or every reader). A gated page takes comments only from
  signed-in readers it is open to, whatever is chosen; the sheet says so.

A save that changes how the page renders reloads it and reopens the sheet saying "Saved"; adding or
removing someone on the list changes nothing on the page and does not.

The sheets need a store with `setSettings` (`createArtifactStore` has it). The gated levels and the
list need `readers`; Comment settings need `state`. Without them those parts are absent.

Both talk to `GET|POST /api/artifacts/<id>/settings` (`SETTINGS`):

- **Who:** a reader whose grant names `ownerEmail` or one of `admins`. Signed out is 401, anyone
  else 403, before the page is looked up. The publish key is not accepted here.
- **CSRF:** a POST is refused (403) when its `Origin` is another site or `Sec-Fetch-Site` is not
  `same-origin`, and (415) unless it is `application/json`, which a cross-site form cannot send.
- **Body**, every field optional: `{ "access": "public"|"freedom"|"invite", "password": "on"|"off",
  "comments": "off"|"anyone"|"signed-in", "commentsVisible": "owner"|"readers", "add": [{ "email",
  "name"? }], "remove": ["email"] }`. Unknown fields and bad values are 400 and change nothing.
- **Answer:** the settings as the sheets show them.

**Settings changed on the page win.** The record keeps what the file said about `access:`,
`password:`, `comments:` and `comments_visible:` at its last publish (`declared`). A republish
changes one of them only when the file's line differs from what it said the time before: republish
the same file and an admin's change stands; edit the line and the file wins. Dropping a line counts
as a change for the password and comments (as before, it takes the password off and comments back to
off), and never for `access:`, which a file that names none leaves alone. A page last published
before 0.31.0 has no `declared` and takes its file on its next publish, as every publish did.

## Version history

Every page says when it was last updated under the summary, and to its admins that line also names
the version: "Version 4 · Updated <minute>". The page
menu's **Version history** opens a panel listing every version newest first: its number, the minute it went live in
the reader's own time zone, and its change note. The panel is drawn over the page (a sheet on a
phone, a side panel on a desk), so opening it moves no text. Each past version is readable at
`/<id>/v/<n>`, read-only, under a banner naming it and linking the current page, behind exactly
the same password or confidential door as the page itself. A version that does not exist is a
404; on a shut page the door comes first, so it never says which versions exist.

**Past versions are for admins by default (0.21.0).** An earlier draft can hold what the current
one was edited to remove, so only the page's admins see Version history in the page menu or open
`/<id>/v/<n>`: the reader signed in as `ownerEmail` or any address in `admins` (case does not
matter). A past version is a 404 to everyone else. With neither configured, nobody does.
`history: 'everyone'` in the config restores the old behaviour, where every reader who can open
the page reads its history.

**The version number goes with the history (0.41.0).** A page sent to someone reads as a message,
and "Version 9" on a message tells its reader about eight drafts. So whoever may not see past
versions sees only "Updated <minute>" under the summary; admins, and every reader under
`history: 'everyone'`, see "Version N · Updated <minute>". A pack's `Cover` is handed
`showVersion` alongside `version`, and draws the number itself only when it is true.

**One page can choose for itself (0.42.0).** `history: everyone` in a page's front matter shows
that page's readers the number, Version history and its past versions, on a host that keeps them
to admins; `history: admins` does the reverse on a host that shows everyone. Use `everyone` for a
document its readers follow from draft to draft (a spec, a plan, a paper under revision), and
leave the line out of anything that reads as a message to someone. It is content, like `toc:`: a
republish without the line goes back to the host's setting. A per-reader page serves no past
versions, so `history: everyone` is refused there.

```ts
createArtifactRoutes({ ..., ownerEmail: 'owner@example.com', admins: ['editor@example.com'] })
```

**Do not write a "Version history" section in the markdown.** Say what changed when you publish:

- `POST /api/artifacts?id=<id>&note=<one line>`, or a `change:` line in the front matter. The query
  wins. A note is one line, 280 characters at most.
- No note records the version with none. A `change:` still in the file from the previous publish
  is recognised as stale and not repeated on the next version.
- `&amend=1` finishes the publish the previous POST started (a publisher's second and third POSTs,
  carrying uploaded image URLs and then narration) instead of starting a new version. A republish
  whose body is unchanged and carries no note is not a new version either.
- `GET /api/artifacts/<id>/versions` lists the history; `POST` it `{ "version": 2, "note": "..." }`
  (or `"note": null`) to write a note onto a version after the fact.

## Front matter

```markdown
---
title: The Plan for Q4
subtitle: What we are doing and why
summary: Three bets, what each costs, and what we stop doing to afford them.
---
```

| Key | Meaning |
|---|---|
| `title` (required) | The large line, and the unfurl title |
| `summary` (required) | The italic teaser under it, and the unfurl description |
| `subtitle` | A line between the two. A republish without it removes it |
| `to` | Who the page is for, e.g. `to: Marisol`. Shows as "For Marisol" after the kicker, leads the unfurl title ("For Marisol: <title>") and gets its own line on the share card. Never read aloud, and not an access control. One line, 1 to 60 characters; a republish without it removes it |
| `audience` | Free text stored with the page, never shown |
| `id` | Republish in place instead of minting a new page |
| `cover` | An image URL (absolute or site-relative) used as the unfurl image instead of the share card |
| `voice`, `narration`, `timings`, `narrationHash` | Read-aloud: the audio and word timings a publisher generated (Kokoro by default, ElevenLabs on request). Absent, or the timings will not load, the page has no player: it is never read by the browser's own voice. `voice: none` turns audio off and removes any recording the page already had |
| `password` | Shuts the body behind a door (below) |
| `access` | `freedom`, `invite` or `public`: a confidential page (below) |
| `theme` | `light`, `dark` or `system` (follow the reader's device). Overrides the brand pack's mode for this page |
| `pack` | A brand pack the host registered by name (`packs` in the routes config). An unknown name renders in the host's default pack; a republish without the line goes back to it |
| `toc` | The table of contents. Absent, it appears once the page has four `##` sections; `false` never; `true` from one |
| `definitions` | Terms defined inline (below). A republish without it removes them |
| `links` | `per-reader`: the page opens only through a link made for one reader (see Per-reader links). Sticky: a republish whose file leaves the line out changes nothing |
| `media` | `private`: the page's body media is kept private and served through short-lived signed URLs. Needs `links: per-reader`. Sticky like `links` |
| `comment_name` | `required`: on a per-reader page, a comment through a group link needs a typed first name, and each browser on a group link is its own reader (see Per-reader links). Needs `links: per-reader` |
| `history` | `everyone` or `admins`: who sees this page's version number and past versions, overriding the host's `history` for this one page (see Version history). Absent, the host decides. Refused as `everyone` on a per-reader page |
| `change` | One line saying what this version changed (see Version history) |
| `template` | `document` (the default, the read-along reader) or `broadcast` (one message card sent to several people; see Broadcasts) |

An unknown key is refused, so a typo fails loudly instead of being ignored.

## Inline definitions (`definitions:`)

```yaml
definitions:
  - "Agentic Edge | The compounded context only you could have produced. | https://example.com/edge"
  - "harness | The agent loop that reads, writes and runs on your behalf."
```

Each entry is `Term | definition | optional https link`; a map (`Term: definition`, or
`Term: { text, href }`) is accepted too. The FIRST time each term appears in the prose it gets a
dotted underline: hovering on a desk or tapping on a phone opens the definition, Escape or a tap
elsewhere closes it. Matching is conservative: whole words, a capitalised term only as written, an
all-lowercase term also at a sentence start, longest term first, and never inside a heading, a
link, code, an image or a callout.

The definition is drawn on `document.body`, outside the text, so opening it never reflows the
page: a sheet at the bottom of a phone (above the narration bar), a box under the word on a desk.
Screen readers get it as the term's accessible description. Read-aloud is unaffected: the spoken
text comes from the markdown, the term's words stay ordinary words to the highlighter, and a tap
on a defined word opens its definition instead of seeking.

## A page with a password

`password: <string>` shuts the body behind a door. The title, summary and unfurl stay, so the
link still reads as itself in a thread. It opens on `?key=<password>` in the URL, or on the
cookie that first open sets, which holds a hash bound to the page id: it names no password and
opens no other page. Republishing without the line takes the door down. The owner and admins can
also turn it on or off from the page menu (Share settings); a republish of the same file leaves
their change alone.

## A confidential page (`access:`)

`access: freedom` opens the page only to a signed-in reader with an active Supersuit account or
on the page's list; `access: invite` opens it only to the list. Everyone else gets the title,
the summary and a sign-in door; the body never reaches them.

**The level is host-side state.** A republish that omits `access:` leaves it as it was; only
`access: public` (or `POST /api/artifacts/<id>/access` with `{"access":"public"}`) opens the page
again, so a publisher that strips keys can never reopen a confidential page by accident.

The list lives in the readers store, never in the file, so addresses stay out of content and
changing it needs no republish: `POST /api/artifacts/<id>/access` with
`{"add":[{"email":"...","name":"...","reason":"..."}],"remove":["..."]}` and the publish key.
`GET /api/artifacts/<id>/reads` returns who read it, for how long, and what they tried.

An allowed reader agrees to a short confidentiality statement before the body renders, once per
page; the wording is stored with their address and the time. The page then greets them by first
name, says why they can read it, tiles their address as a faint watermark, and records reading
time, scroll depth, and attempts to print, copy at length, or save. Refused sign-ins are
recorded too, which is how a forwarded link shows up.

### Knowing when it is read (`onReaderEvent`, `readAlertsDue`)

The record answers when asked; `onReaderEvent` is how a host hears that it changed. It is called
after a reading heartbeat is recorded (`kind: 'visit'`), after a signed-in person is refused at
the door (`'refused'`, with the account they tried), and for every listed reader when the host
calls `routes.sweepReaders()` from a daily job (`'sweep'`, so a host can notice a page nobody
opened). Each event carries the page (id, title, url), the reader, their totals (`summary`, or
null), their list entry (with `addedAt`), and the page's `words` and `readSeconds` at 230 words a
minute. It is awaited and anything it throws is swallowed, so a broken sink never costs a reader
their page. Without it nothing extra is read.

The package sends nothing anywhere. `readAlertsDue({ sent, email, summary, refusedAttempt,
readSeconds, now, addedAt, timeZone, ignore })` turns one event into the alerts worth sending,
each at most once per reader per page (pass back what you already sent):

| Kind | When |
| --- | --- |
| `first-open` | their first visit, within the last day |
| `refused` | a refusal at the door, with the account tried |
| `finished` | scrolled to 90% AND read for a third of the page's reading time |
| `came-back` | a visit that began on a later local day (in `timeZone`) than the first |
| `quiet` | listed 3 to 14 days ago and never opened |

Addresses in `ignore` (the publisher's own) never alert. Where an alert goes, and how a host
remembers what it sent, is the host's business.

### The reader pass (the contract with your sign-in side)

This package does not sign anyone in. It sends readers to your sign-in authority and trusts a
signed pass coming back:

1. A signed-out reader is sent to `<signInOrigin>/artifact/sign-in?to=<page URL>`.
2. Your side authenticates them and redirects to `<page origin>/api/reader/enter?pass=<pass>&to=/<id>`.
3. `ENTER` verifies the pass, sets a week-long HttpOnly grant cookie, and lands them on the page.

The pass is `a1.<payload>.<sig>`: `payload` is the base64url of
`{"u": uid, "e": email, "n": name|null, "m": isMember, "x": expiry-unix-seconds}`, and `sig` is
the first 32 hex characters of `HMAC-SHA256(ARTIFACT_PASS_SECRET, "artifact-pass:a1.<payload>")`.
`mintPass(secret, reader, exp)` builds one, so a Node sign-in side can import it rather than
reimplement it. Keep passes short-lived (five minutes is what the tests assume).

Without `signInOrigin`, a confidential page shows its door with no way through. It fails
closed, never open.

### The publisher pass (publishing without the shared key)

A shared publish key cannot be handed to one person and taken back from one person. A host can
also accept a **publisher pass** wherever it accepts the key: a signed, hour-long statement that
a named person may publish on that host, minted by an authority that knows who may.

```ts
createArtifactRoutes({
  // ...
  publisherSecret: () => process.env.ARTIFACT_PASS_SECRET, // shared with the minting side
  publisherHost: 'artifacts.example.com',                  // the host a pass must name
})
```

Both fields are optional; without either, passes are refused and only the key works. The pass is
`p1.<payload>.<sig>`: `payload` is the base64url of
`{"u": uid, "e": email, "n": name|null, "h": host, "x": expiry-unix-seconds}`, and `sig` is the
first 32 hex characters of `HMAC-SHA256(secret, "artifact-publisher:p1.<payload>")`. It is sent as
`Authorization: Bearer <pass>`. A pass for another host is refused even under the same secret, and
a reader pass or grant never verifies as a publisher pass (nor the reverse), because the domain
and version differ. `mintPublisherPass(secret, { uid, email, name, host }, exp)` builds one;
`PUBLISHER_PASS_TTL_SECONDS` is 3600.

## Reader answers (`state:`)

A page can take answers from the people reading it: a vote, a reaction, a short response.
Declare it in front matter:

```yaml
state:
  writers: anyone       # or signed-in
  visibility: tally      # private | tally | shared
  slots:
    vote:
      shape: one          # one value per reader, overwritten by a later `set`
    reactions:
      shape: many         # a growing list per reader, built by `append`
      visibility: shared   # per-slot override of the page default
```

Four routes, each requiring `state: createStateStore(db, '<base>')` in the config or they answer
501:

- `GET /api/artifacts/<id>/state`: the reader's own answers plus what the page's visibility lets
  them see (a tally, or every shared answer).
- `POST /api/artifacts/<id>/state`: `{ "slot": "vote", "op": "set" | "append" | "remove", "value": ..., "entry": "<id for remove>" }`.
  `set` is for a `one` slot, `append` for a `many` slot; `remove` takes either.
- `GET /api/artifacts/<id>/responses` (publish key): every answer with who wrote it, whatever the
  page's `visibility` says, including each row's `reader` key. `?format=csv` returns the same rows
  as CSV (a `reader` column after `anonymous`), with formula-injection escaping on any value
  starting `=`, `+`, `-` or `@`.
- `DELETE /api/artifacts/<id>/responses?reader=<key>` (publish key): erase one reader's answers,
  by the `reader` key from the read above.

**Limits**: a value is capped at 8 KB and a request body at 16 KB (Vercel caps bodies at 4.5 MB
before this runs; on any other host, cap the body size at your proxy too). A `many` slot holds at
most 200 entries per reader, and a slot holds at most 2,000 entries per page across every reader:
past that a new answer is refused with 409, though a reader can still replace their own `one`
answer. A `shared` slot shows readers only its newest 100 entries; tallies count everything. A
`POST` whose `Origin` header names another site is refused with 403.

**The anonymous rate limit**: 30 writes per minute per client address, counted in the
`<base>StateRate` collection under an HMAC of the address (keyed by your reader secret when set).
Each counter carries an `expireAt` a day ahead: set a Firestore TTL policy on `expireAt` for that
collection, or the counters are kept forever. The address is the first hop of `x-forwarded-for`,
so without one (plain `next start` with no proxy in front) every client shares one bucket: pass
`clientIp` there. An IPv6 client can rotate addresses within its /64, so treat the limit as a
brake, not a wall. A `remove` is never counted.

**Who can write**: a page with `access:` only ever accepts its signed-in readers, whatever
`writers:` says, and only after they have accepted the page's agreement (403 until then). A page
with a password takes answers only from a browser that has unlocked it; opening the page with
`?key=` sets the unlock cookie for the page and for its state API. `writers: anyone` only takes effect on a page with no `access:`: an anonymous
writer gets an opaque id in an HttpOnly `artifact_anon` cookie, good for a year. A `shared` slot
shows a reader everyone else's answer, but an anonymous one only ever by that same opaque id,
never a name or email; a publisher's `/responses` read and the CSV always show everything.

**Signing in after writing anonymously**: the next `GET /api/artifacts/<id>/state` from a reader
who is now signed in moves that cookie's answers onto their account, once, and clears the cookie.

**Republishing refuses only a shape change**: a slot going from `one` to `many` or back is
refused, checked both against the previous `state:` in front matter and against the shapes already
sitting in stored answers, so a republish can never misread history. Adding and removing slots is
allowed and the answers are kept: a removed slot's answers stop showing to readers and still come
back in `/responses`, and they reappear if the slot does. Drop `state:` entirely to close the page
to new answers; existing ones stay. Publishing `state:` to a host with no state store succeeds,
with a `warning` in the response saying the answers have nowhere to go.

**Host wiring**:

```ts
export const artifacts = createArtifactRoutes({
  store,
  state: createStateStore(getFirestore(), 'artifacts'),
  // ...the rest of your config
})
```

```ts
// app/api/artifacts/[id]/state/route.ts
import type { NextRequest } from 'next/server'
import { artifacts } from '@/lib/artifacts'
type Ctx = { params: Promise<{ id: string }> }
export function GET(request: NextRequest, ctx: Ctx) { return artifacts.STATE_GET(request, ctx) }
export function POST(request: NextRequest, ctx: Ctx) { return artifacts.STATE_POST(request, ctx) }
```

```ts
// app/api/artifacts/[id]/responses/route.ts
import type { NextRequest } from 'next/server'
import { artifacts } from '@/lib/artifacts'
type Ctx = { params: Promise<{ id: string }> }
export function GET(request: NextRequest, ctx: Ctx) { return artifacts.RESPONSES(request, ctx) }
export function DELETE(request: NextRequest, ctx: Ctx) { return artifacts.RESPONSES(request, ctx) }
```

**Firestore indexes**: every `append` runs a count over `(artifactId, slot, readerKey)` on
`<base>State` for `MAX_MANY_PER_READER`, and every new answer runs a count over
`(artifactId, slot)` for the per-slot total. Firestore may serve both from its single-field
indexes. If it asks for a composite index instead, the first failure surfaces as a 500 on a
reader's write, with a create-index link in your host's logs; following it once is the whole step.
The cross-page move that runs on sign-in queries by `readerKey` alone. Consider a single-field
index exemption for the `json` field of `<base>State`: it holds whole answers as strings and is
never queried, so indexing it only costs writes and storage.

On a proxy other than Vercel's, pass `clientIp` to `createArtifactRoutes` (used for the anonymous
rate limit): the default reads the first hop of `x-forwarded-for`, which Vercel overwrites with
the real client IP but another proxy may only append to.

## Widgets in a page

A widget is a fenced block in a page's markdown that gives readers a place to answer, drawn by
the shell in the page's brand and kept through the state API above. Widgets need a host with a
state store (`state:` in the config); on a host without one they draw nothing, and the publish
response carries the no-answers warning.

This version draws two widgets, **checklist** and **notes**. Poll and form are coming: a fence
named `poll` or `form` is refused at publish until then, so a page never ships a code block that
turns into a live widget on a later update. A checklist needs no state store unless it offers
Send or syncs.

### Checklist

A list a reader ticks off and comes back to: a setup page, a pre-call prep list, a launch
checklist. It is a known component the shell draws, not markup the author writes, so raw HTML
stays escaped and no author script ever runs.

````markdown
## Before the call

```checklist
send: anyone            # optional: signed-in | anyone; adds a Send button, see below
                        # or sync: signed-in | anyone; one shared set for every reader, see below
- Update macOS {#update}
  Apple menu > System Settings > General > Software Update.
  Restart and check again until it says you're up to date.
- [ ] Install Chrome and sign in
  Download it from [google.com/chrome](https://www.google.com/chrome/).
- Send us your GitHub username {#gh-send}
  [Text Sam your username](sms:+15555550100&body=My%20GitHub%20username%20is%20)
```
````

- **An item is a line starting with `- `** (or `* `), optionally followed by `[ ]`. `[x]` is
  accepted and ticks nothing: ticks belong to the reader.
- **Every item has a stable id.** `{#id}` at the end of the line sets it (lowercase letters,
  digits, dashes, underscores; unique on the page). Without one the id is the slug of the item's
  text, the way a heading's is (`Install Chrome and sign in` is `install-chrome-and-sign-in`), and
  a repeat is numbered `-1`, `-2`. **Give an item an explicit id whenever its wording may change**:
  a reworded item with a slugged id is a new item, and readers lose that tick.
- **Indented lines under an item are its description**, drawn as markdown: links, `code`, bold,
  short lists. Raw HTML in an item or a description is shown as text. Images, headings, tables and
  fences are not drawn inside a checklist.
- **Ticks are kept in the reader's browser**, in `localStorage` under
  `artifact-checklist:<page id>:<item id>`, so they survive a reload, a republish, and a reworded
  item with a kept id. Where storage is blocked (a private window, blocked site data) ticks last
  for the visit. Nothing leaves the device unless the reader presses Send.
- **The list says how far along the reader is**, "3 of 8 done", and every row is a tap target at
  least 44px tall, so it works one-handed on a phone.
- **Narration skips it**, like every widget: the fence is not prose and the component is
  `data-nospeak`.
- **Several checklists on one page** are fine; ids are unique across all of them.
- **`sms:` and `tel:` links work on every page**, in a checklist or in prose, so "text us your
  username" is one tap into the reader's own Messages.
- Refused at publish, naming the line in the file: an indented line before the first item, an
  unindented line after one, an empty item, a bad or repeated `{#id}`, a name after `checklist`,
  any setting but `send` or `sync`, a checklist with no items, a second checklist with `send`,
  `send` and `sync` on one page, and two checklists that say `sync` differently.

**Send** (`send: signed-in` or `send: anyone`) adds a "Send my progress to <owner>" button under
the list. It writes `{ done: [item ids] }` to the page's `checklist` slot, shape `one` and
`private`, so a reader's latest Send replaces their last and only the publisher reads them, through
`/responses` like any answer. `send:` names who may press it (`anyone` gets the anonymous cookie
and the rate limit, as `writers: anyone` does). The slot is the widget's own: a page may not
declare a `checklist` slot in `state:`. The server takes only ids of that checklist, each once. On a
host with no state store the button is not drawn; the ticks still work.

**Sync** (`sync: anyone` or `sync: signed-in`) makes the ticks the PAGE's: one set every reader
sees and, as `sync:` names, may change. Two people on a call ticking the same list see each
other's ticks within a few seconds. One block saying `sync` is enough: every checklist on the page
then shares the one set, because item ids are page-wide, and two blocks that both say it must say
the same thing. The page declares its `checklist` slot `shared` (shape `one`), each tick updates
the screen at once and, after a short pause, posts the whole page-wide `{ done: [ids] }`, and the
newest set by server time is the page's. The widget reads it on load and every four seconds while
the tab is visible, and says where it stands after the count: "Synced", "Saving…", or what went
wrong. The server takes only ids of checklists on the page. `anyone` works for anonymous readers
(the anonymous cookie and rate limit, as `writers: anyone`), on a password page once it is
unlocked. **Concurrency is last-write-wins on the whole set**: two readers ticking different items
inside the same couple of seconds can lose one tick. A page cannot both sync and send. On a host
with no state store, or where the first read fails, the list falls back to the reader's own
`localStorage` exactly as an unsynced one.

### Notes

````markdown
## Sales

The weekly pipeline review.

```notes
visibility: shared   # optional: private | shared
```
````

- **A small "note" control sits beside every heading.** A reader opens it, writes, and saves. The
  note appears under that heading; with `visibility: shared` every reader sees every note with
  the writer's first name ("a reader" for a signed-out one), with `private` each reader sees only
  their own and the publisher sees all through `/responses`.
- **At most one notes block per page.** Where it sits is where the page shows "Notes on earlier
  versions" (below).
- **The block declares its own slot**: `notes`, shape `many`. A page needs no `state:` for it;
  without one the page takes `writers: signed-in` and `visibility: private`. A page may declare
  the slot itself (`slots: { notes: { shape: many } }`) and set `writers:` and `visibility:` as
  usual. Refused at publish, naming the line in the file: a second notes block, a name after
  `notes`, any key but `visibility`, `visibility: tally`, a `notes` slot declared `shape: one`,
  and a block visibility that disagrees with one `state:` sets on the `notes` slot.
- **A note is `{ slug, heading, note }`**: the slug and the text of the heading it was left under,
  and up to 4,000 characters of text. On a page with a notes block the server refuses any other
  shape in the `notes` slot. Slugs follow GitHub's rule (lowercase, punctuation dropped, spaces
  to dashes, a repeated heading `-1`, `-2`), and each heading carries its slug as its `id`, so
  `#sales` links to it.
- **Notes survive a changed heading.** A note shows under the heading with its slug; failing
  that, under a heading with exactly its text; otherwise under "Notes on earlier versions", with
  the heading it was left under. It never attaches to a different section.
- **Narration skips it.** The fence is not prose, and everything the widget draws is marked
  `data-nospeak`, so the narrator and the read-along highlighter read the page as before.
- On a gated page (`access:`) only signed-in readers the page is open to, after the agreement,
  can leave or read notes; the banner, watermark and print refusal are unchanged. On a public
  page with `writers: signed-in`, the control offers sign-in through `signInOrigin`.

## Voice notes with their words (`transcript`)

An audio line in a page (`![caption](note.m4a)`, or `.mp3`) plays as a clip with the native
player. Put a `transcript` fence **directly under it** and it becomes a voice note: one card in the
page's brand with the caption, a play button and a seek line, and the speaker's own words beneath,
lit one at a time as they are spoken. Words already said read normally, the word being said carries
the narration's highlight, and the words still to come are a little muted. Tapping a word plays
from there.

````markdown
![Robin, to the family](hello.m4a)

```transcript
0.00 0.62 Hello!
0.80 1.10 I
1.10 1.30 hope

2.00 2.40 Love,
2.40 2.90 Robin
```
````

- **One word per line: its start and end in seconds, then the word as it should read.** A phrase
  timed together is one line; any script works. **A blank line starts a new paragraph.**
- **The audio stays plain image syntax**, so the publisher uploads a local file as it does any clip
  (including under `media: private`) and needs no change. The words travel inside the page.
- **Refused at publish, naming the line in the file:** a line that is not `<start> <end> <word>`, a
  word that ends before it starts, a word that starts before the word above it, an empty fence, a
  name after `transcript`, and a `transcript` fence with no audio line directly above it (a second
  fence under one note included).
- **The page's narration skips it** (the card is `data-nospeak`, and the narration text never reads
  images or fences): a reader hears the speaker, never a robot reading the speaker.
- **On a phone:** nothing is fetched until play (`preload="none"`), no autoplay, `playsinline`. A
  tapped word before the clip has loaded seeks once its metadata arrives. Starting a note pauses any
  other audio on the page, the narration included.
- **Play tracking is unchanged:** the `<audio>` keeps `data-artifact-media`, so a play counts like
  any clip. The note keeps the audio line's comment anchor.
- An audio line **without** a transcript fence renders exactly as before.

**Making the fence** (never by hand): `supersuit-transcript-fence` ships with the package and runs
a transcriber already on your machine, locally, with word timestamps: `mlx_whisper` (Apple Silicon,
`pip install mlx-whisper`), else openai-whisper's `whisper`. The package itself carries no
transcriber.

```bash
npx -p @supersuit/artifacts supersuit-transcript-fence hello.m4a > fence.md
# --language zh   the spoken language, when auto-detect guesses wrong
# --gap 1.5       seconds of silence that start a new paragraph (default 1.5)
# --model <name>  the whisper model (default mlx-community/whisper-large-v3-turbo)
# --body          the lines only, without the ``` fence
```

Paste it under the audio line, then correct any word (a name, a phrase in another language)
and keep its two times. `transcriptFenceFromWords` and `wordsFromWhisperJson` (from
`@supersuit/artifacts/artifacts`) do the same from code.

## Embedded players (`simulator`, `messages`, `figure`, `helm`)

Four fences play a page the HOST serves, inline, in a frame under a caption:

| Fence | Names | Default height | Plays |
| --- | --- | --- | --- |
| `simulator` | `scenario: <id>` (required) | 720px | a Supersuit Session demo |
| `messages` | `chat: <id>` (optional) | 760px | a Messages-app phone, open on one thread or the list |
| `figure` | `figure: <id>` (required) | 560px | an interactive figure |
| `helm` | `scene: <id>` (required), `autoplay: true` (optional) | 760px | a scene on a Helm phone |

````markdown
```figure
figure: doug-week
caption: A week of Doug, before and after.
height: 560px        # optional
```

```helm
scene: doug-walk
caption: A year later, on the reservoir loop.
autoplay: true       # optional, true or false
```
````

- **Every block needs a `caption`**, the line a reader sees under the player. Publish refuses a
  block with no caption, no required id, an id that is not lowercase letters, digits and dashes, a
  height that is not pixels, or an unknown key, naming the line in the file.
- **The host names each player's embed page** (`simulatorEmbed`, `messagesEmbed`, `figureEmbed`,
  `helmEmbed` in `createArtifactRoutes`, each an https URL; or `embeds` on `ArtifactMarkdown`). The
  frame loads it with the id (`?figure=doug-week`, `?scene=doug-walk`) and `fit=content`. There is
  no default: a host that names no page for a kind shows that block's caption alone, never its
  source as code, which is also what print and a page with the player blocked show.
- **The frame fits its player.** It opens at `height:` and takes the height the embed page posts
  as `{ type: 'embed:fit', height }` from its own origin.
- **Narration skips it**, caption included, and it carries no comment anchor.

## Comments and personal notes

Every page takes comments pinned to any part of it. A reader selects text (a **Comment** chip
appears) or holds and drags a box over anything that is not text (an image, a table, the gap
between paragraphs; on a phone, long-press then drag). The card that opens says who will read it
before anything is typed.

```yaml
comments: anyone          # anyone reading can leave SHARED comments
comments: signed-in       # only signed-in readers (forced on a gated page)
comments: off             # the default: personal notes only
comments_visible: owner   # the default: shared comments go to the owner only
comments_visible: readers # every reader who can comment sees the whole thread
```

- **Shared comments** are the `many` slot `comments` on the state API, declared by the
  `comments:` line (a page needs no `state:` for it). Caps, rate limits, sign-in migration, CSRF
  and the agreement gate all apply. `comments: off` declares no slot, so the API refuses a shared
  comment as it refuses any undeclared slot. A comment is `{ anchor, body, version, parent? }`,
  checked on the server; a reply names a top-level comment its writer can see (one level only). A
  writer edits (`op: replace`) or deletes (`op: remove`) only their own. The publisher reads them
  through `/responses` like every answer.
- **The owner signed in** (`ownerEmail` in the config) sees every shared comment with its
  writer's full name, whatever `comments_visible:` says.
- **Personal notes** are for every reader on every page. Without comment access the card opens
  with: *"Only you will see this. <owner> has not opened this page to comments, so this is a
  personal note. They won't see it."* (`<owner>` is the config's `owner`, default the brand name.)
  Signed in, the note is stored under the reader's id through `/personal`; signed out, it stays in
  the browser (`localStorage`) and moves to the account on sign-in. **No publisher route reads
  personal notes**: `src/routes/personal-privacy.test.tsx` calls every handler the factory returns
  with the publish key and fails if one ever does.
- **Anchors survive a republish.** A text comment stores its quote with 32 characters either side
  and the heading it sat under; a region comment stores the block it was drawn on (every top-level
  block carries a stable `data-block` id from its content) and the box as fractions of it. One
  whose quote or block is gone is listed under "Comments on earlier versions", with its quote.

Wiring, beside the state routes:

```ts
// lib/artifacts.ts
export const artifacts = createArtifactRoutes({
  store,
  state: createStateStore(getFirestore(), 'artifacts'),
  personal: createPersonalStore(getFirestore(), 'artifacts'), // <base>Personal/<page>__<uid>/notes/<id>
  ownerEmail: 'owner@example.com',
  // ...the rest of your config
})
```

```ts
// app/api/artifacts/[id]/personal/route.ts
import type { NextRequest } from 'next/server'
import { artifacts } from '@/lib/artifacts'
type Ctx = { params: Promise<{ id: string }> }
export function GET(request: NextRequest, ctx: Ctx) { return artifacts.PERSONAL_GET(request, ctx) }
export function POST(request: NextRequest, ctx: Ctx) { return artifacts.PERSONAL_POST(request, ctx) }
export function DELETE(request: NextRequest, ctx: Ctx) { return artifacts.PERSONAL_DELETE(request, ctx) }
```

Without `personal`, every reader's notes stay on their device. Without `state`, no page takes
shared comments.

### Voice memos

Every comment card has a Record button where the browser can record (Chrome records
`audio/webm`, iPhone Safari `audio/mp4`, stored as `.m4a`). Where the browser has speech
recognition, the words appear in the box as the reader speaks. A memo stops at three minutes.

Recordings go up through the same `uploads/<name>` route the publisher uses, to
`<page>/comments/<memo>.<ext>` or, for a signed-in reader's personal note,
`<page>/personal/<dir>/<memo>.<ext>`, in the PRIVATE bucket (`privateBucket`, the same one
`media: private` uses). They are never made public: playback is a signed URL, valid about an hour,
issued beside the comment or note it belongs to, and an unsigned GET is refused (403). That needs the
four audio methods `createArtifactAssets` provides (`signAudioUpload`, `audioSize`, `readAudio`,
`audioUrl`), which it defines only when it is given a private bucket; a host without one, or with
its own `ArtifactAssets` and none of them, keeps memos on the reader's device. Memos recorded before
0.38.0 sat in the public bucket: `scripts/migrate-memos-private.mjs` moves them (see CHANGELOG).

To transcribe on the server, pass `transcribe` and add the route. The key stays on the server;
without `transcribe` the route answers 404 and readers keep the browser's live transcript (or an
empty box). 20 transcriptions per reader per page per hour.

```ts
import { deepgramTranscriber } from '@supersuit/artifacts/artifacts'
export const artifacts = createArtifactRoutes({
  // ...
  transcribe: process.env.DEEPGRAM_API_KEY ? deepgramTranscriber(process.env.DEEPGRAM_API_KEY) : undefined,
  // or openaiTranscriber(key, 'gpt-4o-mini-transcribe')
})
```

```ts
// app/api/artifacts/[id]/transcribe/route.ts
import type { NextRequest } from 'next/server'
import { artifacts } from '@/lib/artifacts'
type Ctx = { params: Promise<{ id: string }> }
export function POST(request: NextRequest, ctx: Ctx) { return artifacts.TRANSCRIBE(request, ctx) }
```

The bucket also needs CORS allowing `PUT` from the site's origin with the `content-type`,
`cache-control` and `x-goog-content-length-range` headers, since the reader's browser uploads
directly.

### Resolving a thread

When what a comment asked for has been done, the thread is resolved. On the page it then draws a
muted check pin with no box over the page, opens collapsed to one line, **"Resolved: <note>"** (or
**"Resolved"**), with the comment and its replies a tap away, and leaves the Comments count. The
reader who left the comment sees the note. The owner and the hub's admins get **Resolve** (with an
optional note) and **Reopen** in every shared thread.

```
POST /api/artifacts/<id>/resolve
Authorization: Bearer <publish key or publisher pass>
Content-Type: application/json

{ "entry": "<entryId>", "note": "Named the river in the second paragraph.", "by": "Pat's agent" }

200 { id, entry, resolved: { at, by, note? } }
```

- **Who:** the publish key or a publisher pass, so an agent resolves with the credential it
  publishes with; or a reader signed in as `ownerEmail` or one of `admins`, from this host's own
  pages, as JSON. Anyone else is refused (401 signed out, 403 signed in) before the page is looked
  up. Leaving a comment does not make you able to resolve it.
- **`entry`** is a comment's entry id, as the feed and `/responses` give it. Naming a reply
  resolves the thread it belongs to; the answer's `entry` is that thread's top comment, which is
  where `resolved` is stored (in the comment's value, beside `body`).
- **`note`** is optional: one line, at most 280 characters, saying what changed. **`by`** names the
  resolver and is the publisher's to set (one line, at most 80; default "the publisher"); a signed-in
  owner or admin is named by their first name. Never an email: a readers-visible page shows it.
- **Reopen** with `{ "entry": "<entryId>", "resolved": false }` (no note), by the same people.
- A reader cannot set `resolved` by writing a comment (the server refuses the field), and an edit to
  a resolved comment keeps its resolution.
- 404 for a page or comment that is not there; 501 on a host with no `state`, or whose own
  `StateStore` has no `setResolved` (`createStateStore` and `createMemoryStateStore` have it).

```ts
// app/api/artifacts/[id]/resolve/route.ts
import type { NextRequest } from 'next/server'
import { artifacts } from '@/lib/artifacts'
type Ctx = { params: Promise<{ id: string }> }
export function POST(request: NextRequest, ctx: Ctx) { return artifacts.RESOLVE(request, ctx) }
```


### Replying as the publisher (0.40.0)

    POST /api/artifacts/<id>/reply
    Authorization: Bearer <publish key or publisher pass>
    Content-Type: application/json

    { "entry": "<entryId>", "body": "Named the river in the second paragraph.", "by": "Pat", "quote": "the river Ash" }

    200 { id, entry, parent, existing }

One reply per thread when calls do not overlap. `entry` may name a reply: the thread it belongs to
is answered. A second call for a thread already answered changes nothing and names the first reply
back with `existing: true`, so a caller that retries does not post twice. The check is a read and
then an append, so two overlapping calls can both post. `by` defaults to "the publisher". `quote`
(text on the page, at most 500 characters) pins the reply to the passage that changed, and the
thread then offers "Show what changed"; without it the reply sits where its thread does. On a
per-reader page the reply is shown to the reader whose comment started the thread and to no other
reader. It is allowed after that reader's window has closed. On a page that is not per-reader
and whose comments are owner-only (`comments_visible: owner`), `REPLY` still answers 200 and stores
the reply, but the commenter is not shown it: only the owner, the admins and the feed are. The feed lists it with
`publisher: true`, and a publisher reply never reopens a resolved thread under `open=1`. 404 for a
page or comment that is not there, 501 with no `state`.

    // app/api/artifacts/[id]/reply/route.ts
    import type { NextRequest } from 'next/server'
    import { artifacts } from '@/lib/artifacts'
    type Ctx = { params: Promise<{ id: string }> }
    export function POST(request: NextRequest, ctx: Ctx) { return artifacts.REPLY(request, ctx) }

### Telling commenters their comments were resolved (`createResolveDigests`)

When threads are resolved, each signed-in reader whose comments were in them can get ONE email per
page per burst of resolving, listing every one of their comments resolved in it: the passage it was
pinned to (or "a box on the page"), their comment trimmed, the resolution note, a link to
`<page>#comment-<id>`, and one link to the page. Resolve nineteen threads in a sitting and a reader
gets one email, not nineteen.

- **Who hears:** the signed-in writer of each comment in a resolved thread, about the comments THEY
  wrote (a reply by someone else is not theirs). Never an anonymous reader (no address), never the
  person resolving, never `ownerEmail` or `admins` about their own comments.
- **The burst:** closes after `quietMs` (default 10 minutes) with no new resolution for that reader
  on that page, or once its first resolution is `maxWaitMs` old (default 6 hours). A thread reopened
  before then drops out; resolving one again replaces its line.
- **No backfill:** only resolutions that pass through `onResolve` queue anything, so threads resolved
  before a host wires it never produce an email.
- **Sent once:** a due burst is claimed in one transaction (it becomes a digest record and the burst
  is deleted), and a digest is leased in a transaction before it is sent, so overlapping runs cannot
  both send it. The message carries `idempotencyKey` (the same on every retry of one digest): hand it
  to your provider (Resend's `Idempotency-Key`), and a run that died between sending and recording
  does not deliver twice when the lease expires. A failed send is retried with back-off, at most 5
  times.
- **Stop:** every email carries a signed link (`<site>/api/resolve-digest/stop?t=...`, and the RFC 8058
  `List-Unsubscribe` headers) that ends these emails for that reader on that page. Without `secret`
  nothing is queued, since no email may go out without one.
- **Where it waits:** `createResolveDigestStore(db, base)` (Firestore: `<base>ResolveBursts`,
  `<base>ResolveDigests`, `<base>ResolveStops`; single-field queries only, so no index to create), or
  `createMemoryResolveDigestStore()` for tests.

```ts
const digests = createResolveDigests({
  store: createResolveDigestStore(db, 'artifact'),
  send: async (m) => sendWithYourProvider(m),     // { to, subject, text, html, headers, idempotencyKey }
  secret: () => process.env.STOP_LINK_SECRET,     // signs stop links
  siteUrl: 'https://artifacts.example.com', brandName: 'Example Co', ownerName: 'Ann',
  ownerEmail, admins,
})
createArtifactRoutes({ /* ... */, onResolve: digests.onResolve })
// app/api/resolve-digest/stop/route.ts:  GET and POST = digests.STOP
// a scheduled job:                        await digests.flush()   ({ dryRun: true } reports, sends nothing)
```

### The comments feed

So the publisher hears about a shared comment without opening every page, one route lists every
shared comment on any of the host's pages after a time. Publish key only; personal notes never
appear (the privacy test covers this handler like every other).

```
GET /api/comments?since=2026-09-28T12:00:00Z
Authorization: Bearer <publish key>

200 { now, cursor, more, comments: [ { artifactId, title, entryId, parent, name, reader, by, publisher,
                                       quote, region, body, transcript, audioUrl, at, resolved, link } ] }
```

**One page's feed (0.43.0).** `&artifact=<page id>` returns only that page's rows. `since`, `open`,
`cursor` and `more` behave as above, over that page's comments alone, so a caller paging one page
reaches its end without reading another page's rows. The feed is read from that page's own entries,
not from a scan of the host. A value that is not a page id is a `400` ("artifact must be a page id,
like abcd2345"); a well-formed id with no page, or no comments, answers an empty feed
(`{ now, comments: [], cursor: null, more: false }`), as an empty host does. Without the parameter
the feed is what it was.

```
GET /api/comments?since=2026-09-28T12:00:00Z&artifact=abcd2345&open=1
Authorization: Bearer <publish key>
```

Oldest first, at most 200, strictly after `since` (an ISO 8601 time with a zone; anything else is
a 400). `name` is null for an anonymous reader; `reader` is `{ rid, label }` for a comment left through a per-reader link, else null; `by` is the name its writer typed, else null; `publisher` is true for a reply written through the reply route; `quote` is the text the comment is pinned to, or
null for a box (`region: true`); `parent` is the comment a reply answers; `audioUrl` is a signed
URL to the recording, when there is one and the host can sign it. `link` is the page with
`#comment-<entryId>`: opening it scrolls to the pin and opens its thread (a reply opens its
parent's; a comment on an earlier version is highlighted in that list). A caller keeps a cursor
at the last row's `at` and leaves it where it was when nothing came back; `now` is where a first
run starts, so it does not replay history.

`resolved` is the row's THREAD's resolution (`{ at, by, note? }`, a reply carries its parent's), or
null while the thread is open. **`&open=1` lists only open threads**: every row of a resolved thread
is left out, except a reply written after the thread was resolved, which is news about it. Filtered,
a page can come back short while more remains, so page with `cursor` (the `at` of the last comment
read, filtered or not) and `more` (a full page was read) rather than with the last row.

The path sits outside `/api/artifacts/` because `comments` is itself a legal page id there.

```ts
// app/api/comments/route.ts
import type { NextRequest } from 'next/server'
import { artifacts } from '@/lib/artifacts'
export function GET(request: NextRequest) { return artifacts.COMMENTS_FEED(request) }
```

On Firestore (`createStateStore`) the query is one range scan over `<base>State` and needs a
composite index: **`slot` ascending, `at` ascending**, collection scope. Without it Firestore
refuses the query and the error names a link that creates the index. A host with its own
`StateStore` implements `slotSince(slot, after, limit)`; without it the feed answers 501.

## Per-reader links

One page, sent to many people, where every person gets their own link. The link names an opaque reader id and a signature over the page and that id, so a link cannot be guessed or carried to another page. The host knows an opaque id, a label you gave it and that link's views and comments, and nothing else about the reader.

```markdown
---
title: The river
summary: Eleven minutes on the water.
links: per-reader
media: private
---
![sound: the first night](river.mp4)
![a voice note, as it came](note.m4a)
```

`links: per-reader` shuts the page to everyone who does not arrive through a valid, unrevoked, unexpired link. It cannot be combined with `password`, `access` or `comments_visible: readers` (readers never see each other's comments). `media: private` keeps body media under the page's private prefix; `.mp4` and `.m4a` (and `.mp3`) are supported, and `sound:` at the start of a video's alt makes it a clip with controls and sound. Both lines are sticky: republishing a file that leaves them out changes nothing.

### Private media lives in its own bucket

`media: private` needs a private store: `createArtifactAssets(bucket, prefix, { privateBucket })`. Private files go to `privateBucket` under `<prefix>/<id>/private/`; covers, images and narration stay on the public `bucket`. Without `privateBucket` the private methods are not defined, and the host refuses private media with 501 at every door: publishing a page with `media: private` (or republishing a page that already keeps it), and `?private=1` uploads. Nothing is saved. This is on purpose: a public bucket often carries a bucket-wide public read grant, so an object written there is readable by anyone who has its URL, whatever the object's own settings say.

The private bucket must be a different bucket from the public one (passing the same bucket twice throws), with uniform bucket-level access, public access prevention enforced, and object access granted only to the host's own service account. The page signs a V4 read URL per private file on every render that passed the per-reader gate, valid `PRIVATE_READ_TTL_MS` (one hour); a revoked or expired link renders nothing and mints nothing. A reader revoked after a render can keep loading a URL already handed to them for at most that hour. Expiry's `deletePage` clears the page from both buckets.

If the publisher uploads straight to the private bucket from a browser (`?private=1` on `UPLOAD`), give that bucket a CORS rule allowing `PUT` from your origin with the `content-type` and `cache-control` headers; a reader's browser playing a signed URL needs `GET` (and `HEAD`) from your origin only if your player fetches it with CORS.

Routes (spread into your route files by `createArtifactRoutes`): `RECIPIENTS`, `VIEWS`, `SEEN`, and `sweepExpired`.

| Route | Who | What |
|---|---|---|
| `GET /api/artifacts/<id>/recipients` | publish key | Every reader, with the working link for each |
| `POST /api/artifacts/<id>/recipients` | publish key | Body `{ add?: [{ label, note?, group?, closes? }], revoke?: [rid] or '*', expires?: ISO time or null, closes?: { rids: [rid] or '*', at: ISO time or null } }`. `add` answers each new reader's link; `expires: null` is Keep; `closes` sets, moves or clears a reader's feedback window |
| `GET /api/artifacts/<id>/views` | publish key | One line per reader: opened, came back, active seconds, plays, devices, comments. Each comment is `{ id, parent, at, text }` (see Comment ids in /views). A page with no readers yet answers 200 with an empty list; a missing page answers 404 |
| `POST /api/artifacts/<id>/seen` | the page itself (public) | The reader's own signal, below |

Config, both on `createArtifactRoutes`: `recipients` (a store from `createRecipientsStore(db, '<collection path>')`, or `memoryRecipientsStore()` in tests) and `recipientSecret`, a function returning the signing secret, read on every request. A secret shorter than 32 characters is treated as unset: per-reader pages stay shut and the routes answer 404 or 501. Signing with an empty secret throws.

The `Page` route must stay `force-dynamic` (the package's `dynamic` export says so; re-export it), because the page carries a fresh render token and answers per link.

### What counts as a view

A view is the page rendered in a real browser, visible, for at least 2 seconds. The page then sends one signal carrying a single-use render token minted for that render; the token is spent on first use and expires after a day. Known unfurl fetchers (and any request with no user agent) are ignored, and so is a signal for a revoked or expired reader. The owner's own opens record zero. After the first signal the page sends a beat every few seconds while it stays visible (and a final one on hide, by `sendBeacon`), and a play signal when a clip starts. A signed-in owner or admin opens the page with no link and no tracking, so test a reader's link in a signed-out browser, never in the browser you are signed in to.

### Expiry

`expires` sets the date the page, its media, its readers, their views and their comments go. `sweepExpired()` (call it daily from a cron route) deletes them and returns `{ pages, files, skipped, failed }`: pages removed, media files removed, ids it refused to delete (an expiry that is not a past ISO time, or a page republished without per-reader links), and ids that failed and will be retried by the next run. Your `assets` must provide `deletePage`, or every expired page lands in `failed` and nothing is deleted. With a private bucket configured it deletes from both buckets. A Keep that lands mid-sweep is honored. Deleting a page also removes every prior version of its body.

### A feedback window (0.40.0)

A reader may carry `closesAt`, the time their feedback window closes. It is per reader, set when
the reader is added (`add[].closes`) or afterwards (`closes: { rids, at }`, where `rids` is a list
of reader ids or `'*'` for every reader but the owner, and `at: null` clears the window). The owner
never has one: `closes` on an `add` entry with `owner: true` is dropped. It is
separate from the page's `expires`: a reader past their window still opens the page and reads
their own comments. A time in the past closes the window now, and a window that cannot be read as
a time counts as closed. `closes` answers `windowed`, the reader ids it changed, beside `added` and
`revoked`. A host with its own `RecipientsStore` needs `setCloses` for this; without it the route
answers 501 to a `closes` change.

Once the window is closed, a new shared comment or an edit is refused with
`403 { error: "Feedback on this draft is closed. Your note was not sent.", closed: true }`.
Deleting their own comment (`remove`) still works. `GET /state` answers
`feedback: { closesAt, closed }` for a reader who has a window, and `GET /recipients` and
`GET /views` carry each reader's `closesAt` (null when there is none).

The page says so. A reader with a window sees, above the title, "A draft from <owner>, for
<label>" (a group link names nobody), the note the publisher wrote for them, and how long is left,
counted in days from two days up, then hours from two hours, then minutes, and live while the page
stays open. Past it the line reads "Feedback is closed. You can still read the draft and your own
notes." A reader with no window sees the `For <label>: <note>` line as before. In a thread, a
comment of theirs that nobody has answered shows "Waiting for a reply." while the window exists.

### A name on every note: `comment_name: required` (0.40.0)

A per-reader page that says `comment_name: required` in its front matter puts a name on every
shared comment. A `group` reader (one link shared by several people) must type a first name:
without one the state route answers `400 { error: "Add your first name, so your note has a name on
it.", needsName: true }`, and the comment card, the reply form and a signed-in reader's card all
ask before they send. A reader on a named link is never asked, and a name sent for them is
dropped: the label is who they are. The line needs `links: per-reader` (a page without it is
refused), and a republish that leaves it out removes it. A page without the line takes names
exactly as before.

**Who a group link is.** Without `comment_name: required`, a group link is one shared reader:
everyone who opens it sees every note left through it as their own, can edit or delete any of
them, and sees the publisher's reply to any of them. Do not send one to people who should not read
each other's notes. With the line, each browser on a group link is its own reader: it sees, edits
and deletes only the notes written from that browser, and is shown only the publisher's replies to
those. The browser is known by the anonymous-reader cookie (`artifact_anon`, HttpOnly, a year), set
with its first note, and its notes are stored under a key the server derives from the link and that
cookie (`r:<rid>.<24 hex>`), never under the cookie itself; `ridOfReaderKey(key)` reads the
link's rid out of either shape. A browser that clears its cookies, or a
second device, is a new reader: the notes it left stay with the publisher and are no longer shown
to it. So does a reader who signs in on another page of the same host, since signing in clears the
anonymous cookie. Notes left through a group link before the page gained the line were written as
the one shared reader (`r:<rid>`) and are shown to no browser afterwards. A named link is one
reader either way. The feedback window, the feed's `reader: { rid, label }` and the `/views` line
stay per link: every browser on a group link shares them.

### Comment ids in `/views` (0.43.0)

Each comment in a reader's `comments` array carries the entry id the comments feed calls
`entryId`, and the id of the comment it replies to:

```json
{ "rid": "abcdefghijkl", "label": "Anyone with the link", "group": true, "comments": [
  { "id": "kq3vN8xTz2LwPd5mRa", "parent": null, "at": "2026-10-11T10:01:00.000Z", "text": "Which river?" },
  { "id": "Jm7cHy4bQe9sUf1xWk", "parent": "kq3vN8xTz2LwPd5mRa", "at": "2026-10-11T10:04:00.000Z", "text": "The north one." } ] }
```

`at` and `text` are as before. Under `comment_name: required` the notes of every browser on a
group link are listed under that link's row, each with its own `id`. The publisher's replies are not
listed. A caller that keeps a local copy of a page's comments compares these ids with
`GET /api/comments?artifact=<id>` to see exactly which ones it lacks.

**Limit on new browsers.** On a page with `comment_name: required`, the first stored note of each new
browser through one group link is counted against that link, per minute, on the anonymous write limit
(30). A browser is new when its reader key has no entry on the page yet, whether or not it arrived with
an `artifact_anon` cookie. Past the limit the state route answers
`429 { error: "too many new readers through this link; try again in a minute" }`. Only a stored note is
counted: a request refused for a missing name, a closed window or a malformed body spends nothing. A
browser's later notes, a named link and a page without the line are never counted. "Note" here means
any stored entry in any slot, and a browser that removes its only entry and writes again is new again.

**Removing the line later.** Taking `comment_name: required` off a page turns its group link back into
one shared reader, and every note left per browser stops being shown to its writer: the notes stay with
the publisher, under their per-browser keys.

## Broadcasts (`template: broadcast`)

A broadcast is its own page kind, not a document with extra flags. It is one message sent to several people, each through their own link, and it renders as one card: the sender's words at the top, then the media in the order the words put it (a video with sound and controls, photos, a voice note's player, link cards), then that person's own note. None of the document's furniture: no table of contents, no version line, no read-along, and no page menu for a reader.

```markdown
---
title: At the lake
summary: We finally made it up there.
template: broadcast
links: per-reader
media: private
voice: none
---
We finally made it up there.

![sound: The lake at dusk](lake.mp4)
```

What the kind decides, so the file does not have to:

- **Per-reader links, always.** `links: per-reader` is implied. The kind is sticky like `links:`: a republish that leaves `template:` out stays a broadcast, and one that says `document` is refused (409). `access`, `password` and `comments_visible: readers` are refused in words.
- **Private media wherever there is media.** `media: private` is implied as soon as the body carries a stored private file or a local one (a remote URL alone stores nothing, so it does not count). A body that points at a local file (one the publisher will upload) must still say `media: private`, because that line is what makes the publisher upload it privately; without it the page is refused before anything is uploaded.
- **Expires 90 days after it is published** (`BROADCAST_TTL_MS`), set by `POST /api/artifacts` when the page has no date yet, and answered as `expireAt` in its response. A date set on the recipients route stands, a republish never moves it, and Keep (`expires: null`) holds.
- **Comments off** unless the file turns them on. With them on, a reader's feedback window and `comment_name: required` work as on a document: past the window the card stops offering Share, and a group reader is asked for a first name. A broadcast draws no banner, though: no "A draft from" line, no countdown and no "Feedback is closed" line above the card. **No narration player**, ever: a voice note is its own audio (`![Voice note](note.m4a)` draws a player). Write `voice: none` so the publisher does not record one.
- **Silent view tracking**: the quiet view beacon, as on every per-reader page.

Routes:

| Route | Who | What |
|---|---|---|
| `GET /api/artifacts?kind=broadcast` | publish key, or the owner or an admin signed in | Every broadcast, newest first: id, title, summary, url, dates, `expireAt`, `keep`, `readers` (people whose link still works) and `revoked`. `?kind=document` (the default) lists documents, never a broadcast |
| `shutPageResponse(request)` | your proxy | A per-reader page whose link was revoked or whose date passed answers **410 Gone** with the quiet words the page shows. Null for everything else, which the proxy passes on. Reads nothing unless the request carries a reader's link or its cookie |

```ts
// proxy.ts
import { NextResponse, type NextRequest } from 'next/server'
export async function proxy(request: NextRequest) {
  // Only a request carrying a reader's link or its cookie can be shut; skip the rest cheaply.
  const hasLink = request.nextUrl.searchParams.has('r') || request.cookies.getAll().some((c) => c.name.startsWith('artifact_r_'))
  if (!hasLink) return NextResponse.next()
  try {
    const { routes } = await import('./routes') // your createArtifactRoutes(...)
    const shut = await routes.shutPageResponse(request)
    if (shut) return shut
  } catch {
    // A store outage never costs a reader the page: the page applies the same gate itself.
  }
  return NextResponse.next()
}
export const config = { matcher: ['/:id([a-z0-9]{8})'] }
```

Any per-reader page served to a known unfurl fetcher (or a request with no user agent) carries its text only: no media, no signed URL, no reader's note, no cookie. `readHeader` on `createArtifactRoutes` reads the agent (default through `next/headers`). `DELETE /api/artifacts/<id>` removes the page's files from both buckets (`deletePage`), then its readers, their notes and views and every comment, before the record, and keeps the record (502) if the files could not go, so it can be run again.

## Product analytics (`analytics`)

Pass `analytics: { posthogKey: 'phc_...', posthogHost?: 'https://us.i.posthog.com', tenant?: 'name' }`
to `createArtifactRoutes` and the host's pages record visits in PostHog: session replay, heatmaps,
autocapture, scroll depth on leave, `section_viewed` (heading id, text, seconds) and
`narration_play` / `narration_pause` / `narration_complete`. Without it no page loads any analytics
code. Switch session replay and heatmaps on in the PostHog project as well.

Who is recorded, and as whom (`analyticsPlan`, `src/reader/analytics-plan.ts`):

- Never the owner or an admin (signed in, previewing `?as=reader`, or on the owner's own per-reader
  link), never a link-preview fetcher, never a past version.
- A gated page identifies the signed-in reader by email and masks all text in its replays.
- A per-reader link identifies as `recipient:<rid>` with the label the publisher gave it.
- A public or password page stays anonymous.

## Brand packs

A `BrandPack` is data plus at most two components: colours, type, the kicker line above a title,
an optional full-page `Wrapper` and `Mark`, and an optional `share` block
(a font loader and a backdrop) that draws the unfurl card. `freedomDefault` is the default look.
Keep a pack carrying your own trademark in your own app, not in a pull request here.

**The default look's faces.** Since 0.49.0 `freedomDefault` is Supersuit's own look, the Maison:
night with mist type and bronze by default, travertine with ink behind the light toggle, every
colour one of seven stone tokens or a mix of two, and the mark above the kicker a short rule in
the accent (no dove). It sets DM Serif Display for headings and DM Sans for reading, by name. The
package does not fetch them, so a host that wants them loads them itself, for example
`import '@fontsource/dm-serif-display/400.css'` and `import '@fontsource/dm-sans/400.css'` (plus
500 and 600) in its root layout, which serves the files from the host's own origin. A host that
does not falls back to Georgia and the system face. The share card still sets its title in the
bundled Newsreader, so no host's `outputFileTracingIncludes` has to change.

**Light, dark or system.** A pack's `ground`, `ink` and `accent` are its dark palette; `light` is
the other one (absent, warm paper with the pack's accent), and `mode` is the one a page opens in
(`dark` by default; a page's `theme:` overrides it). Pages paint with CSS variables
(`--a-ground`, `--a-ink`, `--a-accent` and tones derived from them), which is what lets `system`
follow the device.

**An animated ground.** `backdrop: { kind: 'bubbles', colors?, veil? }` draws soft colour drifting
behind the page under a veil of the ground, in plain CSS, still for readers who ask for reduced
motion. `colors` are `r,g,b` triplets (default `GLOW_PASTELS`); `veil` is 0 to 1 (default 0.4).

```ts
const pack: BrandPack = { ...freedomDefault, mode: 'light', backdrop: { kind: 'bubbles' } }
```

**Drawing more than colours.** Four optional fields let a pack draw a page's structure. A pack
that sets none of them renders every page byte for byte as before (a test holds that).

- `Cover` draws the title block instead of the centred header. It is handed `title`, `subtitle`
  and `summary` to render (they are spoken, in that order), the shell's `kicker` and `meta`
  (version line, signed-in line) to place, and the page's `markdown` to quote from.
- `Article` holds the cover, the inline contents and the body, instead of the centred column.
- `Section` receives each top-level section (split at the shallowest heading level the page
  uses): its `index`, `count`, the whole `outline`, the heading's `text` and `slug`, the default
  `heading`, or its `headingContent` and `headingAttrs` (id and comment anchor) for a pack that
  draws the heading itself, and the section's body as `children`.
- `figure(src, alt)` returns a component to draw an image or embed in its place, or undefined to
  keep the default. An image alone in its paragraph replaces the paragraph.

Everything a pack adds beyond the text it is handed must sit inside `data-nospeak`, which the
read-along skips; the shell puts figures there itself. A test renders a page through all four
and checks the words on the page are exactly the words narrated.

**One page in a different pack.** Register packs by name with `packs: { name: pack }` and a page
picks one with `pack: name` in its front matter. `packFor(artifact)` lets the host choose instead,
ahead of the front matter, for a page whose file cannot carry the line. The share card follows
the page's pack.

## Environment

| Variable | Used for |
|---|---|
| your publish key (named by you, read in `publishKey`) | Authorises publish, delete and access changes |
| `ARTIFACT_PASS_SECRET` (named by you, read in `readerSecret`) | Verifies reader passes and signs grants; shared with your sign-in side |
| a publisher-pass secret (named by you, read in `publisherSecret`; may be the same one) | Verifies publisher passes; shared with whatever mints them |
| a recipient secret (named by you, read in `recipientSecret`; at least 32 characters) | Signs per-reader links and render tokens; shorter is treated as unset |
| Firebase Admin credentials | The store and readers store |

## Contributing

Fixes and improvements are welcome: open an issue or a pull request at
[SupersuitUp/artifacts](https://github.com/SupersuitUp/artifacts). `npm test` runs the suite,
`npm run build` compiles, and `npm run test:packed` builds and serves a small Next.js app from
the packed tarball. A behaviour change comes with its test in the same pull request.

## License

MIT
