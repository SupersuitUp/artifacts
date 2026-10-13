import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CommentLayer } from './comment-layer.js'
import { deviceNotes, deviceNotesKey } from './device-notes.js'
import { indexText, offsetAt, placeAnchor } from './comment-place.js'
import { textAnchorFrom } from '../artifacts/anchor.js'

function stubStorage() {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  })
}

const PAGE = `
  <div id="root">
    <h2 id="sales" data-block="b-h-00000001">Sales</h2>
    <p data-block="b-p-00000002">The river runs north, and the <b>river</b> floods.</p>
    <p data-block="b-img-00000003"><img alt="" src="https://cdn.example.com/chart.png"></p>
  </div>
  <div id="m"></div>`

type Row = { id: string; name?: string; value: unknown; at: string; mine?: boolean }
let calls: { url: string; method: string; body?: unknown }[]
function stubFetch(opts: { shared?: Row[]; mine?: Row[]; personal?: 'device' | Row[]; stateStatus?: number; refuseAppend?: string } = {}) {
  calls = []
  const personal = opts.personal ?? 'device'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    if (url.endsWith('/state') && method === 'POST' && opts.refuseAppend) return new Response(JSON.stringify({ error: opts.refuseAppend }), { status: 403 })
    if (url.endsWith('/state')) {
      return new Response(JSON.stringify({ slots: { comments: { shape: 'many', visibility: 'shared', mine: opts.mine ?? [], shared: opts.shared } } }), { status: opts.stateStatus ?? 200 })
    }
    if (url.endsWith('/resolve')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    if (url.includes('/personal')) {
      if (personal === 'device') return new Response(JSON.stringify({ error: 'sign in', device: true }), { status: 401 })
      if (method === 'POST') personal.push({ id: `p${personal.length}`, value: body.value, at: '2026-09-28T00:00:00Z' })
      return new Response(JSON.stringify({ notes: personal }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }))
}

let root: Root | null = null
async function mount(props: Partial<Parameters<typeof CommentLayer>[0]> = {}) {
  document.body.innerHTML = PAGE
  root = createRoot(document.getElementById('m')!)
  await act(async () => {
    root!.render(<CommentLayer artifactId="abc23456" rootId="root" ownerName="Robin Vale" comments="off" canShare={false} signedIn={false} isOwner={false} version={3} accent="#f80" ground="#000" {...props} />)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals() })

const text = (quote: string, prefix = '', suffix = '') => ({ kind: 'text', quote, prefix, suffix })
const value = (anchor: unknown, body: string, extra: Record<string, unknown> = {}) => ({ anchor, body, version: 3, ...extra })

function selectWord(word: string, nth = 0) {
  const p = document.querySelector('[data-block="b-p-00000002"]')!
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  let seen = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.nodeValue!.indexOf(word)
    if (i === -1) continue
    if (seen++ < nth) continue
    const r = document.createRange()
    r.setStart(n, i)
    r.setEnd(n, i + word.length)
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    return
  }
  throw new Error(`no ${word}`)
}

describe('comment-place', () => {
  it('indexes the root\'s text and maps a selection boundary to an offset in it', () => {
    document.body.innerHTML = PAGE
    const idx = indexText(document.getElementById('root')!)
    expect(idx.text.replace(/\s+/g, ' ').trim()).toBe('Sales The river runs north, and the river floods.')
    const b = document.querySelector('b')!
    const at = offsetAt(idx, b.firstChild!, 0)!
    expect(idx.text.slice(at, at + 5)).toBe('river')
    // The second "river" is found again by its context, not by its position.
    const a = textAnchorFrom(idx.text, at, at + 5)
    expect(placeAnchor(document.getElementById('root')!, idx, a)?.kind).toBe('text')
  })
})

describe('CommentLayer', () => {
  beforeEach(() => stubStorage())

  it('pins a text comment and a region comment; one whose quote is gone goes to the earlier-versions list', async () => {
    stubFetch({ shared: [
      { id: 's1', name: 'Sam', value: value(text('river', 'The ', ' runs north'), 'Which river?'), at: '2026-09-28T00:00:00Z' },
      { id: 's2', name: 'Jo', value: value({ kind: 'region', block: 'b-img-00000003', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 'This bar'), at: '2026-09-28T00:00:01Z' },
      { id: 's3', name: 'Ada', value: value(text('a sentence that was cut'), 'Gone now'), at: '2026-09-28T00:00:02Z' },
      { id: 's4', name: 'Kit', value: value({ kind: 'region', block: 'b-p-99999999', x: 0, y: 0, w: 1, h: 1 }, 'On a removed block'), at: '2026-09-28T00:00:03Z' },
    ] })
    await mount({ comments: 'anyone', canShare: true })
    const pins = [...document.querySelectorAll('[data-comment-pin]')]
    expect(pins.map((p) => p.getAttribute('data-comment-id')).sort()).toEqual(['s1', 's2'])
    expect(pins.every((p) => p.getAttribute('data-comment-pin') === 'shared')).toBe(true)
    expect(document.querySelector('[data-comment-box="s2"]')).not.toBeNull()
    const earlier = document.querySelector('[data-comments-earlier]')!
    expect(earlier.textContent).toContain('Comments on earlier versions')
    expect(earlier.textContent).toContain('a sentence that was cut')
    expect(earlier.textContent).toContain('Gone now')
    expect(earlier.textContent).toContain('On a removed block')
  })

  it('GUARD: on a phone the Comment button sits at the top of the screen, clear of the iOS selection menu', async () => {
    stubFetch()
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia
    try {
      await mount()
      selectWord('river', 1)
      await act(async () => { document.getElementById('root')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
      const chip = document.querySelector<HTMLButtonElement>('[data-comment-chip]')!
      expect(chip.getAttribute('data-comment-chip-at')).toBe('top')
      expect(chip.className).toContain('fixed')
      expect(chip.style.top).toContain('safe-area-inset-top')
    } finally {
      window.matchMedia = real
    }
  })

  it('a reader without comment access selects text, sees the warning before typing, and the note stays on the device', async () => {
    stubFetch()
    await mount()
    selectWord('river', 1)
    await act(async () => { document.getElementById('root')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
    const chip = document.querySelector<HTMLButtonElement>('[data-comment-chip]')!
    expect(chip.textContent).toBe('Comment')
    expect(chip.getAttribute('data-comment-chip-at')).toBe('selection')
    await act(async () => { chip.click() })
    expect(document.querySelector('[data-comment-warning]')!.textContent).toContain('Robin Vale has not opened this page to comments')
    const box = document.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'For me only')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    const notes = deviceNotes('abc23456')
    expect(notes).toHaveLength(1)
    expect(notes[0].value).toMatchObject({ body: 'For me only', version: 3, anchor: { kind: 'text', quote: 'river', heading: 'sales' } })
    // The second "river", by its context.
    expect((notes[0].value.anchor as { prefix: string }).prefix).toMatch(/and the $/)
    // Nothing was sent anywhere but the reader's own device.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
    const pin = document.querySelector('[data-comment-pin]')!
    expect(pin.getAttribute('data-comment-pin')).toBe('personal')
    expect(pin.textContent).toContain('only you')
  })

  it('a shared comment posts to the comments slot with its anchor and version', async () => {
    stubFetch({ shared: [] })
    await mount({ comments: 'anyone', canShare: true })
    selectWord('floods')
    await act(async () => { document.getElementById('root')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-chip]')!.click() })
    const box = document.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Every year?')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    const sent = calls.find((c) => c.method === 'POST')!
    expect(sent.url).toBe('/api/artifacts/abc23456/state')
    expect(sent.body).toMatchObject({ slot: 'comments', op: 'append', value: { body: 'Every year?', version: 3, anchor: { kind: 'text', quote: 'floods' } } })
    expect(deviceNotes('abc23456')).toEqual([])
  })

  it('a personal note\'s thread has no reply; a shared comment\'s does', async () => {
    localStorage.setItem(deviceNotesKey('abc23456'), JSON.stringify([{ id: 'd-1', value: value(text('north'), 'Mine'), at: '2026-09-28T00:00:00Z' }]))
    stubFetch({ shared: [{ id: 's1', name: 'Sam', value: value(text('floods'), 'Theirs'), at: '2026-09-28T00:00:00Z' }] })
    await mount({ comments: 'anyone', canShare: true })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="d-1"]')!.click() })
    const personal = document.querySelector('[data-comment-thread]')!
    expect(personal.textContent).toContain('Mine')
    expect(personal.querySelector('[data-comment-reply]')).toBeNull()
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="s1"]')!.click() })
    const shared = document.querySelector('[data-comment-thread]')!
    expect(shared.textContent).toContain('Theirs')
    expect(shared.querySelector('[data-comment-reply]')).not.toBeNull()
  })

  it('the toggle hides every pin for clean reading', async () => {
    stubFetch({ shared: [{ id: 's1', name: 'Sam', value: value(text('floods'), 'Theirs'), at: '2026-09-28T00:00:00Z' }] })
    await mount({ comments: 'anyone', canShare: true })
    expect(document.querySelectorAll('[data-comment-pin]')).toHaveLength(1)
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-button]')!.click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-pins-toggle]')!.click() })
    expect(document.querySelectorAll('[data-comment-pin]')).toHaveLength(0)
  })

  it('on sign-in, notes kept on the device move to the reader\'s account and leave the device', async () => {
    localStorage.setItem(deviceNotesKey('abc23456'), JSON.stringify([{ id: 'd-1', value: value(text('north'), 'From before'), at: '2026-09-28T00:00:00Z' }]))
    const server: Row[] = []
    stubFetch({ personal: server })
    await mount({ signedIn: true })
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/personal'))?.body).toEqual({ value: value(text('north'), 'From before') })
    expect(localStorage.getItem(deviceNotesKey('abc23456'))).toBeNull()
    expect(document.querySelector('[data-comment-pin]')?.getAttribute('data-comment-pin')).toBe('personal')
  })

  const open = async (id: string) => { await act(async () => { document.querySelector<HTMLElement>(`[data-comment-pin][data-comment-id="${id}"]`)!.click() }) }
  const typeInto = async (el: HTMLTextAreaElement | HTMLInputElement, v: string) => {
    await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const startComment = async () => {
    selectWord('floods')
    await act(async () => { document.getElementById('root')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-chip]')!.click() })
  }

  it('a passed feedback window stops the layer offering to share', async () => {
    stubFetch({ mine: [] })
    await mount({ comments: 'anyone', canShare: true, closesAt: new Date(Date.now() - 1000).toISOString() })
    expect(document.querySelector('[data-comment-layer]')!.getAttribute('data-comment-can-share')).toBe('no')
  })
  it('a window that passes while the page is open stops the offer without a reload', async () => {
    stubFetch({ mine: [] })
    await mount({ comments: 'anyone', canShare: true, closesAt: new Date(Date.now() + 500).toISOString() })
    expect(document.querySelector('[data-comment-layer]')!.getAttribute('data-comment-can-share')).toBe('yes')
    await act(async () => { await new Promise((r) => setTimeout(r, 800)) })
    expect(document.querySelector('[data-comment-layer]')!.getAttribute('data-comment-can-share')).toBe('no')
  })
  it('a window further out than the timer cap does not close early', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    try {
      stubFetch({ mine: [] })
      document.body.innerHTML = PAGE
      root = createRoot(document.getElementById('m')!)
      const closesAt = new Date(Date.now() + 3_000_000_000).toISOString()
      await act(async () => {
        root!.render(<CommentLayer artifactId="abc23456" rootId="root" ownerName="Robin Vale" comments="anyone" canShare signedIn={false} isOwner={false} version={3} accent="#f80" ground="#000" closesAt={closesAt} />)
      })
      const can = () => document.querySelector('[data-comment-layer]')!.getAttribute('data-comment-can-share')
      await act(async () => { await vi.advanceTimersByTimeAsync(2_200_000_000) })
      expect(can()).toBe('yes')
      await act(async () => { await vi.advanceTimersByTimeAsync(900_000_000) })
      expect(can()).toBe('no')
    } finally { vi.useRealTimers() }
  })
  it('a time that cannot be read is closed', async () => {
    stubFetch({ mine: [] })
    await mount({ comments: 'anyone', canShare: true, closesAt: 'soon-ish' })
    expect(document.querySelector('[data-comment-layer]')!.getAttribute('data-comment-can-share')).toBe('no')
  })
  it('a reader\'s own unanswered comment says it is waiting; a publisher reply replaces that and points at what changed', async () => {
    const mine = [{ id: 'm1', value: value(text('river', 'The ', ' runs north'), 'Which river?'), at: '2026-09-28T00:00:00Z' }]
    stubFetch({ mine })
    await mount({ comments: 'anyone', canShare: true, closesAt: new Date(Date.now() + 86_400_000).toISOString() })
    await open('m1')
    expect(document.querySelector('[data-comment-waiting]')!.textContent).toBe('Waiting for a reply.')
    await act(async () => root?.unmount()); root = null
    stubFetch({ mine, shared: [{ id: 'p1', name: 'Robin', value: value(text('floods'), 'Said where it floods.', { parent: 'm1', by: 'Robin', publisher: true }), at: '2026-09-28T01:00:00Z' }] })
    await mount({ comments: 'anyone', canShare: true, closesAt: new Date(Date.now() + 86_400_000).toISOString() })
    await open('m1')
    expect(document.querySelector('[data-comment-waiting]')).toBeNull()
    expect(document.querySelector('[data-comment-thread]')!.textContent).toContain('Said where it floods.')
    expect(document.querySelector('[data-comment-jump]')!.textContent).toBe('Show what changed')
  })
  it('a page with no feedback window never says waiting', async () => {
    stubFetch({ mine: [{ id: 'm1', value: value(text('river', 'The ', ' runs north'), 'Which river?'), at: '2026-09-28T00:00:00Z' }] })
    await mount({ comments: 'anyone', canShare: true })
    await open('m1')
    expect(document.querySelector('[data-comment-waiting]')).toBeNull()
  })
  it('a refusal for a closed window or a missing name leaves the typed words in the box', async () => {
    for (const refusal of ['Feedback on this draft is closed. Your note was not sent.', 'Add your first name, so your note has a name on it.']) {
      stubFetch({ shared: [], refuseAppend: refusal })
      await mount({ comments: 'anyone', canShare: true })
      await startComment()
      await typeInto(document.querySelector('textarea')!, 'Every year?')
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
      expect(document.querySelector('[data-comment-card] [role="alert"]')!.textContent).toBe(refusal)
      expect(document.querySelector('textarea')!.value).toBe('Every year?')
      await act(async () => root?.unmount()); root = null
    }
  })
  it('requireName makes the card ask for a first name before sending', async () => {
    stubFetch({ shared: [] })
    await mount({ comments: 'anyone', canShare: true, requireName: true })
    await startComment()
    await typeInto(document.querySelector('textarea')!, 'Every year?')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-save]')!.click() })
    expect(document.querySelector('[data-comment-card] [role="alert"]')!.textContent).toBe('Add your first name first.')
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  const SOMEONES = [{ id: 's1', name: 'Sam', value: value(text('river', 'The ', ' runs north'), 'Which river?'), at: '2026-09-28T00:00:00Z' }]
  const replyWith = async (name?: string) => {
    if (name) localStorage.setItem('artifacts:comment-name', name)
    stubFetch({ shared: SOMEONES })
    await mount({ comments: 'anyone', canShare: true, requireName: true })
    await open('s1')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-reply]')!.click() })
  }
  it('under requireName a reply carries the remembered first name', async () => {
    await replyWith('Kit')
    expect(document.querySelector<HTMLInputElement>('[data-comment-thread] [data-comment-name] input')!.value).toBe('Kit')
    await typeInto(document.querySelector('[data-comment-thread] textarea')!, 'The north one.')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-thread] form button[type="submit"]')!.click() })
    const sent = calls.find((c) => c.method === 'POST')!
    expect(sent.body).toMatchObject({ op: 'append', value: { body: 'The north one.', parent: 's1', by: 'Kit' } })
  })
  it('under requireName a reply with no remembered name asks for it and does not post without it', async () => {
    localStorage.removeItem?.('artifacts:comment-name')
    await replyWith()
    await typeInto(document.querySelector('[data-comment-thread] textarea')!, 'The north one.')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-thread] form button[type="submit"]')!.click() })
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
    expect(document.querySelector('[data-comment-thread] [role="alert"]')!.textContent).toBe('Add your first name first.')
    await typeInto(document.querySelector('[data-comment-thread] [data-comment-name] input')!, 'Kit')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-thread] form button[type="submit"]')!.click() })
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ value: { parent: 's1', by: 'Kit' } })
  })
  it('without requireName a reply has no name field and no by', async () => {
    stubFetch({ shared: SOMEONES })
    await mount({ comments: 'anyone', canShare: true })
    await open('s1')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-reply]')!.click() })
    expect(document.querySelector('[data-comment-thread] [data-comment-name]')).toBeNull()
    await typeInto(document.querySelector('[data-comment-thread] textarea')!, 'The north one.')
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-thread] form button[type="submit"]')!.click() })
    expect((calls.find((c) => c.method === 'POST')!.body as { value: object }).value).not.toHaveProperty('by')
  })
})

// The overlay is portalled onto document.body, outside the element the page's theme variables
// are set on, so without carrying them the chip and the Comment button drew with no colours:
// dark text on a dark page (found live on 2026-09-28).
describe('theme', () => {
  it('the portalled overlay carries the page theme variables from around the root', async () => {
    stubStorage(); stubFetch()
    document.documentElement.style.setProperty('--a-accent', '#c2a15c')
    document.documentElement.style.setProperty('--a-on-accent', '#101010')
    document.documentElement.style.setProperty('--a-surface', '#222')
    await mount()
    const ui = document.querySelector<HTMLElement>('body > [data-comment-ui]') ?? document.querySelector<HTMLElement>('[data-comment-ui]')!
    expect(ui.style.getPropertyValue('--a-accent')).toBe('#c2a15c')
    expect(ui.style.getPropertyValue('--a-on-accent')).toBe('#101010')
    expect(ui.style.getPropertyValue('--a-surface')).toBe('#222')
    for (const v of ['--a-accent', '--a-on-accent', '--a-surface']) document.documentElement.style.removeProperty(v)
  })
})

// A notification's link lands on the comment itself: /<id>#comment-<entryId> scrolls to its pin
// and opens its thread; a reply's opens its parent's; one on an earlier version is highlighted.
describe('deep link', () => {
  const SHARED: Row[] = [
    { id: 's1', name: 'Sam', value: value(text('river', 'The ', ' runs north'), 'Which river?'), at: '2026-09-28T00:00:00Z' },
    { id: 'r1', name: 'Jo', value: value(text('river', 'The ', ' runs north'), 'The north one.', { parent: 's1' }), at: '2026-09-28T00:00:01Z' },
    { id: 's2', name: 'Kit', value: value(text('floods'), 'Every year?'), at: '2026-09-28T00:00:02Z' },
    { id: 's3', name: 'Ada', value: value(text('a sentence that was cut'), 'Gone now'), at: '2026-09-28T00:00:03Z' },
  ]
  let scrolled: Element[]
  beforeEach(() => {
    stubStorage()
    scrolled = []
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) } as never
  })
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    history.replaceState(null, '', location.pathname)
  })
  const hash = (h: string) => history.replaceState(null, '', `${location.pathname}${h}`)
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  it('on load, scrolls the pin into view and opens its thread', async () => {
    hash('#comment-s2')
    stubFetch({ shared: SHARED })
    await mount({ comments: 'anyone', canShare: true })
    await settle()
    const thread = document.querySelector('[data-comment-thread]')
    expect(thread?.textContent).toContain('Every year?')
    expect(scrolled.map((e) => e.getAttribute('data-comment-id'))).toContain('s2')
  })

  it('a reply\'s link opens its parent\'s thread, with the reply in it', async () => {
    hash('#comment-r1')
    stubFetch({ shared: SHARED })
    await mount({ comments: 'anyone', canShare: true })
    await settle()
    const thread = document.querySelector('[data-comment-thread]')!
    expect(thread.textContent).toContain('Which river?')
    expect(thread.textContent).toContain('The north one.')
    expect(scrolled.map((e) => e.getAttribute('data-comment-id'))).toContain('s1')
  })

  it('a comment on an earlier version is scrolled to and highlighted in that list', async () => {
    hash('#comment-s3')
    stubFetch({ shared: SHARED })
    await mount({ comments: 'anyone', canShare: true })
    await settle()
    const li = document.querySelector('[data-comment-earlier-id="s3"]')!
    expect(li.hasAttribute('data-comment-highlight')).toBe(true)
    expect(document.querySelector('[data-comment-earlier-id][data-comment-highlight]:not([data-comment-earlier-id="s3"])')).toBeNull()
    expect(scrolled).toContain(li)
    expect(document.querySelector('[data-comment-thread]')).toBeNull()
  })

  it('a hashchange after load does the same, and an id this reader cannot see says so', async () => {
    stubFetch({ shared: SHARED })
    await mount({ comments: 'anyone', canShare: true })
    expect(document.querySelector('[data-comment-thread]')).toBeNull()
    hash('#comment-nope')
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await settle()
    expect(document.querySelector('[data-comment-thread]')).toBeNull()
    expect(scrolled).toEqual([])
    expect(document.querySelector('[data-comment-missing]')?.textContent).toMatch(/can't be shown/)
    hash('#comment-s1')
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await settle()
    expect(document.querySelector('[data-comment-thread]')?.textContent).toContain('Which river?')
    expect(scrolled.map((e) => e.getAttribute('data-comment-id'))).toContain('s1')
  })

  it('shows the pins again when the reader had hidden them', async () => {
    stubFetch({ shared: SHARED })
    await mount({ comments: 'anyone', canShare: true })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-button]')!.click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-pins-toggle]')!.click() })
    expect(document.querySelectorAll('[data-comment-pin]')).toHaveLength(0)
    hash('#comment-s2')
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await settle()
    expect(document.querySelector('[data-comment-id="s2"]')).not.toBeNull()
    expect(document.querySelector('[data-comment-thread]')?.textContent).toContain('Every year?')
  })

  it('a signed-out reader on a link they cannot see gets a Sign in button that returns to the comment', async () => {
    hash('#comment-hidden')
    stubFetch({ shared: SHARED })
    await mount({ comments: 'anyone', canShare: true, signIn: 'https://accounts.example.com/artifact/sign-in?to=https%3A%2F%2Fa.example.com%2Fabc23456' })
    await settle()
    const card = document.querySelector('[data-comment-missing]')!
    expect(card.textContent).toMatch(/visible to its owner and admins/)
    const link = card.querySelector<HTMLAnchorElement>('a[data-comment-missing-sign-in]')!
    expect(link.textContent).toBe('Sign in')
    const to = new URL(link.href).searchParams.get('to')!
    expect(to.endsWith('#comment-hidden')).toBe(true)
  })

  describe('a resolved thread (0.33.0)', () => {
    const resolvedThread = () => stubFetch({ shared: [
      { id: 's1', name: 'Sam', value: value(text('river', 'The ', ' runs north'), 'Which river?', { resolved: { at: '2026-10-12T00:00:00Z', by: 'Olive', note: 'Named it in the text' } }), at: '2026-09-28T00:00:00Z' },
      { id: 's1r', name: 'Jo', value: value(text('river', 'The ', ' runs north'), 'The north one.', { parent: 's1' }), at: '2026-09-28T00:00:01Z' },
      { id: 's2', name: 'Jo', value: value({ kind: 'region', block: 'b-img-00000003', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 'This bar', { resolved: { at: '2026-10-12T00:00:00Z', by: 'Olive' } }), at: '2026-09-28T00:00:02Z' },
      { id: 's3', name: 'Kit', value: value(text('floods'), 'Every year?'), at: '2026-09-28T00:00:03Z' },
    ] })

    it('draws a muted check pin, no box, and counts only open threads', async () => {
      resolvedThread()
      await mount({ comments: 'anyone', canShare: true })
      const pin = document.querySelector<HTMLElement>('[data-comment-id="s1"]')!
      expect(pin.hasAttribute('data-comment-resolved')).toBe(true)
      expect(pin.textContent).toBe('✓')
      expect(pin.getAttribute('aria-label')).toContain('Resolved: Named it in the text')
      expect(Number(pin.style.opacity)).toBeLessThan(1)
      expect(document.querySelector('[data-comment-id="s3"]')!.hasAttribute('data-comment-resolved')).toBe(false)
      // The resolved box comment keeps its pin but loses the box drawn over the page.
      expect(document.querySelector('[data-comment-id="s2"]')).not.toBeNull()
      expect(document.querySelector('[data-comment-box="s2"]')).toBeNull()
      expect(document.querySelector('[data-comment-button]')!.textContent).toBe('Comments · 1')
    })

    it('opens collapsed to "Resolved: <note>", and expands to the comment and its replies', async () => {
      resolvedThread()
      await mount({ comments: 'anyone', canShare: true })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="s1"]')!.click() })
      const t = document.querySelector('[data-comment-thread]')!
      expect(t.hasAttribute('data-comment-thread-resolved')).toBe(true)
      expect(t.querySelector('[data-comment-resolved-line]')!.textContent).toContain('Resolved: Named it in the text')
      expect(t.textContent).not.toContain('Which river?')
      expect(t.querySelector('[data-comment-expand]')!.textContent).toBe('Show comment and 1 reply')
      await act(async () => { t.querySelector<HTMLButtonElement>('[data-comment-expand]')!.click() })
      const open = document.querySelector('[data-comment-thread]')!
      expect(open.textContent).toContain('Which river?')
      expect(open.textContent).toContain('The north one.')
      expect(open.querySelector('[data-comment-resolved-line]')!.textContent).toContain('Resolved: Named it in the text')
      // With no note the line is just "Resolved".
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="s2"]')!.click() })
      expect(document.querySelector('[data-comment-thread] [data-comment-resolved-line]')!.textContent).toBe('✓ Resolved')
    })

    it('a reader gets no Resolve or Reopen; the owner resolves with a note and reopens', async () => {
      resolvedThread()
      await mount({ comments: 'anyone', canShare: true })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="s3"]')!.click() })
      expect(document.querySelector('[data-comment-resolve]')).toBeNull()
      await act(async () => root?.unmount()); root = null
      resolvedThread()
      await mount({ comments: 'anyone', canShare: true, signedIn: true, isOwner: true })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="s3"]')!.click() })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-resolve]')!.click() })
      const box = document.querySelector<HTMLTextAreaElement>('[data-comment-thread] textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Added the dates')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { box.form!.requestSubmit() })
      expect(calls.find((c) => c.url.endsWith('/resolve'))).toMatchObject({ url: '/api/artifacts/abc23456/resolve', method: 'POST', body: { entry: 's3', resolved: true, note: 'Added the dates' } })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="s1"]')!.click() })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-reopen]')!.click() })
      expect(calls.filter((c) => c.url.endsWith('/resolve')).at(-1)).toMatchObject({ body: { entry: 's1', resolved: false } })
    })

    it('an edit of my own resolved comment never sends the resolution back', async () => {
      stubFetch({ shared: [], mine: [{ id: 'm1', value: value(text('floods'), 'Mine', { resolved: { at: '2026-10-12T00:00:00Z', by: 'Olive' } }), at: '2026-09-28T00:00:00Z' }] })
      await mount({ comments: 'anyone', canShare: true, signedIn: true })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-id="m1"]')!.click() })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-expand]')!.click() })
      await act(async () => { document.querySelector<HTMLButtonElement>('[data-comment-edit]')!.click() })
      const box = document.querySelector<HTMLTextAreaElement>('[data-comment-thread] textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Mine, edited')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { box.form!.requestSubmit() })
      const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/state'))!
      expect(sent.body).toMatchObject({ op: 'replace', entry: 'm1', value: { body: 'Mine, edited' } })
      expect((sent.body as { value: object }).value).not.toHaveProperty('resolved')
    })
  })
})
