import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { placeAnchor, indexText } from './comment-place.js'
import { NOTE_AT, SEEK_TO } from './page-bridge.js'
import { momentLabel } from '../artifacts/anchor.js'
import { VoiceNote } from '../widgets/voice-note.js'
import { CommentCard } from './comment-card.js'

let root: Root | null = null
async function mount(el: React.ReactNode) {
  document.body.innerHTML = '<div id="m"></div>'
  root = createRoot(document.getElementById('m')!)
  await act(async () => { root!.render(el) })
}
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.documentElement.removeAttribute('data-comments-on') })

const note = (end = 1) => (
  <VoiceNote src="a.m4a" label="" media="a.m4a" paragraphs={[[{ w: 'Hi', s: 0, e: end }]]} block={{ 'data-block': 'b-voice-0123abcd' }} />
)

describe('a note at a moment', () => {
  it('labels the time as the player does', () => {
    expect(momentLabel(14)).toBe('0:14')
    expect(momentLabel(3723)).toBe('1:02:03')
  })
  it('a time anchor is placed on its block', () => {
    document.body.innerHTML = '<div id="root"><div data-block="b-voice-0123abcd">x</div></div>'
    const r = document.getElementById('root')!
    expect(placeAnchor(r, indexText(r), { kind: 'time', block: 'b-voice-0123abcd', at: 14 })).toMatchObject({ kind: 'time' })
    expect(placeAnchor(r, indexText(r), { kind: 'time', block: 'b-voice-ffffffff', at: 14 })).toBeNull()
  })
  it('the voice note offers "Note at 0:00" only where comments are on, and announces the block and the time', async () => {
    await mount(note())
    expect(document.querySelector('[data-note-at]')).toBeNull()
    document.documentElement.setAttribute('data-comments-on', '')
    await mount(note())
    const seen = vi.fn()
    const on = (e: Event) => seen((e as CustomEvent).detail)
    window.addEventListener(NOTE_AT, on)
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent === 'Note at 0:00')!
    await act(async () => { b.click() })
    window.removeEventListener(NOTE_AT, on)
    expect(seen).toHaveBeenCalledWith({ block: 'b-voice-0123abcd', at: 0 })
  })
  it('a SEEK_TO for its block moves the recording', async () => {
    await mount(note(30))
    const audio = document.querySelector('audio')!
    Object.defineProperty(audio, 'readyState', { value: 4 })
    await act(async () => { window.dispatchEvent(new CustomEvent(SEEK_TO, { detail: { block: 'b-voice-0123abcd', at: 14 } })) })
    expect(audio.currentTime).toBe(14)
  })
  it('the card shows "At 0:14" and the line seeks the recording', async () => {
    const onSeek = vi.fn()
    await mount(<CommentCard ownerName="Robin" mode="anyone" canShare signedIn moment={{ label: '0:14', onSeek }} onSave={async () => null} onCancel={() => {}} />)
    const b = document.querySelector<HTMLButtonElement>('[data-comment-moment]')!
    expect(b.textContent).toBe('At 0:14')
    await act(async () => { b.click() })
    expect(onSeek).toHaveBeenCalled()
  })
})
