// One past version of a page: /<id>/v/<n>, read-only, behind the page's own door.
import type { Metadata } from 'next'
import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string; n: string }>; searchParams?: Promise<{ key?: string | string[] }> }

export function generateMetadata(props: Props): Promise<Metadata> {
  return hubRoutes().generateVersionMetadata(props)
}

export default function ArtifactVersionPage(props: Props) {
  return hubRoutes().VersionPage(props)
}
