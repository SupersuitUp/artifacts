'use client'

import { useEffect, useState } from 'react'
import { formatUpdated } from '../artifacts/updated-at.js'

/** The exact minute a page was last updated, in the reader's own time zone once the page runs. */
export function UpdatedTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => formatUpdated(iso))
  useEffect(() => {
    setText(formatUpdated(iso, Intl.DateTimeFormat().resolvedOptions().timeZone))
  }, [iso])
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  )
}
