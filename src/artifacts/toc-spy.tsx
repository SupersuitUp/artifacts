'use client'
// Marks the contents entry for the section being read. Renders nothing: it only sets
// aria-current on the links the server drew, which is also what styles them.
import { useEffect } from 'react'

export function TocSpy({ slugs }: { slugs: string[] }) {
  const key = slugs.join('|')
  useEffect(() => {
    const ids = key.split('|')
    let frame = 0
    const mark = () => {
      frame = 0
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 140) current = id
      }
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
