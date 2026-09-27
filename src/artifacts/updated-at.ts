// The "Updated" line under an artifact's summary, to the exact minute with its zone named.
// The server renders UTC; the reader swaps in the viewer's own zone once it runs, so the minute
// is always one a person can place (Gary, 2026-09-27).
export function formatUpdated(iso: string, timeZone = 'UTC'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' })
  return `${date} at ${time}`
}
