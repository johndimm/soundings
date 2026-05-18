import { NextResponse } from 'next/server'
import { getYouTubeQuotaStatus } from '@/app/lib/youtube'

/** Read-only quota counters — does not call search.list (no quota cost). */
export async function GET() {
  return NextResponse.json(getYouTubeQuotaStatus())
}
