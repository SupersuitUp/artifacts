// The artifacts routes, built once per instance from its config. An instance's
// app/a/[id]/page.tsx and app/api/artifacts/*/route.ts are one-line re-exports of
// what this returns, so the shell owns the behaviour and the instance owns only
// the wiring: which store, which brand, which domain, which key.
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'
import { isPublisherAuthed } from '../artifacts/auth.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { narrationText } from '../artifacts/narration.js'
import { ArtifactMarkdown } from '../artifacts/render.js'
import { ArtifactDoor } from '../artifacts/door.js'
import { isUnlocked, keyHash, unlockCookieName } from '../artifacts/unlock.js'
import { cleanNote, type ArtifactRecord, type ArtifactStore, type VersionEntry } from '../artifacts/store.js'
import { effectiveWriters, shapeChanges } from '../artifacts/state.js'
import { COMMENTS_SLOT, type CommentsMode } from '../artifacts/comments.js'
import type { StateStore } from '../artifacts/state-store.js'
import { ASSET_DIGEST, ASSET_NAME, contentTypeFor, type ArtifactAssets } from '../artifacts/assets.js'
import { BrandGround } from '../brand/wrapper.js'
import { themedPack } from '../brand/theme.js'
import { showToc, tocOf, TocInline, TocRail } from '../artifacts/toc.js'
import { renderShareCard } from '../brand/share-card.js'
import type { BrandPack } from '../brand/pack.js'
import { ArtifactReader, type WordTiming } from '../reader/artifact-reader.js'
import { CommentLayer } from '../reader/comment-layer.js'
import { ReaderWatch } from '../reader/reader-watch.js'
import { UpdatedTime } from '../reader/updated-time.js'
import { VersionHistory } from '../reader/version-history.js'
import {
  ACCESS_LEVELS, GRANT_COOKIE, GRANT_TTL_SECONDS, decide, firstName, mintGrant, safeReturnPath, signInUrl, verifyGrant, verifyPass,
  type Access, type Reader,
} from '../artifacts/reader.js'
import { FLAG_KINDS, summarize, type FlagKind, type ReadersStore } from '../artifacts/readers-store.js'
import { AckDoor, ConfidentialBanner, NO_PRINT_CSS, NotAllowedDoor, SignInDoor, Watermark, ackText } from '../artifacts/confidential.js'
import { ARTIFACT_ID_RE } from './ids.js'
import { createStateRoutes } from './state-routes.js'
import { createPersonalRoutes } from './personal-routes.js'
import { createVoiceRoutes } from './voice-routes.js'
import type { PersonalStore } from '../artifacts/personal-store.js'
import type { Transcriber } from '../artifacts/transcribe.js'

export type ArtifactRoutesConfig = {
  store: ArtifactStore
  /** Where readers' answers live. Without it every state route answers 501. */
  state?: StateStore
  /** Where signed-in readers' personal notes live. Read ONLY by the reader's own /personal
   *  handlers, never by any publisher route. Without it every reader's notes stay on their device. */
  personal?: PersonalStore
  /** Where uploaded files go. Optional; without it PUT_ASSET answers 501. */
  assets?: ArtifactAssets
  brand: BrandPack
  /** Other packs a page may choose by name with `pack: <name>` in its front matter. A name this
   *  host does not know falls back to `brand`, so a page never fails to render over its look. */
  packs?: Record<string, BrandPack>
  /** Choose a page's pack on the host, ahead of its front matter: for a page whose file cannot
   *  carry the line, or a look the host decides. Undefined means no opinion. */
  packFor?: (artifact: ArtifactRecord) => BrandPack | undefined
  /** The host that serves a 200, e.g. https://artifacts.example.com. No trailing slash. */
  siteUrl: string
  /** Read at request time, so a rotated key needs no rebuild. */
  publishKey: () => string | undefined
  /** Verifies publisher passes (`p1`, see artifacts/publisher.ts): a signed, hour-long stand-in
   *  for the publish key, minted for one person by an authority that knows who may publish here.
   *  Read at request time. Without it, or without `publisherHost`, passes are refused. */
  publisherSecret?: () => string | undefined
  /** The hostname a publisher pass must name, e.g. artifacts.example.com. Set it only on a host
   *  that opts in to passes. */
  publisherHost?: string
  /** Share image when an artifact has no cover. Absolute or site-relative. */
  defaultShareImage?: string
  /** Where a page lives under the origin. '/' on a dedicated host (artifacts.<name>/<id>);
   *  '/a/' when the instance is a route inside a larger site. Default '/'. */
  pagePrefix?: string
  /** Read one request cookie by name. Default reads through next/headers; tests inject one. */
  readCookie?: (name: string) => Promise<string | undefined>
  /** The record for gated pages (`access:` in front matter). Without it a gated page stays shut
   *  to everyone, never open: failing closed is the only safe default for a confidential page. */
  readers?: ReadersStore
  /** Shared with the sign-in authority, which mints the pass. Read at request time. */
  readerSecret?: () => string | undefined
  /** The sign-in authority's origin; readers go to `<signInOrigin>/artifact/sign-in?to=<page>`.
   *  No default: without it a gated page shows its door with no way through (fails closed). */
  signInOrigin?: string
  /** The line on the sign-in door, for a host whose readers do not sign in with a Freedom
   *  account. Default names the Freedom account. */
  signInNote?: string
  /** Who the banner says grants access, e.g. "Example Co". Default the brand name. */
  owner?: string
  /** The address the state routes' rate limit counts by. Default reads the first hop of
   *  `x-forwarded-for`, which is correct on Vercel (it overwrites XFF with the real client IP)
   *  and wrong behind any other proxy that appends rather than replaces; pass this there. */
  clientIp?: (req: NextRequest) => string
  /** The page owner's sign-in email. Signed in as them, a page shows every shared comment with
   *  its writer's name, whatever `comments_visible:` says. Without it nobody is the owner, and
   *  the publisher reads comments through /responses. */
  ownerEmail?: string
  /** Turns a reader's voice memo into text on the server, so the service's key never reaches a
   *  browser: `deepgramTranscriber(key)` or `openaiTranscriber(key)` from `./artifacts`, or your
   *  own. Without it the transcribe route answers 404 and readers get the browser's live
   *  transcript, or an empty box to type into. */
  transcribe?: Transcriber
}

/** Ids are 8 chars from the safe alphabet; anything else is not a page and never reaches the store. */
export const ARTIFACT_ID = ARTIFACT_ID_RE

type Params = { params: Promise<{ id: string }> }
type PageProps = Params & { searchParams?: Promise<{ key?: string | string[] }> }
type VersionParams = { params: Promise<{ id: string; n: string }> }
type VersionProps = VersionParams & { searchParams?: Promise<{ key?: string | string[] }> }
type Rec = NonNullable<Awaited<ReturnType<ArtifactStore['get']>>>
/** A version number as it appears in a URL: no zero, no leading zero, so each version has one address. */
const VERSION_N = /^[1-9]\d{0,5}$/

async function defaultReadCookie(name: string): Promise<string | undefined> {
  const { cookies } = await import('next/headers')
  return (await cookies()).get(name)?.value
}

export function createArtifactRoutes(config: ArtifactRoutesConfig) {
  const { store, siteUrl } = config
  // The pack as configured draws the share card; the page paints with its theme variables, so a
  // page follows its light, dark or system mode (brand/theme.ts).
  const pack = config.brand
  const brand = themedPack(pack)
  /** The pack one page renders in: the host's choice, then the page's `pack:`, then the default. */
  const looks = new Map<BrandPack, { pack: BrandPack; brand: BrandPack }>()
  function lookOf(a: ArtifactRecord): { pack: BrandPack; brand: BrandPack } {
    const p = config.packFor?.(a) ?? (a.pack ? config.packs?.[a.pack] : undefined) ?? pack
    let l = looks.get(p)
    if (!l) looks.set(p, (l = { pack: p, brand: themedPack(p) }))
    return l
  }
  const prefix = config.pagePrefix ?? '/'
  const pageUrl = (id: string) => `${siteUrl}${prefix}${id}`
  const pagePath = (id: string) => `${prefix}${id}`
  const absolute = (p?: string) => (p ? (/^https?:\/\//.test(p) ? p : `${siteUrl}${p}`) : undefined)
  // The version in the URL is what makes a re-publish show up: every unfurler caches by URL.
  const signInOrigin = config.signInOrigin
  const owner = config.owner ?? brand.name
  const ownerEmail = config.ownerEmail?.trim().toLowerCase()
  const readerSecret = () => config.readerSecret?.()
  const signOutUrl = (id: string) => `/api/reader/leave?to=${encodeURIComponent(pagePath(id))}`
  // Signing out alone cannot change the account: the authority still holds the Google session
  // and vouches for it again on the next sign-in. This leaves AND sends them to choose one.
  const switchUrl = (id: string) => (signInOrigin ? `${signOutUrl(id)}&switch=1` : signOutUrl(id))
  const shareCardUrl = (id: string, updatedAt: string) => `${pageUrl(id)}/share.png?v=${encodeURIComponent(updatedAt)}`
  // Readers' recordings are played through short-lived signed URLs, issued only beside the comment
  // or note they belong to; a host whose assets cannot sign them shows no play control.
  const audioUrl = config.assets?.audioUrl ? (id: string, path: string) => config.assets!.audioUrl!(id, path) : undefined
  const publishAuth = { publishKey: config.publishKey, publisherSecret: config.publisherSecret, publisherHost: config.publisherHost }
  const authed = (request: Request) => isPublisherAuthed(request, publishAuth)
  const stateRoutes = createStateRoutes({
    store, state: config.state, readers: config.readers, readerSecret, publishKey: config.publishKey,
    publisherSecret: config.publisherSecret, publisherHost: config.publisherHost, pageUrl, signInOrigin, siteUrl,
    clientIp: config.clientIp, ownerEmail: config.ownerEmail, audioUrl,
  })
  const personalRoutes = createPersonalRoutes({ store, personal: config.personal, readers: config.readers, readerSecret, pageUrl, signInOrigin, siteUrl, audioUrl })
  const voiceRoutes = createVoiceRoutes({
    store, state: config.state, personal: config.personal, readers: config.readers, assets: config.assets, transcribe: config.transcribe,
    readerSecret, pageUrl, signInOrigin, siteUrl, clientIp: config.clientIp,
  })

  /** The kicker over every title: the pack's line, then who the page is for. Never spoken: the
   *  whole paragraph is data-nospeak, and narrationText has no `to` to read. */
  function Kicker({ to, brand }: { to?: string; brand: BrandPack }) {
    return (
      <p data-nospeak className="mb-4 text-[11px] font-medium uppercase tracking-[0.3em]" style={{ color: brand.accent }}>
        {brand.kicker}
        {to ? <span data-nospeak data-to>{` · For ${to}`}</span> : null}
      </p>
    )
  }

  async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) return { title: 'Not found', robots: { index: false, follow: false } }
    const url = pageUrl(a.id)
    const { brand } = lookOf(a)
    const image = absolute(a.cover) ?? (brand.share ? shareCardUrl(a.id, a.updatedAt) : absolute(config.defaultShareImage))
    // Who it is for leads the unfurl, so a thread shows it before the reader opens anything.
    const title = a.to ? `For ${a.to}: ${a.title}` : a.title
    return {
      title,
      description: a.summary,
      alternates: { canonical: pagePath(a.id) },
      robots: { index: false, follow: false },
      openGraph: {
        title,
        description: a.summary,
        url,
        siteName: brand.name,
        type: 'article',
        ...(image ? { images: [{ url: image, alt: a.cover ? a.title : brand.name }] } : {}),
      },
      twitter: {
        card: image ? 'summary_large_image' : 'summary',
        title,
        description: a.summary,
        ...(image ? { images: [image] } : {}),
      },
    }
  }

  /** GET /<id>/v/<n>: the metadata of a past version. Never indexed, like every page. */
  async function generateVersionMetadata({ params }: VersionParams): Promise<Metadata> {
    const { id, n } = await params
    const m = await generateMetadata({ params: Promise.resolve({ id }) })
    if (!VERSION_N.test(n) || m.title === 'Not found') return { title: 'Not found', robots: { index: false, follow: false } }
    return { ...m, title: `${String(m.title)} (version ${n})`, alternates: { canonical: `${pagePath(id)}/v/${n}` } }
  }

  async function Page({ params, searchParams }: PageProps) {
    const { id } = await params
    return serve(id, searchParams, null)
  }

  /** /<id>/v/<n>: one past version, read-only, behind exactly the door the current page has. */
  async function VersionPage({ params, searchParams }: VersionProps) {
    const { id, n } = await params
    if (!VERSION_N.test(n)) notFound()
    return serve(id, searchParams, Number(n))
  }

  /** The current page (n null) or one past version, through the same gate. The version is looked
   *  up only AFTER the gate opens, so a shut page never says which versions exist. */
  async function serve(id: string, searchParams: PageProps['searchParams'], n: number | null) {
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) notFound()
    const { pack, brand } = lookOf(a)
    const render = (top: boolean, reader: Reader | null) => (n === null ? Body(a, { top, reader }) : VersionBody(a, n, { top }))
    if (a.access) return GatedPage(a, id, render, n)
    // A password shuts the body, never the title: the header stays so the reader knows which
    // page they were sent, and the unfurl (generateMetadata) keeps reading as the page.
    const sp = (await searchParams) ?? {}
    const key = Array.isArray(sp.key) ? sp.key[0] : sp.key
    const readCookie = config.readCookie ?? defaultReadCookie
    const cookie = a.password ? await readCookie(unlockCookieName(id)) : undefined
    const open = isUnlocked({ id, password: a.password, key, cookie })
    // Opened by the key in the URL: remember it in a cookie holding the hash, never the
    // password, scoped to this page, so a refresh or a shared device does not ask again.
    // The same cookie again on the page's state API: a cookie scoped to the page path is never
    // sent to /api/artifacts/<id>/state, so without it a password page could not take answers.
    const unlockLine = (path: string) => `${unlockCookieName(id)}=${keyHash(id, a.password!)}; Path=${path}; Max-Age=31536000; SameSite=Lax; Secure`
    // The API copy is set on EVERY open of a page with state: (or on a host keeping personal notes,
    // which every page takes), because the page cannot see it (a
    // cookie scoped to /api/... never reaches the page path): a reader who unlocked the page
    // before its API cookie existed would otherwise be refused every answer until they reopened
    // the ?key= link.
    const paths = !open || !a.password ? [] : [
      ...(key !== undefined && cookie !== keyHash(id, a.password) ? [pagePath(id)] : []),
      ...(a.state || config.personal ? [`/api/artifacts/${id}`] : key !== undefined && cookie !== keyHash(id, a.password) ? [`/api/artifacts/${id}`] : []),
    ]
    const remember = paths.length ? paths.map((p) => `document.cookie=${JSON.stringify(unlockLine(p))}`).join(';') : null
    if (!open) {
      return (
        <BrandGround pack={pack} mode={a.theme}>
          <div className="mx-auto max-w-2xl px-6 pt-24 pb-8 text-center sm:pt-28">
            <Kicker to={a.to} brand={brand} />
            <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
              {a.title}
            </h1>
            {a.subtitle ? (
              <p className="mx-auto mt-4 max-w-xl text-xl sm:text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                {a.subtitle}
              </p>
            ) : null}
            <p className="mx-auto mt-6 max-w-xl text-lg italic opacity-80">{a.summary}</p>
          </div>
          <ArtifactDoor brand={brand} wrongKey={key !== undefined} />
        </BrandGround>
      )
    }
    // Who is reading an open page, when they happen to be signed in: their comments follow them.
    // Only a host that signs readers in can know one; the read never fails the page.
    const reader = readerSecret() ? verifyGrant(readerSecret(), await readCookie(GRANT_COOKIE).catch(() => undefined)) : null
    const page = await render(true, reader)
    if (n === null) void store.bumpViews(id)
    return (
      <BrandGround pack={pack} mode={a.theme}>
        {remember ? <script dangerouslySetInnerHTML={{ __html: remember }} /> : null}
        {page}
      </BrandGround>
    )
  }

  /** A page with `access:`. The body is rendered only after the reader is known and allowed;
   *  everyone else gets the title, the summary, and a door. */
  async function GatedPage(a: Rec, id: string, render: (top: boolean, reader: Reader | null) => Promise<React.ReactNode>, n: number | null) {
    const { pack, brand } = lookOf(a)
    const here = n === null ? pageUrl(id) : `${pageUrl(id)}/v/${n}`
    const readCookie = config.readCookie ?? defaultReadCookie
    // Only a host that signs readers in can know one; the read never fails the page.
    const reader = readerSecret() ? verifyGrant(readerSecret(), await readCookie(GRANT_COOKIE).catch(() => undefined)) : null
    const allow = config.readers && reader ? await config.readers.allowList(id) : []
    const d = config.readers ? decide(a.access!, reader, allow) : ({ open: false, why: 'signed-out' } as const)
    const header = (
      <div className="mx-auto max-w-2xl px-6 pt-24 pb-8 text-center sm:pt-28">
        <Kicker to={a.to} brand={brand} />
        <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
          {a.title}
        </h1>
        {a.subtitle ? (
          <p className="mx-auto mt-4 max-w-xl text-xl sm:text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
            {a.subtitle}
          </p>
        ) : null}
        <p className="mx-auto mt-6 max-w-xl text-lg italic opacity-80">{a.summary}</p>
      </div>
    )
    if (!d.open) {
      if (d.why === 'not-allowed' && config.readers) void config.readers.flag({ artifactId: id, reader: d.reader, kind: 'refused' }).catch(() => {})
      return (
        <BrandGround pack={pack} mode={a.theme}>
          {header}
          {d.why === 'not-allowed'
            ? <NotAllowedDoor brand={brand} reader={d.reader} signOutUrl={switchUrl(id)} />
            : <SignInDoor brand={brand} href={signInOrigin ? signInUrl(signInOrigin, here) : undefined} note={config.signInNote} />}
        </BrandGround>
      )
    }
    const r = reader as Reader
    // The agreement comes before the body, every reader, once per page. No agreement, no body.
    if (config.readers && !(await config.readers.acknowledged(id, r.email))) {
      return (
        <BrandGround pack={pack} mode={a.theme}>
          {header}
          <AckDoor brand={brand} name={firstName(r, allow)} email={r.email} owner={owner} pageId={id} signOutUrl={switchUrl(id)} />
        </BrandGround>
      )
    }
    const page = await render(false, r)
    if (n === null) void store.bumpViews(id)
    return (
      <BrandGround pack={pack} mode={a.theme}>
        <style dangerouslySetInnerHTML={{ __html: NO_PRINT_CSS }} />
        <Watermark email={r.email} />
        {/* Padding, never a margin: a top margin here collapses through the ground and leaves a
            white strip above the page (seen live 2026-09-24). */}
        <div className="px-6 pt-20 sm:pt-24">
          <ConfidentialBanner name={firstName(r, allow)} email={r.email} reason={d.reason} owner={owner} brand={brand} signOutUrl={switchUrl(id)} />
        </div>
        {page}
        <ReaderWatch artifactId={id} endpoint="/api/reader/track" accent={brand.accent} />
      </BrandGround>
    )
  }

  /** Every version of a page, newest first, or null when the store keeps none. A failed read hides
   *  the History control rather than failing the page. */
  async function historyOf(id: string): Promise<VersionEntry[] | null> {
    if (!store.history) return null
    return store.history(id).catch(() => null)
  }

  /** "Version N · Updated <minute> · History": the line under the summary. */
  function VersionLine({ a, n, at, history }: { a: Rec; n: number; at: string; history: VersionEntry[] | null }) {
    return (
      <p data-nospeak className="mt-4 text-xs opacity-60">
        {`Version ${n} · Updated `}<UpdatedTime iso={at} />
        {history && history.length > 1 ? (
          <>
            {' · '}
            <VersionHistory items={history} base={pagePath(a.id)} viewing={n} />
          </>
        ) : null}
      </p>
    )
  }

  /** The title block and the body, in the pack's Article when it has one. Without one this is
   *  exactly the markup every page had before packs could frame it. */
  function Framed({ pack, cover, toc, children }: { pack: BrandPack; cover: React.ReactNode; toc: React.ReactNode; children: React.ReactNode }) {
    if (pack.Article) return <pack.Article cover={cover} toc={toc}>{children}</pack.Article>
    return (
      <>
        {cover}
        <article className="mx-auto max-w-2xl px-6 pb-24">
          {toc}
          {children}
        </article>
      </>
    )
  }

  /** A past version: its own body and title, read-only (no narration, no answers), under a banner. */
  async function VersionBody(a: Rec, n: number, { top }: { top: boolean }) {
    const { pack, brand } = lookOf(a)
    const v = store.version ? await store.version(a.id, n) : null
    if (!v) notFound()
    if (v.current) redirect(pagePath(a.id))
    const history = await historyOf(a.id)
    const of = history?.[0]?.version ?? n
    const title = v.title ?? a.title
    const summary = v.summary ?? a.summary
    const toc = showToc(v.markdown, a.toc) ? tocOf(v.markdown) : []
    return (
      <>
        {toc.length ? <TocRail items={toc} /> : null}
        <div data-nospeak className={`mx-auto max-w-2xl px-6 ${top ? 'pt-20 sm:pt-24' : 'pt-8'}`}>
          <p data-version-banner role="status" className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: brand.accent }}>
            {`You are reading version ${n} of ${of}. `}
            <a href={pagePath(a.id)} className="underline underline-offset-4" style={{ color: brand.accent }}>Read the current version</a>
          </p>
        </div>
        <Framed
          pack={pack}
          toc={toc.length ? <TocInline items={toc} /> : null}
          cover={pack.Cover ? (
            <pack.Cover
              title={title} subtitle={v.subtitle} summary={summary} to={v.to} markdown={v.markdown}
              kicker={<Kicker to={v.to} brand={brand} />} meta={<VersionLine a={a} n={n} at={v.at} history={history} />}
              version={n} updatedAt={v.at} createdAt={a.createdAt}
            />
          ) : (
            <div className={`mx-auto max-w-2xl px-6 ${top ? 'pt-10 sm:pt-12' : 'pt-10'} pb-8 text-center`}>
              <Kicker to={v.to} brand={brand} />
              <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                {title}
              </h1>
              {v.subtitle ? (
                <p className="mx-auto mt-4 max-w-xl text-xl sm:text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                  {v.subtitle}
                </p>
              ) : null}
              <p className="mx-auto mt-6 max-w-xl text-lg italic opacity-80">{summary}</p>
              <VersionLine a={a} n={n} at={v.at} history={history} />
            </div>
          )}
        >
          <ArtifactMarkdown markdown={v.markdown} definitions={a.definitions} Section={pack.Section} figure={pack.figure} />
        </Framed>
      </>
    )
  }

  /** The page itself, shared by open and gated pages. */
  async function Body(a: Rec, { top, reader }: { top: boolean; reader: Reader | null }) {
    const { pack, brand } = lookOf(a)
    let words: WordTiming[] = []
    if (a.narration && a.timings) {
      try {
        const r = await fetch(a.timings, { next: { revalidate: 3600 } })
        if (r.ok) words = ((await r.json()) as { words: WordTiming[] }).words ?? []
      } catch {
        words = []
      }
    }
    const toc = showToc(a.markdown, a.toc) ? tocOf(a.markdown) : []
    // Shared comments need the page to take them AND a host that keeps answers; personal notes need neither.
    const mode: CommentsMode = config.state && a.state && a.comments && a.comments !== 'off' && a.state.slots[COMMENTS_SLOT] ? a.comments : 'off'
    return (
      <>
        {toc.length ? <TocRail items={toc} /> : null}
        <div id="artifact-narration-root">
          {await (async () => {
            const n = a.version ?? (a.versions?.length ?? 0) + 1
            const meta = (
              <>
                <VersionLine a={a} n={n} at={a.updatedAt} history={await historyOf(a.id)} />
                {/* An open page has no banner, so this is the only place a signed-in reader learns
                    which account they are in and how to get out of it. A gated page's banner says it. */}
                {top && reader ? (
                  <p data-nospeak data-reader-line className="mt-2 text-xs opacity-60">
                    {`Signed in as ${reader.email} · `}
                    <a href={switchUrl(a.id)} className="underline">Use a different account</a>
                    {' · '}
                    <a href={signOutUrl(a.id)} className="underline">Sign out</a>
                  </p>
                ) : null}
              </>
            )
            const header = pack.Cover ? (
              <pack.Cover
                title={a.title} subtitle={a.subtitle} summary={a.summary} to={a.to} markdown={a.markdown}
                kicker={<Kicker to={a.to} brand={brand} />} meta={meta}
                version={n} updatedAt={a.updatedAt} createdAt={a.createdAt}
              />
            ) : (
              <div className={`mx-auto max-w-2xl px-6 ${top ? 'pt-24 sm:pt-28' : 'pt-12'} pb-8 text-center`}>
                <Kicker to={a.to} brand={brand} />
                <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                  {a.title}
                </h1>
                {a.subtitle ? (
                  <p className="mx-auto mt-4 max-w-xl text-xl sm:text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                    {a.subtitle}
                  </p>
                ) : null}
                <p className="mx-auto mt-6 max-w-xl text-lg italic opacity-80">{a.summary}</p>
                {meta}
              </div>
            )
            return (
              <Framed
                pack={pack}
                toc={toc.length ? <TocInline items={toc} /> : null}
                cover={
                  <>
                    {header}
                    {a.cover ? (
                      <div className="mx-auto max-w-2xl px-6 pb-8">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.cover} alt="" className="w-full rounded-xl border border-[color:var(--a-line)]" />
                      </div>
                    ) : null}
                  </>
                }
              >
                <ArtifactMarkdown
                  markdown={a.markdown}
                  definitions={a.definitions}
                  notes={config.state && a.state ? { artifactId: a.id, accent: brand.accent } : undefined}
                  Section={pack.Section}
                  figure={pack.figure}
                />
              </Framed>
            )
          })()}
        </div>
        <CommentLayer
          artifactId={a.id}
          rootId="artifact-narration-root"
          ownerName={owner}
          comments={mode}
          canShare={mode !== 'off' && (reader !== null || effectiveWriters(a.state!, a.access, COMMENTS_SLOT) === 'anyone')}
          signedIn={reader !== null}
          isOwner={!!reader && !!ownerEmail && reader.email === ownerEmail}
          version={a.version ?? (a.versions?.length ?? 0) + 1}
          accent={brand.accent}
          ground={brand.ground}
          signIn={signInOrigin ? signInUrl(signInOrigin, pageUrl(a.id)) : null}
        />
        {a.narration && words.length > 0 ? (
          <ArtifactReader
            src={a.narration}
            words={words}
            rootId="artifact-narration-root"
            label={brand.narratorLabel(a.voice)}
            accent={brand.accent}
            ground={brand.ground}
          />
        ) : null /* No recorded narration: no player. Never the browser's own voice (the operator,
          2026-09-29: "NEVER PUT DEFAULT SAFARI VOICE DICTATION"); the audio is Kokoro or ElevenLabs,
          recorded at publish, or there is none. */}
      </>
    )
  }

  const cookieLine = (value: string, maxAge: number) =>
    `${GRANT_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`

  /** GET /api/reader/enter?pass=<pass>&to=/<id>: where the sign-in authority sends a signed-in
   *  reader. Swaps the five-minute pass for this host's grant and lands them on the page, with
   *  the pass gone from the address bar. A bad pass lands them on the page's door again. */
  async function ENTER(request: NextRequest) {
    const to = safeReturnPath(request.nextUrl.searchParams.get('to'), prefix)
    if (!to) return NextResponse.json({ error: 'to must be a page on this host' }, { status: 400 })
    const secret = readerSecret()
    const reader = verifyPass(secret, request.nextUrl.searchParams.get('pass'))
    const res = NextResponse.redirect(`${siteUrl}${to}`, 303)
    res.headers.set('cache-control', 'no-store')
    if (reader && secret) res.headers.append('set-cookie', cookieLine(mintGrant(secret, reader), GRANT_TTL_SECONDS))
    return res
  }

  /** GET /api/reader/leave?to=/<id>[&switch=1]: sign out of this host's pages. With switch=1 it
   *  goes on to the authority's account chooser, which is the only way the account changes. */
  async function LEAVE(request: NextRequest) {
    const to = safeReturnPath(request.nextUrl.searchParams.get('to'), prefix) ?? '/'
    const switching = request.nextUrl.searchParams.get('switch') === '1' && !!signInOrigin && to !== '/'
    const res = NextResponse.redirect(switching ? signInUrl(signInOrigin!, `${siteUrl}${to}`, { switchAccount: true }) : `${siteUrl}${to}`, 303)
    res.headers.set('cache-control', 'no-store')
    res.headers.append('set-cookie', cookieLine('', 0))
    return res
  }

  /** POST /api/reader/ack: the reader agrees to keep the page confidential. A plain form post
   *  from AckDoor; records the exact wording and lands them on the page. Only a reader the page
   *  is open to can agree, and only with the box ticked. */
  async function ACK(request: NextRequest) {
    const form = await request.formData().catch(() => null)
    const id = String(form?.get('id') ?? '')
    if (!ARTIFACT_ID.test(id)) return NextResponse.json({ error: 'no page' }, { status: 400 })
    const back = NextResponse.redirect(`${siteUrl}${pagePath(id)}`, 303)
    if (!config.readers || form?.get('agree') !== 'yes') return back
    const reader = verifyGrant(readerSecret(), request.cookies.get(GRANT_COOKIE)?.value)
    const a = await store.get(id)
    if (!reader || !a?.access) return back
    if (!decide(a.access, reader, await config.readers.allowList(id)).open) return back
    await config.readers.acknowledge({ artifactId: id, reader, text: ackText(owner), country: request.headers.get('x-vercel-ip-country') ?? undefined })
    return back
  }

  /** POST /api/reader/track: the reading heartbeat and the flags, from ReaderWatch. Recorded
   *  only for a reader the page is open to right now, so the record cannot be written into by
   *  anyone the page would refuse. */
  async function TRACK(request: NextRequest) {
    if (!config.readers) return new NextResponse(null, { status: 204 })
    const reader = verifyGrant(readerSecret(), request.cookies.get(GRANT_COOKIE)?.value)
    if (!reader) return new NextResponse(null, { status: 401 })
    const raw = await request.text()
    if (raw.length > 2048) return new NextResponse(null, { status: 413 })
    let b: Record<string, unknown>
    try { b = JSON.parse(raw) } catch { return new NextResponse(null, { status: 400 }) }
    const id = String(b.id ?? '')
    const session = String(b.session ?? '')
    if (!ARTIFACT_ID.test(id) || !/^[A-Za-z0-9-]{8,64}$/.test(session)) return new NextResponse(null, { status: 400 })
    const a = await store.get(id)
    if (!a?.access) return new NextResponse(null, { status: 404 })
    if (!decide(a.access, reader, await config.readers.allowList(id)).open) return new NextResponse(null, { status: 403 })
    const country = request.headers.get('x-vercel-ip-country') ?? undefined
    if (b.kind === 'beat') {
      const add = Math.max(0, Math.min(60, Math.round(Number(b.active) || 0)))
      const scroll = Math.max(0, Math.min(100, Math.round(Number(b.scroll) || 0)))
      const device = /Mobi|Android|iPhone|iPad/i.test(request.headers.get('user-agent') ?? '') ? 'mobile' : 'desktop'
      await config.readers.touchSession({ artifactId: id, session, reader, addSeconds: add, scroll, device, country })
      return new NextResponse(null, { status: 204 })
    }
    if (b.kind === 'flag' && FLAG_KINDS.includes(b.flag as FlagKind) && b.flag !== 'refused') {
      const detail = typeof b.detail === 'string' ? b.detail.slice(0, 80) : undefined
      await config.readers.flag({ artifactId: id, reader, kind: b.flag as FlagKind, detail, country })
      return new NextResponse(null, { status: 204 })
    }
    return new NextResponse(null, { status: 400 })
  }

  /** GET|POST /api/artifacts/<id>/access, publish key: the page's level and its list.
   *  POST body: { access?: 'freedom'|'invite'|'public', add?: [{ email, name?, reason? }], remove?: [email] }. */
  async function ACCESS(request: NextRequest, { params }: Params) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!config.readers) return NextResponse.json({ error: 'this host keeps no reader record' }, { status: 501 })
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (request.method === 'GET') return NextResponse.json({ id, access: a.access ?? null, readers: await config.readers.allowList(id) })
    const b = (await request.json().catch(() => null)) as { add?: unknown; remove?: unknown; access?: unknown } | null
    let access = a.access ?? null
    if (b?.access !== undefined) {
      if (b.access !== 'public' && !ACCESS_LEVELS.includes(b.access as Access))
        return NextResponse.json({ error: `access must be one of: public, ${ACCESS_LEVELS.join(', ')}` }, { status: 400 })
      if (!store.setAccess) return NextResponse.json({ error: 'this store cannot change access' }, { status: 501 })
      await store.setAccess(id, b.access as Access | 'public')
      access = b.access === 'public' ? null : (b.access as Access)
    }
    const add = Array.isArray(b?.add) ? b!.add : []
    const remove = Array.isArray(b?.remove) ? b!.remove : []
    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    for (const e of add) {
      if (!e || typeof e !== 'object' || typeof (e as { email?: unknown }).email !== 'string' || !EMAIL.test((e as { email: string }).email.trim()))
        return NextResponse.json({ error: 'each add needs a valid email' }, { status: 400 })
    }
    if (!remove.every((e) => typeof e === 'string')) return NextResponse.json({ error: 'remove is a list of emails' }, { status: 400 })
    const readers = await config.readers.allow(id, add as { email: string; name?: string; reason?: string }[], remove as string[])
    return NextResponse.json({ id, access, readers })
  }

  /** GET /api/artifacts/<id>/reads, publish key: who read it, for how long, how far, and every
   *  attempt to take it away or to open it without being let in. */
  async function READS(request: NextRequest, { params }: Params) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!config.readers) return NextResponse.json({ error: 'this host keeps no reader record' }, { status: 501 })
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    const [sessions, flags, acks] = await Promise.all([config.readers.sessions(id), config.readers.flags(id), config.readers.acks(id)])
    return NextResponse.json({ id, title: a.title, access: a.access ?? null, views: a.views, ...summarize(sessions, flags), acks: acks.map((k) => ({ email: k.email, name: k.name, at: k.at })) }, { headers: { 'cache-control': 'no-store' } })
  }

  async function POST(request: NextRequest) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const text = await request.text()
    const parsed = parseArtifactSource(text)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const id = request.nextUrl.searchParams.get('id') ?? parsed.meta.id ?? undefined
    if (id && parsed.meta.state) {
      const existing = await store.get(id)
      const changed = shapeChanges(existing?.state, parsed.meta.state)
      if (changed.length) return NextResponse.json({ error: changed.join('; ') }, { status: 400 })
      // The declared shape can be dodged by republishing once with `state` omitted (which clears
      // it) and then again with the slot's shape flipped: `existing.state` reads as undefined at
      // that final publish, so the check above sees nothing to compare against. The ANSWERS
      // never went anywhere, so the truth is in what is actually stored, not in the file.
      if (config.state) {
        const shapeOf = new Map<string, string>()
        for (const e of await config.state.entries(id)) if (!shapeOf.has(e.slot)) shapeOf.set(e.slot, e.shape)
        const dodged: string[] = []
        for (const [name, def] of Object.entries(parsed.meta.state.slots)) {
          const was = shapeOf.get(name)
          if (was && was !== def.shape) dodged.push(`slot "${name}" changed shape from ${was} to ${def.shape}; rename the slot instead`)
        }
        if (dodged.length) return NextResponse.json({ error: dodged.join('; ') }, { status: 400 })
      }
    }
    // What changed, in the author's words: `?note=` from the publisher, else the file's `change:`.
    // `?amend=1` is the publisher finishing the publish it started (image URLs, then narration).
    const note = cleanNote(request.nextUrl.searchParams.get('note')) ?? parsed.meta.change
    const amend = request.nextUrl.searchParams.get('amend') === '1'
    const result = await store.save({ id, meta: parsed.meta, markdown: parsed.body, note, amend })
    if ('notFound' in result) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    revalidatePath(pagePath(result.id))
    return NextResponse.json(
      {
        id: result.id, url: pageUrl(result.id), version: result.version,
        ...(parsed.meta.state && !config.state ? { warning: 'this host keeps no answers; state: is stored but inert' } : {}),
      },
      { status: result.created ? 201 : 200 },
    )
  }

  async function GET(request: NextRequest, { params }: Params) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const a = await store.get(id)
    if (!a) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    return NextResponse.json({ id, text: narrationText({ title: a.title, subtitle: a.subtitle, summary: a.summary, markdown: a.markdown }) })
  }

  /** PUT /api/artifacts/<id>/assets/<name>: raw bytes in, public URL out. 16 MiB cap. */
  async function PUT_ASSET(request: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!config.assets) return NextResponse.json({ error: 'this host does not store assets' }, { status: 501 })
    const { id, name } = await params
    if (!ARTIFACT_ID.test(id)) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (!(await store.get(id))) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (!ASSET_NAME.test(name)) return NextResponse.json({ error: 'asset name must be one path segment: letters, digits, dot, dash, underscore' }, { status: 400 })
    const type = contentTypeFor(name)
    if (!type) return NextResponse.json({ error: 'asset type not allowed; use webp, png, jpg, gif, mp3, mp4 or json' }, { status: 415 })
    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length === 0) return NextResponse.json({ error: 'empty body' }, { status: 400 })
    if (bytes.length > 16 * 1024 * 1024) return NextResponse.json({ error: 'asset over 16 MiB' }, { status: 413 })
    const url = await config.assets.put(id, name, bytes, type)
    return NextResponse.json({ id, name, url }, { status: 201 })
  }

  /**
   * POST /api/artifacts/<id>/uploads/<name> with `{ digest }`: a signed URL to PUT a big file to
   * directly, because a route handler cannot take one (Vercel caps a body at 4.5 MB). Then the
   * same call with `{ digest, done: true }` makes it readable and returns its URL; 409 when the
   * bytes never arrived. 501 on a host whose assets cannot sign, so the publisher falls back.
   */
  async function UPLOAD(request: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
    const raw = await request.text().catch(() => '')
    let body: { digest?: unknown; done?: unknown; audio?: unknown } = {}
    try {
      const parsed: unknown = raw.length <= 4096 ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as typeof body
    } catch {
      body = {}
    }
    // A reader's voice memo: the reader's own doors, never the publish key (voice-routes.ts).
    if (body.audio !== undefined) {
      const { id, name } = await params
      return voiceRoutes.readerUpload(request, id, name, body)
    }
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const assets = config.assets
    if (!assets?.signUpload || !assets.finishUpload) return NextResponse.json({ error: 'this host does not take direct uploads' }, { status: 501 })
    const { id, name } = await params
    if (!ARTIFACT_ID.test(id)) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (!(await store.get(id))) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (!ASSET_NAME.test(name)) return NextResponse.json({ error: 'asset name must be one path segment: letters, digits, dot, dash, underscore' }, { status: 400 })
    const type = contentTypeFor(name)
    if (!type) return NextResponse.json({ error: 'asset type not allowed; use webp, png, jpg, gif, mp3, mp4 or json' }, { status: 415 })
    const digest = typeof body.digest === 'string' ? body.digest : ''
    if (!ASSET_DIGEST.test(digest)) return NextResponse.json({ error: 'digest must be the first 8 hex of the sha256 of the bytes' }, { status: 400 })
    if (body.done === true) {
      const url = await assets.finishUpload(id, name, digest)
      if (!url) return NextResponse.json({ error: 'nothing was uploaded to that url' }, { status: 409 })
      return NextResponse.json({ id, name, url }, { status: 201 })
    }
    return NextResponse.json({ id, name, ...(await assets.signUpload(id, name, digest, type)) }, { status: 201 })
  }

  /** GET /<id>/share.png: the page's title card. 404 when the pack draws none, so a
   *  tenant on the static default never serves a half-styled card. */
  async function SHARE_IMAGE(_request: NextRequest, { params }: Params) {
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    const look = a ? lookOf(a) : { pack, brand }
    if (!look.brand.share) return new NextResponse('no share card for this host', { status: 404 })
    if (!a) return new NextResponse(`no artifact with id ${id}`, { status: 404 })
    return renderShareCard(look.pack, a.title, { to: a.to })
  }

  /** GET|POST /api/artifacts/<id>/versions, publish key: the history, and a note written onto one
   *  version after the fact. POST body: { version: number, note: string | null }. */
  async function VERSIONS(request: NextRequest, { params }: Params) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    if (!store.history || !store.setNote) return NextResponse.json({ error: 'this store keeps no history' }, { status: 501 })
    const history = ARTIFACT_ID.test(id) ? await store.history(id) : null
    if (!history) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (request.method === 'GET') return NextResponse.json({ id, current: history[0]?.version, versions: history }, { headers: { 'cache-control': 'no-store' } })
    const b = (await request.json().catch(() => null)) as { version?: unknown; note?: unknown } | null
    if (!b || !Number.isInteger(b.version) || (b.note !== null && typeof b.note !== 'string'))
      return NextResponse.json({ error: 'body is { version: <number>, note: <one line, or null to clear> }' }, { status: 400 })
    if (!(await store.setNote(id, b.version as number, b.note as string | null)))
      return NextResponse.json({ error: `no version ${String(b.version)} of ${id}` }, { status: 404 })
    revalidatePath(pagePath(id))
    return NextResponse.json({ id, versions: await store.history(id) })
  }

  async function DELETE(request: NextRequest, { params }: Params) {
    if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const ok = await store.delete(id)
    if (!ok) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    revalidatePath(pagePath(id))
    // The page is gone either way; a bucket failure here is reported, never turned into a 500
    // that tells the publisher a delete failed when it succeeded.
    if (!config.assets?.deleteReaderAudio) return NextResponse.json({ deleted: true })
    try {
      return NextResponse.json({ deleted: true, recordings: await config.assets.deleteReaderAudio(id) })
    } catch (e) {
      return NextResponse.json({ deleted: true, recordings: null, recordingsError: e instanceof Error ? e.message : String(e) })
    }
  }

  return { Page, generateMetadata, VersionPage, generateVersionMetadata, VERSIONS, POST, GET, DELETE, PUT_ASSET, UPLOAD, SHARE_IMAGE, ENTER, LEAVE, TRACK, ACK, ACCESS, READS, TRANSCRIBE: voiceRoutes.TRANSCRIBE, ...stateRoutes, ...personalRoutes, dynamic: 'force-dynamic' as const, maxDuration: 30 }
}
