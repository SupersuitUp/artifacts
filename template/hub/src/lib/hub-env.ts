// The hub's own variables, all named _HUB: TENANT_PUBLISH_KEY_HUB, TENANT_OWNER_EMAIL_HUB,
// TENANT_ADMINS_HUB. A person's email lives here, in the environment, never in a file.
const read = (name: string, env: Record<string, string | undefined> = process.env) => env[name]?.trim() || undefined
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export const publishKey = (env?: Record<string, string | undefined>) => read('TENANT_PUBLISH_KEY_HUB', env)
export const ownerEmail = (env?: Record<string, string | undefined>) => read('TENANT_OWNER_EMAIL_HUB', env)
/** Who sees a page's version history besides the owner: an earlier draft can hold what the
 *  current one was edited to remove. */
export const admins = (env?: Record<string, string | undefined>) => list(read('TENANT_ADMINS_HUB', env))
