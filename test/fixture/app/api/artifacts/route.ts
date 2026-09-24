import type { NextRequest } from 'next/server'
import { artifacts } from '../../../routes'
export function POST(request: NextRequest) {
  return artifacts.POST(request)
}
