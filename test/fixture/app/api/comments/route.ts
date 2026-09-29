import type { NextRequest } from 'next/server'
import { artifacts } from '../../../routes'
export function GET(request: NextRequest) { return artifacts.COMMENTS_FEED(request) }
