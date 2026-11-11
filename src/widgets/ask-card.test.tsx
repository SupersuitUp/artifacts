import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AskFence, YourAnswers, type AskCtx } from './ask-card.js'
import { askStoreFor } from './ask-store.js'

// A small stand-in for Testing Library, which this repo does not install: react-dom plus act.
let root: Root | null = null
afterEach(async () => { await act(async () => root?.unmount()); root = null })
async function render(el: ReactNode) { document.body.innerHTML = '<div id="m"></div>'; root = createRoot(document.getElementById('m')!); await act(async () => { root!.render(el) }) }
const same = (have: string, want: string | RegExp) => (typeof want === 'string' ? have === want : want.test(have))
const nameOf = (e: Element) => e.getAttribute('aria-label') ?? e.textContent ?? ''
const screen = {
  queryAllByRole: (role: string, o: { name: string | RegExp }) => [...document.querySelectorAll(role)].filter((e) => same(nameOf(e), o.name)),
  getByRole(role: string, o: { name: string | RegExp }) { const f = this.queryAllByRole(role, o); if (f.length !== 1) throw new Error(`${f.length} ${role} named ${o.name}`); return f[0] as HTMLElement },
  getByLabelText(t: string) { const e = document.querySelector(`[aria-label="${t}"]`); if (!e) throw new Error(`no label ${t}`); return e as HTMLInputElement },
  getByText(t: string) { const e = [...document.querySelectorAll('*')].find((x) => x.children.length === 0 && x.textContent === t); if (!e) throw new Error(`no text ${t}`); return e },
  async findByText(t: string) { return waitFor(() => this.getByText(t)) },
}
const fireEvent = {
  click: (e: Element) => { void act(() => { (e as HTMLElement).click() }) },
  change: (e: HTMLInputElement | HTMLTextAreaElement, o: { target: { value: string } }) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!
    void act(() => { set.call(e, o.target.value); e.dispatchEvent(new Event('input', { bubbles: true })) })
  },
}
async function waitFor<T>(f: () => T): Promise<T> {
  let last: unknown
  for (let i = 0; i < 50; i++) { try { return await act(async () => { await new Promise((r) => setTimeout(r, 10)); return f() }) } catch (e) { last = e } }
  throw last
}

const HEAD = { id: 'headline', type: 'pick-one' as const, question: 'Which headline should the page open with?', hash: '0123456789ab',
  options: [{ label: 'Your own AI, on your own computer', because: 'Says what is different in eight words.', recommended: true }, { label: 'Stop doing the toil by hand', because: 'Names the pain, but not the product.', recommended: false }] }
const PRICE = { id: 'price', type: 'accept-or-reject' as const, question: 'Show the activation price on this page?', hash: 'abcdef012345',
  options: [{ label: 'Accept: show it', because: 'No surprise on the first call.', recommended: true }, { label: 'Reject: say it on the call', because: 'A shorter page.', recommended: false }] }
let n = 0
const ctx = (over: Partial<AskCtx> = {}): AskCtx => ({ artifactId: `page${++n}abc`.slice(0, 8), asks: [HEAD, PRICE], owner: 'Gary', reader: 'Dana', requireName: false, display: 'serif', ...over })
const served = (mine: unknown[] = []) => vi.fn(async (_u: string, init?: RequestInit) =>
  new Response(init?.method === 'POST' ? '{"ok":true}' : JSON.stringify({ slots: { asks: { mine } } }), { status: init?.method === 'POST' ? 201 : 200 }))

describe('an ask card', () => {
  it('says who asks, which of how many, and Dana says something else', async () => {
    const c = ctx(); askStoreFor(c.artifactId, served())
    await render(<AskFence id="headline" ctx={c} />)
    expect(screen.getByText('Gary asks · Pick one')).toBeTruthy()
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dana says something else' })).toBeTruthy()
  })
  it('a tap sends exactly one append to the asks slot, with the ask\'s hash', async () => {
    const c = ctx(); const f = served(); askStoreFor(c.artifactId, f)
    await render(<AskFence id="headline" ctx={c} />)
    fireEvent.click(screen.getByRole('button', { name: /Stop doing the toil/ }))
    await waitFor(() => expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
    const [url, init] = f.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(url).toBe(`/api/artifacts/${c.artifactId}/state`)
    expect(JSON.parse(String(init!.body))).toEqual({ slot: 'asks', op: 'append', value: { ask: 'headline', hash: '0123456789ab', choice: 'Stop doing the toil by hand', words: null } })
    expect(screen.getByRole('button', { name: /Stop doing the toil/ }).getAttribute('aria-pressed')).toBe('true')
  })
  it('says something else: the words go as an answer with no choice', async () => {
    const c = ctx(); const f = served(); askStoreFor(c.artifactId, f)
    await render(<AskFence id="headline" ctx={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dana says something else' }))
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Neither. Say what it costs.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
    expect(JSON.parse(String(f.mock.calls.find(([, i]) => i?.method === 'POST')![1]!.body)).value).toEqual({ ask: 'headline', hash: '0123456789ab', choice: null, words: 'Neither. Say what it costs.' })
  })
  it('an answer to an earlier version shows "Gary changed this. Please look again"', async () => {
    const c = ctx(); askStoreFor(c.artifactId, served([{ id: 'e1', value: { ask: 'headline', hash: 'oldoldoldold', choice: 'Stop doing the toil by hand', words: null }, at: 'x' }]))
    await render(<AskFence id="headline" ctx={c} />)
    await screen.findByText('Gary changed this. Please look again')
  })
  it('on a group link it asks for a first name before the first answer, and sends it', async () => {
    const c = ctx({ reader: null, requireName: true }); const f = served(); askStoreFor(c.artifactId, f)
    await render(<AskFence id="headline" ctx={c} />)
    fireEvent.change(screen.getByLabelText('Your first name'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByRole('button', { name: /Your own AI/ }))
    await waitFor(() => expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
    expect(JSON.parse(String(f.mock.calls.find(([, i]) => i?.method === 'POST')![1]!.body)).value.name).toBe('Ann')
  })
})

describe('Your answers', () => {
  it('lists each ask with the answer or what is recommended, and Change or Make it', async () => {
    const c = ctx(); askStoreFor(c.artifactId, served([{ id: 'e1', value: { ask: 'headline', hash: '0123456789ab', choice: 'Your own AI, on your own computer', words: null }, at: 'x' }]))
    await render(<YourAnswers ctx={c} />)
    await screen.findByText('Your own AI, on your own computer')
    expect(screen.getByText('Not made yet. Recommended: Accept: show it')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change: Which headline should the page open with?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make it: Show the activation price on this page?' })).toBeTruthy()
    expect(screen.getByText('Saved as you go. Your answers reach Gary within a few minutes.')).toBeTruthy()
  })
})
