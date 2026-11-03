// A brand mark served from a static https URL (an SVG in the hub's bucket), as the pack's Mark.
import type { ComponentType } from 'react'

export function markFromUrl(src: string, width: number, height: number): ComponentType<{ className?: string }> {
  return function UrlMark({ className }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} width={width} height={height} alt="" className={className} />
  }
}
