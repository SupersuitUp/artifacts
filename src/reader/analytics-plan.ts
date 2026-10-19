// Whether a page view is recorded in the host's product analytics, and as whom. Pure, so the route
// decides on the server and the browser is handed either nothing or exactly what to send.
//
// THE RULES (0.50.0):
//  - A host with no analytics key records nothing, and its pages load no analytics script at all.
//  - The owner and the host's admins are never recorded, signed in or on their own per-reader link.
//  - A link-preview fetcher is never handed the script.
//  - A reader is identified only where the page already knows who they are: a gated page by the
//    signed-in email, a per-reader link by its opaque recipient id and the label the publisher gave
//    it (never a phone or an email, which the recipients store does not hold). A public or password
//    page stays anonymous, even when its reader happens to be signed in.

export type AnalyticsConfig = {
  /** A PostHog project API key (the public `phc_...` one, safe in a browser). */
  posthogKey: string
  /** The ingestion host. Default PostHog's US cloud. */
  posthogHost?: string
  /** Sent with every event as `tenant`, so one project can hold several hosts' pages. */
  tenant?: string
}

export type PageKind = 'public' | 'password' | 'gated' | 'per-reader'

export type AnalyticsPlan = {
  key: string
  host: string
  pageId: string
  kind: PageKind
  tenant: string | null
  /** Who to identify the reader as, or null to keep them anonymous. */
  identity: { distinctId: string; email?: string; name?: string } | null
}

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export function analyticsPlan(input: {
  config: AnalyticsConfig | null | undefined
  pageId: string
  kind: PageKind
  /** The owner or an admin is looking (signed in, previewing as a reader, or on the owner's own link). */
  owner: boolean
  bot: boolean
  /** A gated page's signed-in reader. */
  reader?: { email: string; name?: string | null } | null
  /** A per-reader link's recipient. */
  recipient?: { rid: string; label: string } | null
}): AnalyticsPlan | null {
  const key = input.config?.posthogKey?.trim()
  if (!key || input.owner || input.bot) return null
  let identity: AnalyticsPlan['identity'] = null
  if (input.kind === 'gated' && input.reader?.email) {
    const email = input.reader.email.trim().toLowerCase()
    identity = { distinctId: email, email, ...(input.reader.name ? { name: input.reader.name } : {}) }
  } else if (input.kind === 'per-reader' && input.recipient?.rid) {
    identity = { distinctId: `recipient:${input.recipient.rid}`, name: input.recipient.label }
  }
  return {
    key,
    host: input.config!.posthogHost?.trim() || DEFAULT_POSTHOG_HOST,
    pageId: input.pageId,
    kind: input.kind,
    tenant: input.config!.tenant ?? null,
    identity,
  }
}
