# @supersuit/artifacts

Publish a markdown file, get a branded page at a short link. `@supersuit/artifacts` is the whole
site shell behind that: the store, the route handlers, the read-along reader, brand packs,
password pages, confidential pages with a signed-in reader list, and the share card a link
unfurls as. You mount it in a Next.js App Router app with a handful of one-line route files.

It is the shell that serves every Freedom operator's `artifacts.<theirname>` page, published
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
| `createArtifactAssets(bucket, prefix)` | Uploaded images for a page, in a Cloud Storage bucket |
| `freedomDefault`, `BrandPack` | The default look and the type any other look implements |
| `BrandGround`, `BrandMark` | The pack's page backdrop and mark, for your own pages (a home, a 404) |
| `parseArtifactSource` | The front-matter contract, as a parser you can call before publishing (widget fences included) |
| `headingsOf`, `scanWidgets`, `placeNotes` | The notes widget's pure parts: heading slugs, fence validation, where each note shows |
| `checklistsOf`, `parseChecklistFence`, `checklistStorageKey` | The checklist widget's pure parts: the fence grammar, every item's id, where a tick is kept |
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
| `app/api/artifacts/[id]/reads/route.ts` | `GET` = `READS` |
| `app/api/artifacts/[id]/versions/route.ts` | `GET`, `POST` = `VERSIONS` |
| `app/api/reader/enter/route.ts` | `GET` = `ENTER` |
| `app/api/reader/leave/route.ts` | `GET` = `LEAVE` |
| `app/api/reader/ack/route.ts` | `POST` = `ACK` |
| `app/api/reader/track/route.ts` | `POST` = `TRACK` |
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

## Version history

Every page names its version under the summary, "Version 4 · Updated <minute> · History", and
History opens a panel listing every version newest first: its number, the minute it went live in
the reader's own time zone, and its change note. The panel is drawn over the page (a sheet on a
phone, a side panel on a desk), so opening it moves no text. Each past version is readable at
`/<id>/v/<n>`, read-only, under a banner naming it and linking the current page, behind exactly
the same password or confidential door as the page itself. A version that does not exist is a
404; on a shut page the door comes first, so it never says which versions exist.

**Past versions are for admins by default (0.21.0).** An earlier draft can hold what the current
one was edited to remove, so only the page's admins see the History control or open
`/<id>/v/<n>`: the reader signed in as `ownerEmail` or any address in `admins` (case does not
matter). Everyone else still sees "Version N · Updated <minute>", and a past version is a 404 to
them. With neither configured, nobody does. `history: 'everyone'` in the config restores the old
behaviour, where every reader who can open the page reads its history.

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
| `change` | One line saying what this version changed (see Version history) |
| `template` | `document`, the only one so far |

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
opens no other page. Republishing without the line takes the door down.

## A confidential page (`access:`)

`access: freedom` opens the page only to a signed-in reader with an active Freedom account or
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
Send.

### Checklist

A list a reader ticks off and comes back to: a setup page, a pre-call prep list, a launch
checklist. It is a known component the shell draws, not markup the author writes, so raw HTML
stays escaped and no author script ever runs.

````markdown
## Before the call

```checklist
send: anyone            # optional: signed-in | anyone; adds a Send button, see below
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
  any setting but `send`, a checklist with no items, and a second checklist with `send`.

**Send** (`send: signed-in` or `send: anyone`) adds a "Send my progress to <owner>" button under
the list. It writes `{ done: [item ids] }` to the page's `checklist` slot, shape `one` and
`private`, so a reader's latest Send replaces their last and only the publisher reads them, through
`/responses` like any answer. `send:` names who may press it (`anyone` gets the anonymous cookie
and the rate limit, as `writers: anyone` does). The slot is the widget's own: a page may not
declare a `checklist` slot in `state:`. The server takes only ids of that checklist, each once. On a
host with no state store the button is not drawn; the ticks still work.

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
`<page>/personal/<dir>/<memo>.<ext>`. They are never made public: playback is a signed URL
issued beside the comment or note it belongs to. That needs the four audio methods
`createArtifactAssets` provides (`signAudioUpload`, `audioSize`, `readAudio`, `audioUrl`); a host
with its own `ArtifactAssets` and none of them keeps memos on the reader's device. On a bucket
with bucket-wide public read, a recording is readable by anyone holding its path (the paths are
unguessable); keep the bucket per-object public to have the signed-URL guarantee.

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

### The comments feed

So the publisher hears about a shared comment without opening every page, one route lists every
shared comment on any of the host's pages after a time. Publish key only; personal notes never
appear (the privacy test covers this handler like every other).

```
GET /api/comments?since=2026-09-28T12:00:00Z
Authorization: Bearer <publish key>

200 { now, comments: [ { artifactId, title, entryId, parent, name, quote, region, body,
                         transcript, audioUrl, at, link } ] }
```

Oldest first, at most 200, strictly after `since` (an ISO 8601 time with a zone; anything else is
a 400). `name` is null for an anonymous reader; `quote` is the text the comment is pinned to, or
null for a box (`region: true`); `parent` is the comment a reply answers; `audioUrl` is a signed
URL to the recording, when there is one and the host can sign it. `link` is the page with
`#comment-<entryId>`: opening it scrolls to the pin and opens its thread (a reply opens its
parent's; a comment on an earlier version is highlighted in that list). A caller keeps a cursor
at the last row's `at` and leaves it where it was when nothing came back; `now` is where a first
run starts, so it does not replay history.

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

## Brand packs

A `BrandPack` is data plus at most two components: colours, type, the kicker line above a title,
the narrator label, an optional full-page `Wrapper` and `Mark`, and an optional `share` block
(a font loader and a backdrop) that draws the unfurl card. `freedomDefault` is the default look.
Keep a pack carrying your own trademark in your own app, not in a pull request here.

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
| Firebase Admin credentials | The store and readers store |

## Contributing

Fixes and improvements are welcome: open an issue or a pull request at
[SupersuitUp/artifacts](https://github.com/SupersuitUp/artifacts). `npm test` runs the suite,
`npm run build` compiles, and `npm run test:packed` builds and serves a small Next.js app from
the packed tarball. A behaviour change comes with its test in the same pull request.

## License

MIT
