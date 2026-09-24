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
| `parseArtifactSource` | The front-matter contract, as a parser you can call before publishing |
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

### Two things your build config must know

- **Tailwind**: the shell's markup uses Tailwind classes, so add the package to `content`:
  `'./node_modules/@supersuit/artifacts/lib/**/*.js'`.
- **The share-card font** ships at `node_modules/@supersuit/artifacts/fonts/`. The loader
  finds it from `process.cwd()`, and Next's tracer carries it into the deploy. If your app's
  working directory is not its project root (some monorepos), add it yourself:
  `outputFileTracingIncludes: { '/[id]/share.png': ['./node_modules/@supersuit/artifacts/fonts/**'] }`.

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
`npm run build` compiles, and `npm run test:packed` proves the packed tarball works from a
host-shaped `node_modules`. A behaviour change comes with its test in the same pull request.

## License

MIT
