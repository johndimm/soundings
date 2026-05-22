import { NextResponse } from 'next/server'
import { getYouTubeQuotaStatus, probeYouTubeQuotaWhenBackoffActive } from '@/app/lib/youtube'

/** Quota counters; probes Google (1 credit) when server backoff is active to clear stale state. */
export async function GET() {
  const before = getYouTubeQuotaStatus()
  let probe = null
  if (before.googleBackoffActive) {
    probe = await probeYouTubeQuotaWhenBackoffActive()
  }
  const status = getYouTubeQuotaStatus()
  return NextResponse.json(probe ? { ...status, probe } : status)
}
