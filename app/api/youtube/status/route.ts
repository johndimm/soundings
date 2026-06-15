import { NextResponse } from 'next/server'
import { getYouTubeQuotaStatus, probeYouTubeQuotaWhenBackoffActive } from '@/app/lib/youtube'
import { getLlmYouTubeIdStats } from '@/app/lib/llmYouTubeIdLog'

/** Quota counters; probes Google (1 credit) when server backoff is active to clear stale state. */
export async function GET() {
  const before = getYouTubeQuotaStatus()
  let probe = null
  if (before.googleBackoffActive) {
    probe = await probeYouTubeQuotaWhenBackoffActive()
  }
  const status = getYouTubeQuotaStatus()
  const llmIdStats = await getLlmYouTubeIdStats()
  return NextResponse.json(probe ? { ...status, probe, llmIdStats } : { ...status, llmIdStats })
}
