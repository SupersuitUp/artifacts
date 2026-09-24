// One publish key per instance. The site gate lets the artifacts API through precisely
// because this header is the whole authorization.
export function isPublishAuthed(request: Request, key: string | undefined): boolean {
  if (!key) return false
  const h = request.headers.get('authorization') ?? ''
  return h === `Bearer ${key}`
}
