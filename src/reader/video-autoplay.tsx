'use client'

// Plays each inline video only while it is near the screen. With `autoplay` in the markup every
// video on the page downloads the moment it opens (the Freedom whitepaper: 21 diagrams, 6.8 MB,
// competing with the text and the narration on a phone). Here a video loads and plays as it
// comes within a screen of view and pauses when it leaves, so opening the page costs the text.
import { useEffect } from 'react'

export function VideoAutoplay() {
  useEffect(() => {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-artifact-video]'))
    if (!videos.length || typeof IntersectionObserver === 'undefined') {
      for (const v of videos) void v.play?.().catch(() => {})
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement
          if (e.isIntersecting) {
            v.preload = 'auto'
            void v.play().catch(() => {})
          } else v.pause()
        }
      },
      { rootMargin: '100% 0px' },
    )
    for (const v of videos) io.observe(v)
    return () => io.disconnect()
  }, [])
  return null
}
