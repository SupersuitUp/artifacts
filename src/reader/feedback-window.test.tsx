import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FeedbackWindow, FEEDBACK_CLOSED_LINE, timeLeft } from './feedback-window.js'

const at = Date.parse('2026-10-13T12:00:00Z')

describe('timeLeft', () => {
  it('counts in days, then hours, then minutes as it gets close, and stops at the close', () => {
    expect(timeLeft('2026-10-16T12:00:00Z', at)).toBe('3 days left')
    expect(timeLeft('2026-10-14T11:00:00Z', at)).toBe('23 hours left')
    expect(timeLeft('2026-10-13T12:45:00Z', at)).toBe('45 minutes left')
    expect(timeLeft('2026-10-13T12:00:30Z', at)).toBe('1 minute left')
    expect(timeLeft('2026-10-13T12:00:00Z', at)).toBeNull()
    expect(timeLeft('not a time', at)).toBeNull()
  })
})

describe('FeedbackWindow', () => {
  let root: Root | null = null
  const mount = async (el: React.ReactNode) => {
    document.body.innerHTML = '<div id="m"></div>'
    root = createRoot(document.getElementById('m')!)
    await act(async () => { root!.render(el) })
  }
  afterEach(async () => { await act(async () => root?.unmount()); root = null })

  it('says whose draft it is, who it is for, what feedback is wanted and how long is left', async () => {
    await mount(<FeedbackWindow owner="Robin Vale" label="Reader A" note="Is the ending earned?" group={false} closesAt="2026-10-16T12:00:00Z" now={at} />)
    const box = document.querySelector('[data-feedback-window]')!
    expect(box.hasAttribute('data-nospeak')).toBe(true)
    expect(box.textContent).toContain('A draft from Robin Vale, for Reader A')
    expect(box.textContent).toContain('Is the ending earned?')
    expect(document.querySelector('[data-feedback-left]')!.textContent).toBe('Feedback is open: 3 days left.')
  })
  it('an open link names nobody, and a closed window says so', async () => {
    await mount(<FeedbackWindow owner="Robin Vale" label="Anyone with the link" note={null} group closesAt="2026-10-13T11:00:00Z" now={at} />)
    expect(document.querySelector('[data-feedback-window]')!.textContent).not.toContain('Anyone with the link')
    expect(document.querySelector('[data-feedback-left]')!.textContent).toBe(FEEDBACK_CLOSED_LINE)
  })
  it('a closing time that cannot be read is treated as closed, never as open', async () => {
    await mount(<FeedbackWindow owner="Robin Vale" label="Reader A" note={null} group={false} closesAt="soon-ish" now={at} />)
    expect(document.querySelector('[data-feedback-left]')!.textContent).toBe(FEEDBACK_CLOSED_LINE)
  })
})
