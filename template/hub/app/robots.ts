import type { MetadataRoute } from 'next'

// Every page here is shared by link and none is meant to be found.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
