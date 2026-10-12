'use client'
// The frame an embed block plays in. It opens at the block's height and, when its embed page
// reports how tall the player is (simulator.ts, "A frame that fits"), takes that height, so a
// short device has no empty band under it and a tall one is not cut off.
import { useEffect, useRef, useState } from 'react'
import { fitFrom } from './simulator.js'

export function EmbedFrame({ src, title, height }: { src: string; title: string; height: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [fit, setFit] = useState<number | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const h = fitFrom(e.data, e.origin, src)
      if (h != null) setFit(h)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [src])
  return (
    <iframe ref={ref} src={src} title={title} loading="lazy" allow="microphone; autoplay; fullscreen"
      className="block w-full rounded-xl border border-[color:var(--a-line)]" style={{ height: fit != null ? `${fit}px` : height, border: 0 }} />
  )
}
