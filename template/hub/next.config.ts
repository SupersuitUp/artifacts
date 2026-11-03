import type { NextConfig } from 'next'
// Relative and import-free on purpose: Next's config loader does not resolve the `@/` alias.
import { parseHubEnv } from './src/lib/hub-env-parse'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
  // Loaded at runtime from node_modules rather than bundled, like firebase-admin.
  serverExternalPackages: ['@google-cloud/storage'],
  // Firebase's Google sign-in handler, served same-origin so Safari keeps the sign-in. No host
  // condition: behind App Hosting the request's Host header is not the public host, so a
  // `has: host` match would never fire and Google sign-in would 404.
  async rewrites() {
    const hub = parseHubEnv(process.env.HUB_TENANT)
    return hub ? [{ source: '/__/auth/:path*', destination: `https://${hub.firebase.projectId}.firebaseapp.com/__/auth/:path*` }] : []
  },
  // The share card and the door's card read the package's font from disk at request time. Next's
  // tracer does not follow the package's own literal into node_modules, so these are load-bearing.
  // The key is a glob: '[id]' would be a character class and match nothing.
  outputFileTracingIncludes: {
    '/*/share.png': ['./node_modules/@supersuit/artifacts/fonts/**'],
    '/frapp/og': ['./node_modules/@supersuit/artifacts/fonts/**'],
    '/frapp/font': ['./node_modules/@supersuit/artifacts/fonts/**'],
  },
}

export default nextConfig
