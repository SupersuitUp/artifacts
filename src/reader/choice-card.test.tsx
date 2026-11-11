import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { ChoiceCard, HUB_CHOICE_LOOK, CHOICE_TYPE_WORDS } from './choice-card.js'

const options = [{ label: 'Your own AI', because: 'Says what is different.', recommended: true }, { label: 'Stop the toil', because: 'Names the pain.', recommended: false }]

let root: Root | null = null
async function mount(el: React.ReactNode) {
  document.body.innerHTML = '<div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(el) })
}
afterEach(async () => { await act(async () => root?.unmount()); root = null })
const buttons = () => [...document.querySelectorAll('button')]
const btn = (re: RegExp | string) => buttons().find((b) => (typeof re === 'string' ? b.textContent === re : re.test(b.textContent ?? '')))!
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('ChoiceCard', () => {
  it('draws the kicker, the count, the question, each option with its reason, the Recommended mark and the other button', async () => {
    await mount(<ChoiceCard kicker={`Gary asks · ${CHOICE_TYPE_WORDS['pick-one']}`} number={1} total={2} question="Which headline?" options={options}
      picked="Your own AI" said={null} changed={null} otherWords="Dana says something else" onPick={() => {}} onOther={() => {}} look={HUB_CHOICE_LOOK} attrs={{ 'data-ask-card': 'headline' }} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Gary asks · Pick one')
    expect(text).toContain('1 of 2')
    expect(document.querySelector('[role="heading"][aria-level="3"]')!.textContent).toBe('Which headline?')
    const on = btn(/Your own AI/)
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.hasAttribute('data-recommended')).toBe(true)
    expect(on.textContent).toContain('Recommended')
    expect(btn(/Stop the toil/).getAttribute('aria-pressed')).toBe('false')
    expect(btn('Dana says something else')).toBeTruthy()
    expect(document.querySelector('[data-ask-card="headline"]')).toBeTruthy()
  })
  it('a tap names the option; the other button calls onOther; a box replaces it', async () => {
    const onPick = vi.fn(), onOther = vi.fn()
    const card = (extra: object) => <ChoiceCard kicker="k" number={1} total={1} question="q" options={options} picked={null} said={null} changed={null} otherWords="Say something else" onPick={onPick} onOther={onOther} look={HUB_CHOICE_LOOK} {...extra} />
    await mount(card({}))
    await click(btn(/Stop the toil/))
    await click(btn('Say something else'))
    expect(onPick).toHaveBeenCalledWith('Stop the toil')
    expect(onOther).toHaveBeenCalledOnce()
    await act(async () => root!.render(card({ otherWords: 'x', said: 'Dana said: Neither', changed: 'Gary changed this. Please look again', box: <textarea aria-label="Your answer" /> })))
    expect(btn('x')).toBeUndefined()
    expect(document.querySelector('textarea[aria-label="Your answer"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Dana said: Neither')
    expect(document.body.textContent).toContain('Gary changed this. Please look again')
  })
  it('the ./choice-card entry imports react only, so a Vite app can use it', () => {
    const src = readFileSync('src/reader/choice-card.tsx', 'utf8') + readFileSync('src/choice-card.ts', 'utf8')
    const from = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    expect(from.every((f) => f === 'react' || f.startsWith('./') || f.startsWith('../reader/'))).toBe(true)
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.exports['./choice-card']).toEqual({ types: './lib/choice-card.d.ts', default: './lib/choice-card.js' })
    expect(pkg.peerDependenciesMeta.next).toEqual({ optional: true })
    expect(pkg.peerDependenciesMeta['firebase-admin']).toEqual({ optional: true })
  })
})
