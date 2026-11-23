// The line a private page's door shows. It names the sign-in providers this hub turned on
// (HUB_TENANT `signIn`), so a Microsoft 365 reader is never told to use a Google account. With the
// email link door on, any address can sign in, so the line names the address, not an account kind.
const NAMES = { google: 'Google', microsoft: 'Microsoft' } as const

export function signInNoteFor(providers: readonly (keyof typeof NAMES | 'email')[] | undefined): string {
  const list = providers?.length ? providers : (['google'] as const)
  if (list.includes('email')) return 'This page is private. Sign in with the email address it was shared with.'
  const names = [...new Set(list)].map(p => NAMES[p as keyof typeof NAMES]).join(' or ')
  return `This page is private. Sign in with the ${names} account it was shared with.`
}
