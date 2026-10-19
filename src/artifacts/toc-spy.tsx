'use client'
// Marks the contents entry for the section being read. Renders nothing: it only sets
// aria-current on the links the server drew, which is also what styles them.
import { useEffect } from 'react'

/** How far below the top of the screen a heading may sit and still be the section being read. */
export const READING_LINE = 140

/** The section being read: the last heading at or above the reading line, else the first. The
 *  page analytics times sections by the same rule, so a section's dwell matches the rail. */
export function currentSection(ids: string[], doc: Document = document): string | undefined {
  let current = ids[0]
  for (const id of ids) {
    const el = doc.getElementById(id)
    if (el && el.getBoundingClientRect().top <= READING_LINE) current = id
  }
  return current
}

export function TocSpy({ slugs }: { slugs: string[] }) {
  const key = slugs.join('|')
  useEffect(() => {
    const ids = key.split('|')
    let frame = 0
    const mark = () => {
      frame = 0
      const current = currentSection(ids)
      document.querySelectorAll<HTMLAnchorElement>('a[data-toc-slug]').forEach((a) => {
        if (a.dataset.tocSlug === current) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(mark)
    }
    mark()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key])
  return null
}
