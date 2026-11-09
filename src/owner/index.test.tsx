// The owner's view draws the hub as the analytics rules read it, with the app's theme, Back row and address. The data
// is the module's own in-memory stores; Firestore is never touched.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryStateStore, memoryRecipientsStore, type ArtifactListItem } from '../artifacts/index.js'
import { fetchSends, type Sends } from '../analytics/index.js'
import { ArtifactsTile, type ArtifactsTileTheme } from './index.js'

const DAY = 86_400_000
const NOW = new Date()
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString()
const theme: ArtifactsTileTheme = {
  card: '#ffffff', ink: '#111111', muted: '#666666', hairline: '#dddddd', accentSoft: '#99bbff', accentTint: '#eef3ff',
  danger: '#aa2222', primary: '#222244', onPrimary: '#fafafa', heading: { fontFamily: 'Serif Face', fontWeight: 600 },
}

async function data(): Promise<Sends> {
  const recipients = memoryRecipientsStore()
  const state = createMemoryStateStore()
  const [, kim, lee] = await recipients.add('plan', [{ label: 'Me', owner: true }, { label: 'Kim' }, { label: 'Lee' }])
  await recipients.setSent!('plan', [kim.rid, lee.rid], ago(6))
  await recipients.recordView({ artifactId: 'plan', rid: kim.rid, session: 's1', device: 'd1', at: ago(5), addSeconds: 45 })
  await state.append({ artifactId: 'plan', slot: 'comments', writer: { key: `r:${kim.rid}`, name: 'Kim' } as never, value: { body: 'Ship it.' } })
  const page: ArtifactListItem = { id: 'plan', title: 'The plan', summary: '', template: 'document', createdAt: ago(6), updatedAt: ago(6), views: 0 }
  return fetchSends({ site: 'https://hub.example.com', pagePrefix: '/', quietDays: 3 },
    { recipients, state, pages: { list: async (k) => (k === 'document' ? [page] : []), get: async () => page as never } }, NOW)
}
const notFound = (): never => { throw new Error('NOT_FOUND') }
const render = async (query: Record<string, string> = {}, more: Partial<Parameters<typeof ArtifactsTile>[0]> = {}) =>
  new DOMParser().parseFromString(renderToStaticMarkup(ArtifactsTile({
    data: await data(), query, title: 'Artifact analytics', theme, back: (href) => <a data-back href={href}>Back</a>, notFound, ...more,
  })), 'text/html')

describe('ArtifactsTile', () => {
  it('draws the home: counts, the feed and Waiting on, under the app\'s title and Back row', async () => {
    const d = await render()
    expect(d.querySelector('h1')!.textContent).toBe('Artifact analytics')
    expect(d.querySelector('[data-back]')!.getAttribute('href')).toBe('/')
    expect(d.querySelector('[data-count="opened"]')!.textContent).toMatch(/^1 of 2/)
    expect([...d.querySelectorAll('[data-view="feed"] [data-event]')].map((e) => e.getAttribute('data-event'))).toContain('commented')
    expect([...d.querySelectorAll('[data-waiting]')].map((e) => e.getAttribute('data-waiting'))).toEqual(['Lee@plan'])
  })
  it('draws ONE row of view tabs, Activity, Waiting on and Outcomes, never two rows that both say Activity', async () => {
    const d = await render()
    const rows = d.querySelectorAll('nav[data-view-switch], nav[data-tabs]')
    expect(rows.length).toBe(1)
    const labels = [...rows[0].querySelectorAll('a')].map((a) => a.textContent)
    expect(labels).toEqual(['Activity', 'Waiting on (1)', 'Outcomes'])
    expect(labels.filter((l) => l === 'Activity').length).toBe(1)
  })
  it('points every link and the filter form at basePath, and draws in the theme', async () => {
    const d = await render({}, { basePath: '/owner', homeHref: '/hub' })
    expect(d.querySelector('[data-back]')!.getAttribute('href')).toBe('/hub')
    expect(d.querySelector('a[href="/owner?p=plan"]')).not.toBeNull()
    expect(d.querySelector('a[href="/owner?who=name%3Akim"]')).not.toBeNull()
    expect(d.querySelector('form')!.getAttribute('action')).toBe('/owner')
    expect((d.querySelector('h1') as HTMLElement).style.fontFamily).toBe('Serif Face')
  })
  it('opens one page\'s readers and one person\'s timeline, and calls notFound for neither', async () => {
    const page = await render({ p: 'plan' })
    expect([...page.querySelectorAll('[data-reader]')].map((e) => e.getAttribute('data-reader'))).toEqual(['Kim', 'Lee'])
    expect(page.querySelector('[data-back]')!.getAttribute('href')).toBe('/artifacts')
    expect((await render({ who: 'name:kim' })).querySelector('[data-timeline="plan"]')).not.toBeNull()
    await expect(render({ p: 'nope' })).rejects.toThrow('NOT_FOUND')
    await expect(render({ who: 'nobody' })).rejects.toThrow('NOT_FOUND')
  })
  it('draws the outcome board with a Draft ready link only where the app says there is one', async () => {
    const d = await render({ view: 'outcomes' }, { draftHref: (s) => (s.label === 'Lee' ? '/drafts/lee' : null) })
    expect(d.querySelector('[data-outcome="not-opened"] [data-card="Lee@plan"] a[data-draft]')!.getAttribute('href')).toBe('/drafts/lee')
    expect(d.querySelectorAll('a[data-draft]')).toHaveLength(1)
  })
})
