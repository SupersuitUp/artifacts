import { hubRoutes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

// The recorder: the hub's owner records a voice eCard for each person in a batch.
export default function Page(props: { params: Promise<{ batch: string }> }) {
  return hubRoutes().RecordPage(props)
}
