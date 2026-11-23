// The line a private page's door shows. It names the sign-in providers this hub turned on
// (HUB_TENANT `signIn`), so a Microsoft 365 reader is never told to use a Google account.
const NAMES = { google: 'Google', microsoft: 'Microsoft' } as const

export function signInNoteFor(providers: readonly (keyof typeof NAMES)[] | undefined): string {
  const list = providers?.length ? providers : (['google'] as const)
  const names = [...new Set(list)].map(p => NAMES[p]).join(' or ')
  return `This page is private. Sign in with the ${names} account it was shared with.`
}
