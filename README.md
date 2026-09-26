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
| `mintPass`, `verifyPass` | The reader pass, for the sign-in side (see below) |
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
| `app/[id]/share.png/route.tsx` | `GET` = `SHARE_IMAGE` |
| `app/api/artifacts/route.ts` | `POST` (publish) |
| `app/api/artifacts/[id]/route.ts` | `GET`, `DELETE` |
| `app/api/artifacts/[id]/assets/[name]/route.ts` | `PUT` = `PUT_ASSET` |
| `app/api/artifacts/[id]/access/route.ts` | `GET`, `POST` = `ACCESS` |
| `app/api/artifacts/[id]/reads/route.ts` | `GET` = `READS` |
| `app/api/reader/enter/route.ts` | `GET` = `ENTER` |
| `app/api/reader/leave/route.ts` | `GET` = `LEAVE` |
| `app/api/reader/ack/route.ts` | `POST` = `ACK` |
| `app/api/reader/track/route.ts` | `POST` = `TRACK` |

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
| `id` | Republish in place instead of minting a new page |
| `cover` | An image URL (absolute or site-relative) used as the unfurl image instead of the share card |
| `audience` | Free text stored with the page |
| `voice`, `narration`, `timings`, `narrationHash` | Read-aloud: the audio and word timings a publisher generated. Absent, no player |
| `password` | Shuts the body behind a door (below) |
| `access` | `freedom`, `invite` or `public`: a confidential page (below) |
| `template` | `document`, the only one so far |

An unknown key is refused, so a typo fails loudly instead of being ignored.

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

This version draws one widget, **notes**. Poll, form and checklist are coming: a fence named
`poll`, `form` or `checklist` is refused at publish until then, so a page never ships a code
block that turns into a live widget on a later update.

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

## Brand packs

A `BrandPack` is data plus at most two components: colours, type, the kicker line above a title,
the narrator label, an optional full-page `Wrapper` and `Mark`, and an optional `share` block
(a font loader and a backdrop) that draws the unfurl card. `freedomDefault` is the default look.
Keep a pack carrying your own trademark in your own app, not in a pull request here.

## Environment

| Variable | Used for |
|---|---|
| your publish key (named by you, read in `publishKey`) | Authorises publish, delete and access changes |
| `ARTIFACT_PASS_SECRET` (named by you, read in `readerSecret`) | Verifies reader passes and signs grants; shared with your sign-in side |
| Firebase Admin credentials | The store and readers store |

## Contributing

Fixes and improvements are welcome: open an issue or a pull request at
[SupersuitUp/artifacts](https://github.com/SupersuitUp/artifacts). `npm test` runs the suite,
`npm run build` compiles, and `npm run test:packed` builds and serves a small Next.js app from
the packed tarball. A behaviour change comes with its test in the same pull request.

## License

MIT
