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

// Whether an element shows below Tailwind's lg breakpoint (a phone) and from it up (a desktop), from its own classes
// and its ancestors': the screen has no client script, so the classes are the whole of what decides it.
const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const chain = (el: Element) => { const out: Element[] = []; for (let e: Element | null = el; e; e = e.parentElement) out.push(e); return out }
const onPhone = (el: Element) => chain(el).every((e) => !classes(e).includes('hidden') && !classes(e).includes('max-lg:hidden'))
const onDesktop = (el: Element) => chain(el).every((e) => {
  const c = classes(e)
  return !c.includes('lg:hidden') && (!c.includes('hidden') || c.some((x) => /^lg:(block|flex|grid|inline|inline-block)$/.test(x)))
})
const LISTS = '[data-view="needs"], [data-view="feed"], [data-view="waiting"], [data-view="pages"], [data-view="board"]'
const phoneLists = (d: Document) => [...d.querySelectorAll(LISTS)].filter(onPhone).map((e) => e.getAttribute('data-view'))

/** A hub with one page sent to 25 people six days ago, none of whom opened it: 25 waiting, 25 sends in the feed. */
async function many(): Promise<Sends> {
  const recipients = memoryRecipientsStore()
  const added = await recipients.add('big', Array.from({ length: 25 }, (_, i) => ({ label: `Reader ${String(i + 1).padStart(2, '0')}` })))
  await recipients.setSent!('big', added.map((r) => r.rid), ago(6))
  const page: ArtifactListItem = { id: 'big', title: 'The big send', summary: '', template: 'document', createdAt: ago(6), updatedAt: ago(6), views: 0 }
  return fetchSends({ site: 'https://hub.example.com', pagePrefix: '/', quietDays: 3 },
    { recipients, state: createMemoryStateStore(), pages: { list: async (k) => (k === 'document' ? [page] : []), get: async () => page as never } }, NOW)
}
const renderMany = async (query: Record<string, string> = {}) =>
  new DOMParser().parseFromString(renderToStaticMarkup(ArtifactsTile({
    data: await many(), query, title: 'Artifact analytics', theme, back: () => null, notFound,
  })), 'text/html')

describe('ArtifactsTile on a phone: one list at a time (Gary, 2026-11-09: "It\'s like a giant scroll")', () => {
  it('opens on Needs you: the waiting send and the comment, and no other list', async () => {
    const d = await render()
    expect(phoneLists(d)).toEqual(['needs'])
    const rows = [...d.querySelectorAll('[data-view="needs"] [data-needs]')]
    expect(rows.map((r) => r.getAttribute('data-needs'))).toEqual(['comment', 'waiting'])
    expect(rows[0].textContent).toContain('Ship it.')
    expect(rows[1].textContent).toContain('Lee')
  })
  it('says "Nothing needs you" when nothing is waiting and nobody commented', async () => {
    const d = await render({ waiting: '1', q: 'nobody-matches-this' })
    expect(d.querySelector('[data-view="needs"]')!.textContent).toContain('Nothing needs you')
    expect(d.querySelectorAll('[data-view="needs"] [data-needs]')).toHaveLength(0)
  })
  it('draws only the chosen tab\'s list: Activity, Outcomes', async () => {
    expect(phoneLists(await render({ tab: 'activity' }))).toEqual(['feed'])
    expect(phoneLists(await render({ view: 'outcomes' }))).toEqual(['board'])
    // The old Waiting on tab's address still lands somewhere: Needs you.
    expect(phoneLists(await render({ tab: 'waiting' }))).toEqual(['needs'])
  })
  it('shows the first 10 rows of a list and a Show more that adds the next 10', async () => {
    const d = await renderMany()
    expect([...d.querySelectorAll('[data-view="needs"] [data-needs]')].filter(onPhone)).toHaveLength(10)
    const more = [...d.querySelectorAll('[data-view="needs"] a[data-show-more]')].filter(onPhone)
    expect(more).toHaveLength(1)
    expect(more[0].textContent).toBe('Show more')
    const next = new URL(more[0].getAttribute('href')!, 'https://x.test')
    expect(next.searchParams.get('n')).toBe('20')
    expect(next.searchParams.get('tab')).toBe('needs')
    const d20 = await renderMany({ tab: 'needs', n: '20' })
    expect([...d20.querySelectorAll('[data-view="needs"] [data-needs]')].filter(onPhone)).toHaveLength(20)
    const d30 = await renderMany({ tab: 'needs', n: '30' })
    expect([...d30.querySelectorAll('[data-view="needs"] [data-needs]')].filter(onPhone)).toHaveLength(25)
    expect([...d30.querySelectorAll('[data-view="needs"] a[data-show-more]')]).toHaveLength(0)
    // Activity and the outcome board page the same way.
    const feed = await renderMany({ tab: 'activity' })
    expect([...feed.querySelectorAll('[data-view="feed"] [data-event]')].filter(onPhone)).toHaveLength(10)
    expect(new URL([...feed.querySelectorAll('[data-view="feed"] a[data-show-more]')].filter(onPhone)[0].getAttribute('href')!, 'https://x.test').searchParams.get('tab')).toBe('activity')
    const board = await renderMany({ view: 'outcomes' })
    expect([...board.querySelectorAll('[data-outcome="not-opened"] [data-card]')].filter(onPhone)).toHaveLength(10)
    expect([...board.querySelectorAll('[data-outcome="not-opened"] a[data-show-more]')].filter(onPhone)).toHaveLength(1)
  })
  it('makes the counts links: waiting opens Needs you, opened opens Outcomes', async () => {
    const d = await render()
    const waiting = d.querySelector('a[data-count="waiting"]')!
    expect(new URL(waiting.getAttribute('href')!, 'https://x.test').searchParams.get('tab')).toBe('needs')
    expect(waiting.textContent).toContain('waiting')
    const opened = d.querySelector('a[data-count="opened"]')!
    expect(new URL(opened.getAttribute('href')!, 'https://x.test').searchParams.get('view')).toBe('outcomes')
  })
})

describe('ArtifactsTile on a desktop: the columns as they were', () => {
  it('still draws the filters, the feed and Waiting on side by side, every row up to 30, Load more past it', async () => {
    const d = await renderMany()
    const cols = d.querySelector('[data-columns]')!
    expect(classes(cols)).toContain('lg:grid-cols-[15rem_minmax(0,1fr)_20rem]')
    for (const v of ['filters', 'feed', 'waiting']) expect(onDesktop(cols.querySelector(`[data-view="${v}"]`)!)).toBe(true)
    expect(d.querySelector('[data-view="needs"]') === null || !onDesktop(d.querySelector('[data-view="needs"]')!)).toBe(true)
    expect([...d.querySelectorAll('[data-view="feed"] [data-event]')].filter(onDesktop)).toHaveLength(25)
    expect([...d.querySelectorAll('[data-view="waiting"] [data-waiting]')].filter(onDesktop)).toHaveLength(25)
    expect([...d.querySelectorAll('a[data-show-more]')].filter(onDesktop)).toHaveLength(0)
    const outcomes = await renderMany({ view: 'outcomes' })
    expect(classes(outcomes.querySelector('[data-columns]')!)).toContain('lg:grid-cols-[13rem_minmax(0,1fr)]')
    expect([...outcomes.querySelectorAll('[data-outcome]')].filter(onDesktop)).toHaveLength(5)
  })
})

describe('ArtifactsTile', () => {
  it('draws the home: counts, the feed and Waiting on, under the app\'s title and Back row', async () => {
    const d = await render()
    expect(d.querySelector('h1')!.textContent).toBe('Artifact analytics')
    expect(d.querySelector('[data-back]')!.getAttribute('href')).toBe('/')
    expect(d.querySelector('[data-count="opened"]')!.textContent).toMatch(/^1 of 2/)
    expect([...d.querySelectorAll('[data-view="feed"] [data-event]')].map((e) => e.getAttribute('data-event'))).toContain('commented')
    expect([...d.querySelectorAll('[data-waiting]')].map((e) => e.getAttribute('data-waiting'))).toEqual(['Lee@plan'])
  })
  it('draws ONE row of view tabs: Needs you, Activity and Outcomes on a phone, Activity and Outcomes on a desktop', async () => {
    const d = await render()
    const rows = d.querySelectorAll('nav[data-view-switch], nav[data-tabs]')
    expect(rows.length).toBe(1)
    const links = [...rows[0].querySelectorAll('a')]
    const phone = links.filter(onPhone).map((a) => a.textContent)
    expect(phone).toEqual(['Needs you (2)', 'Activity', 'Outcomes'])
    expect(phone.filter((l) => l === 'Activity').length).toBe(1)
    expect(links.filter(onDesktop).map((a) => a.textContent)).toEqual(['Activity', 'Outcomes'])
    // Needs you is the phone's default tab; the desktop's Activity is current as it always was.
    expect(links.filter((a) => onPhone(a) && a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Needs you (2)'])
    expect(links.filter((a) => onDesktop(a) && a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Activity'])
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
