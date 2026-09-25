// The artifacts routes, built once per instance from its config. An instance's
// app/a/[id]/page.tsx and app/api/artifacts/*/route.ts are one-line re-exports of
// what this returns, so the shell owns the behaviour and the instance owns only
// the wiring: which store, which brand, which domain, which key.
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'
import { isPublishAuthed } from '../artifacts/auth.js'
import { parseArtifactSource } from '../artifacts/front-matter.js'
import { narrationText } from '../artifacts/narration.js'
import { ArtifactMarkdown } from '../artifacts/render.js'
import { ArtifactDoor } from '../artifacts/door.js'
import { isUnlocked, keyHash, unlockCookieName } from '../artifacts/unlock.js'
import type { ArtifactStore } from '../artifacts/store.js'
import { shapeChanges } from '../artifacts/state.js'
import type { StateStore } from '../artifacts/state-store.js'
import { ASSET_NAME, contentTypeFor, type ArtifactAssets } from '../artifacts/assets.js'
import { BrandGround } from '../brand/wrapper.js'
import { renderShareCard } from '../brand/share-card.js'
import type { BrandPack } from '../brand/pack.js'
import { ArtifactReader, type WordTiming } from '../reader/artifact-reader.js'
import { ReaderWatch } from '../reader/reader-watch.js'
import {
  ACCESS_LEVELS, GRANT_COOKIE, GRANT_TTL_SECONDS, decide, firstName, mintGrant, safeReturnPath, signInUrl, verifyGrant, verifyPass,
  type Access, type Reader,
} from '../artifacts/reader.js'
import { FLAG_KINDS, summarize, type FlagKind, type ReadersStore } from '../artifacts/readers-store.js'
import { AckDoor, ConfidentialBanner, NO_PRINT_CSS, NotAllowedDoor, SignInDoor, Watermark, ackText } from '../artifacts/confidential.js'
import { ARTIFACT_ID_RE } from './ids.js'
import { createStateRoutes } from './state-routes.js'

export type ArtifactRoutesConfig = {
  store: ArtifactStore
  /** Where readers' answers live. Without it every state route answers 501. */
  state?: StateStore
  /** Where uploaded files go. Optional; without it PUT_ASSET answers 501. */
  assets?: ArtifactAssets
  brand: BrandPack
  /** The host that serves a 200, e.g. https://artifacts.example.com. No trailing slash. */
  siteUrl: string
  /** Read at request time, so a rotated key needs no rebuild. */
  publishKey: () => string | undefined
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
  /** Who the banner says grants access, e.g. "Example Co". Default the brand name. */
  owner?: string
  /** The address the state routes' rate limit counts by. Default reads the first hop of
   *  `x-forwarded-for`, which is correct on Vercel (it overwrites XFF with the real client IP)
   *  and wrong behind any other proxy that appends rather than replaces; pass this there. */
  clientIp?: (req: NextRequest) => string
}

/** Ids are 8 chars from the safe alphabet; anything else is not a page and never reaches the store. */
export const ARTIFACT_ID = ARTIFACT_ID_RE

type Params = { params: Promise<{ id: string }> }
type PageProps = Params & { searchParams?: Promise<{ key?: string | string[] }> }

async function defaultReadCookie(name: string): Promise<string | undefined> {
  const { cookies } = await import('next/headers')
  return (await cookies()).get(name)?.value
}

export function createArtifactRoutes(config: ArtifactRoutesConfig) {
  const { store, brand, siteUrl } = config
  const prefix = config.pagePrefix ?? '/'
  const pageUrl = (id: string) => `${siteUrl}${prefix}${id}`
  const pagePath = (id: string) => `${prefix}${id}`
  const absolute = (p?: string) => (p ? (/^https?:\/\//.test(p) ? p : `${siteUrl}${p}`) : undefined)
  // The version in the URL is what makes a re-publish show up: every unfurler caches by URL.
  const signInOrigin = config.signInOrigin
  const owner = config.owner ?? brand.name
  const readerSecret = () => config.readerSecret?.()
  const signOutUrl = (id: string) => `/api/reader/leave?to=${encodeURIComponent(pagePath(id))}`
  const shareCardUrl = (id: string, updatedAt: string) => `${pageUrl(id)}/share.png?v=${encodeURIComponent(updatedAt)}`
  const stateRoutes = createStateRoutes({
    store, state: config.state, readers: config.readers, readerSecret, publishKey: config.publishKey, pageUrl, signInOrigin, siteUrl,
    clientIp: config.clientIp,
  })

  async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) return { title: 'Not found', robots: { index: false, follow: false } }
    const url = pageUrl(a.id)
    const image = absolute(a.cover) ?? (brand.share ? shareCardUrl(a.id, a.updatedAt) : absolute(config.defaultShareImage))
    return {
      title: a.title,
      description: a.summary,
      alternates: { canonical: pagePath(a.id) },
      robots: { index: false, follow: false },
      openGraph: {
        title: a.title,
        description: a.summary,
        url,
        siteName: brand.name,
        type: 'article',
        ...(image ? { images: [{ url: image, alt: a.cover ? a.title : brand.name }] } : {}),
      },
      twitter: {
        card: image ? 'summary_large_image' : 'summary',
        title: a.title,
        description: a.summary,
        ...(image ? { images: [image] } : {}),
      },
    }
  }

  async function Page({ params, searchParams }: PageProps) {
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) notFound()
    if (a.access) return GatedPage(a, id)
    // A password shuts the body, never the title: the header stays so the reader knows which
    // page they were sent, and the unfurl (generateMetadata) keeps reading as the page.
    const sp = (await searchParams) ?? {}
    const key = Array.isArray(sp.key) ? sp.key[0] : sp.key
    const readCookie = config.readCookie ?? defaultReadCookie
    const cookie = a.password ? await readCookie(unlockCookieName(id)) : undefined
    const open = isUnlocked({ id, password: a.password, key, cookie })
    // Opened by the key in the URL: remember it in a cookie holding the hash, never the
    // password, scoped to this page, so a refresh or a shared device does not ask again.
    const remember = open && a.password && key !== undefined && cookie !== keyHash(id, a.password)
      ? `document.cookie=${JSON.stringify(`${unlockCookieName(id)}=${keyHash(id, a.password)}; Path=${pagePath(id)}; Max-Age=31536000; SameSite=Lax; Secure`)}`
      : null
    if (!open) {
      return (
        <BrandGround pack={brand}>
          <div className="mx-auto max-w-2xl px-6 pt-24 pb-8 text-center sm:pt-28">
            <p data-nospeak className="mb-4 text-[11px] font-medium uppercase tracking-[0.3em]" style={{ color: brand.accent }}>
              {brand.kicker}
            </p>
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
    void store.bumpViews(id)
    let words: WordTiming[] = []
    if (a.narration && a.timings) {
      try {
        const r = await fetch(a.timings, { next: { revalidate: 3600 } })
        if (r.ok) words = ((await r.json()) as { words: WordTiming[] }).words ?? []
      } catch {
        words = []
      }
    }
    const when = new Date(a.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    return (
      <BrandGround pack={brand}>
        {remember ? <script dangerouslySetInnerHTML={{ __html: remember }} /> : null}
        <div id="artifact-narration-root">
          <div className="mx-auto max-w-2xl px-6 pt-24 pb-8 text-center sm:pt-28">
            <p data-nospeak className="mb-4 text-[11px] font-medium uppercase tracking-[0.3em]" style={{ color: brand.accent }}>
              {brand.kicker}
            </p>
            <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
              {a.title}
            </h1>
            {a.subtitle ? (
              <p className="mx-auto mt-4 max-w-xl text-xl sm:text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                {a.subtitle}
              </p>
            ) : null}
            <p className="mx-auto mt-6 max-w-xl text-lg italic opacity-80">{a.summary}</p>
            <p data-nospeak className="mt-4 text-xs opacity-50">
              Updated {when}
            </p>
          </div>
          {a.cover ? (
            <div className="mx-auto max-w-2xl px-6 pb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.cover} alt="" className="w-full rounded-xl border border-white/10" />
            </div>
          ) : null}
          <article className="mx-auto max-w-2xl px-6 pb-24">
            <ArtifactMarkdown markdown={a.markdown} />
          </article>
        </div>
        {a.narration && words.length > 0 ? (
          <ArtifactReader
            src={a.narration}
            words={words}
            rootId="artifact-narration-root"
            label={brand.narratorLabel(a.voice)}
            accent={brand.accent}
            ground={brand.ground}
          />
        ) : null}
      </BrandGround>
    )
  }

  /** A page with `access:`. The body is rendered only after the reader is known and allowed;
   *  everyone else gets the title, the summary, and a door. */
  async function GatedPage(a: NonNullable<Awaited<ReturnType<ArtifactStore['get']>>>, id: string) {
    const readCookie = config.readCookie ?? defaultReadCookie
    const reader = verifyGrant(readerSecret(), await readCookie(GRANT_COOKIE))
    const allow = config.readers && reader ? await config.readers.allowList(id) : []
    const d = config.readers ? decide(a.access!, reader, allow) : ({ open: false, why: 'signed-out' } as const)
    const header = (
      <div className="mx-auto max-w-2xl px-6 pt-24 pb-8 text-center sm:pt-28">
        <p data-nospeak className="mb-4 text-[11px] font-medium uppercase tracking-[0.3em]" style={{ color: brand.accent }}>
          {brand.kicker}
        </p>
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
        <BrandGround pack={brand}>
          {header}
          {d.why === 'not-allowed'
            ? <NotAllowedDoor brand={brand} reader={d.reader} signOutUrl={signOutUrl(id)} />
            : <SignInDoor brand={brand} href={signInOrigin ? signInUrl(signInOrigin, pageUrl(id)) : undefined} />}
        </BrandGround>
      )
    }
    const r = reader as Reader
    // The agreement comes before the body, every reader, once per page. No agreement, no body.
    if (config.readers && !(await config.readers.acknowledged(id, r.email))) {
      return (
        <BrandGround pack={brand}>
          {header}
          <AckDoor brand={brand} name={firstName(r, allow)} email={r.email} owner={owner} pageId={id} signOutUrl={signOutUrl(id)} />
        </BrandGround>
      )
    }
    void store.bumpViews(id)
    return (
      <BrandGround pack={brand}>
        <style dangerouslySetInnerHTML={{ __html: NO_PRINT_CSS }} />
        <Watermark email={r.email} />
        {/* Padding, never a margin: a top margin here collapses through the ground and leaves a
            white strip above the page (seen live 2026-09-24). */}
        <div className="px-6 pt-20 sm:pt-24">
          <ConfidentialBanner name={firstName(r, allow)} email={r.email} reason={d.reason} owner={owner} brand={brand} signOutUrl={signOutUrl(id)} />
        </div>
        {await Body(a, { top: false })}
        <ReaderWatch artifactId={id} endpoint="/api/reader/track" accent={brand.accent} />
      </BrandGround>
    )
  }

  /** The page itself, shared by open and gated pages. */
  async function Body(a: NonNullable<Awaited<ReturnType<ArtifactStore['get']>>>, { top }: { top: boolean }) {
    let words: WordTiming[] = []
    if (a.narration && a.timings) {
      try {
        const r = await fetch(a.timings, { next: { revalidate: 3600 } })
        if (r.ok) words = ((await r.json()) as { words: WordTiming[] }).words ?? []
      } catch {
        words = []
      }
    }
    const when = new Date(a.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    return (
      <>
        <div id="artifact-narration-root">
          <div className={`mx-auto max-w-2xl px-6 ${top ? 'pt-24 sm:pt-28' : 'pt-12'} pb-8 text-center`}>
            <p data-nospeak className="mb-4 text-[11px] font-medium uppercase tracking-[0.3em]" style={{ color: brand.accent }}>
              {brand.kicker}
            </p>
            <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
              {a.title}
            </h1>
            {a.subtitle ? (
              <p className="mx-auto mt-4 max-w-xl text-xl sm:text-2xl" style={{ fontFamily: brand.type.display, color: brand.ink }}>
                {a.subtitle}
              </p>
            ) : null}
            <p className="mx-auto mt-6 max-w-xl text-lg italic opacity-80">{a.summary}</p>
            <p data-nospeak className="mt-4 text-xs opacity-50">
              Updated {when}
            </p>
          </div>
          {a.cover ? (
            <div className="mx-auto max-w-2xl px-6 pb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.cover} alt="" className="w-full rounded-xl border border-white/10" />
            </div>
          ) : null}
          <article className="mx-auto max-w-2xl px-6 pb-24">
            <ArtifactMarkdown markdown={a.markdown} />
          </article>
        </div>
        {a.narration && words.length > 0 ? (
          <ArtifactReader
            src={a.narration}
            words={words}
            rootId="artifact-narration-root"
            label={brand.narratorLabel(a.voice)}
            accent={brand.accent}
            ground={brand.ground}
          />
        ) : null}
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

  /** GET /api/reader/leave?to=/<id>: sign out of this host's gated pages. */
  async function LEAVE(request: NextRequest) {
    const to = safeReturnPath(request.nextUrl.searchParams.get('to'), prefix) ?? '/'
    const res = NextResponse.redirect(`${siteUrl}${to}`, 303)
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
    if (!isPublishAuthed(request, config.publishKey())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    if (!isPublishAuthed(request, config.publishKey())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!config.readers) return NextResponse.json({ error: 'this host keeps no reader record' }, { status: 501 })
    const { id } = await params
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    const [sessions, flags, acks] = await Promise.all([config.readers.sessions(id), config.readers.flags(id), config.readers.acks(id)])
    return NextResponse.json({ id, title: a.title, access: a.access ?? null, views: a.views, ...summarize(sessions, flags), acks: acks.map((k) => ({ email: k.email, name: k.name, at: k.at })) }, { headers: { 'cache-control': 'no-store' } })
  }

  async function POST(request: NextRequest) {
    if (!isPublishAuthed(request, config.publishKey())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const result = await store.save({ id, meta: parsed.meta, markdown: parsed.body })
    if ('notFound' in result) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    revalidatePath(pagePath(result.id))
    return NextResponse.json(
      { id: result.id, url: pageUrl(result.id), version: result.version },
      { status: result.created ? 201 : 200 },
    )
  }

  async function GET(request: NextRequest, { params }: Params) {
    if (!isPublishAuthed(request, config.publishKey())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const a = await store.get(id)
    if (!a) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    return NextResponse.json({ id, text: narrationText({ title: a.title, summary: a.summary, markdown: a.markdown }) })
  }

  /** PUT /api/artifacts/<id>/assets/<name>: raw bytes in, public URL out. 16 MiB cap. */
  async function PUT_ASSET(request: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
    if (!isPublishAuthed(request, config.publishKey())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!config.assets) return NextResponse.json({ error: 'this host does not store assets' }, { status: 501 })
    const { id, name } = await params
    if (!ARTIFACT_ID.test(id)) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (!(await store.get(id))) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    if (!ASSET_NAME.test(name)) return NextResponse.json({ error: 'asset name must be one path segment: letters, digits, dot, dash, underscore' }, { status: 400 })
    const type = contentTypeFor(name)
    if (!type) return NextResponse.json({ error: 'asset type not allowed; use webp, png, jpg, gif, mp3 or json' }, { status: 415 })
    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.length === 0) return NextResponse.json({ error: 'empty body' }, { status: 400 })
    if (bytes.length > 16 * 1024 * 1024) return NextResponse.json({ error: 'asset over 16 MiB' }, { status: 413 })
    const url = await config.assets.put(id, name, bytes, type)
    return NextResponse.json({ id, name, url }, { status: 201 })
  }

  /** GET /<id>/share.png: the page's title card. 404 when the pack draws none, so a
   *  tenant on the static default never serves a half-styled card. */
  async function SHARE_IMAGE(_request: NextRequest, { params }: Params) {
    const { id } = await params
    if (!brand.share) return new NextResponse('no share card for this host', { status: 404 })
    const a = ARTIFACT_ID.test(id) ? await store.get(id) : null
    if (!a) return new NextResponse(`no artifact with id ${id}`, { status: 404 })
    return renderShareCard(brand, a.title)
  }

  async function DELETE(request: NextRequest, { params }: Params) {
    if (!isPublishAuthed(request, config.publishKey())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const ok = await store.delete(id)
    if (!ok) return NextResponse.json({ error: `no artifact with id ${id}` }, { status: 404 })
    revalidatePath(pagePath(id))
    return NextResponse.json({ deleted: true })
  }

  return { Page, generateMetadata, POST, GET, DELETE, PUT_ASSET, SHARE_IMAGE, ENTER, LEAVE, TRACK, ACK, ACCESS, READS, ...stateRoutes, dynamic: 'force-dynamic' as const, maxDuration: 30 }
}
