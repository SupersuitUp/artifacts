'use client'

// A copy button on every code block, and it is the point of a code block here rather than a
// convenience on top of it. This host's fences mostly hold something the reader is meant to
// PUT somewhere: a command to run, a prompt to paste into their own agent. Until now the only
// way to take one was to select it by hand, and on a phone, inside a horizontally scrolling
// box, that is most of a minute of fighting the selection handles.
//
// Earned 2026-09-30: an operator published a setup page to open on somebody else's laptop,
// with the paste-in block as the whole reason the page existed, and there was nothing to press.
import { useEffect } from 'react'

const COPY = 'Copy'
const DONE = 'Copied'

export function CodeCopy() {
  useEffect(() => {
    const pres = Array.from(document.querySelectorAll<HTMLPreElement>('pre[data-artifact-code]'))
    const timers: ReturnType<typeof setTimeout>[] = []
    const added: HTMLElement[] = []

    for (const pre of pres) {
      if (pre.querySelector('[data-artifact-copy]')) continue
      // The button is positioned against the pre, so the pre becomes the containing block. It
      // is set here rather than in the class list because the server render must stay valid
      // with no JavaScript: a page with this component disabled shows a plain block.
      pre.style.position = 'relative'

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.dataset.artifactCopy = 'true'
      btn.textContent = COPY
      btn.setAttribute('aria-label', 'Copy this block')
      btn.className =
        'absolute right-2 top-2 rounded-md border px-2 py-1 text-xs opacity-70 ' +
        'transition hover:opacity-100 focus-visible:opacity-100'
      btn.style.borderColor = 'var(--a-line)'
      btn.style.color = 'var(--a-strong)'
      btn.style.background = 'var(--a-code)'

      btn.addEventListener('click', () => {
        // The button lives inside the pre, so its own label would be copied with the code.
        const code = pre.querySelector('code')
        const text = (code ?? pre).textContent ?? ''
        const done = () => {
          btn.textContent = DONE
          timers.push(setTimeout(() => { btn.textContent = COPY }, 1600))
        }
        // navigator.clipboard is undefined on a page served over plain http, which is every
        // local preview, so the textarea path is a real fallback rather than old-browser
        // defensiveness.
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(done, () => { btn.textContent = 'Press to select' })
          return
        }
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); done() } catch { btn.textContent = 'Press to select' }
        ta.remove()
      })

      pre.appendChild(btn)
      added.push(btn)
    }

    return () => {
      for (const t of timers) clearTimeout(t)
      for (const b of added) b.remove()
    }
  }, [])

  return null
}
