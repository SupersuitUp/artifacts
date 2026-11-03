import type { Metadata } from 'next'
import { parseHubEnv } from '@/lib/hub-env-parse'
import { hubMetadata } from '@/lib/hub-meta'
// The default pack's faces (DM Serif Display over DM Sans), self-hosted.
import '@fontsource/dm-serif-display/400.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import './globals.css'

// A hub may carry its own look, with its own web fonts.
const hub = parseHubEnv(process.env.HUB_TENANT)
const hubPack = hub?.pack

export function generateMetadata(): Metadata {
  return hubMetadata(hub)
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {hubPack?.fontsUrl && (
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={hubPack.fontsUrl} />
        </head>
      )}
      <body className="antialiased">{children}</body>
    </html>
  )
}
