// Published pages: /<id>. Thin file; the behaviour is the shell's, the wiring is src/lib/routes.ts.
import type { Metadata } from 'next'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ key?: string | string[] }> }

export function generateMetadata(props: Props): Promise<Metadata> {
  return hubRoutes().generateMetadata(props)
}

export default function ArtifactPage(props: Props) {
  return hubRoutes().Page(props)
}
