import { NextResponse } from 'next/server'
import {
  isYouTubeQuotaExceeded,
  getYouTubeQuotaWaitMs,
  getYouTubeSearchesRemaining,
  getYouTubeQuotaStatus,
  probeYouTubeQuotaWhenBackoffActive,
  searchYouTube,
} from '@/app/lib/youtube'

export async function GET() {
  if (getYouTubeQuotaStatus().googleBackoffActive) {
    await probeYouTubeQuotaWhenBackoffActive()
  }

  if (isYouTubeQuotaExceeded()) {
    return NextResponse.json({
      ok: false,
      quotaExceeded: true,
      retryAfterMs: getYouTubeQuotaWaitMs(),
      searchesRemaining: getYouTubeSearchesRemaining(),
      message: 'YouTube quota exceeded (server backoff — see Status for search count)',
    })
  }

  // Do a real search to confirm the API key works and quota is truly available
  const result = await searchYouTube('test')
  if (result.status === 'quota_exceeded') {
    return NextResponse.json({
      ok: false,
      quotaExceeded: true,
      retryAfterMs: getYouTubeQuotaWaitMs(),
      searchesRemaining: getYouTubeSearchesRemaining(),
      message: 'YouTube quota exceeded',
    })
  }
  if (result.status === 'error') {
    return NextResponse.json({
      ok: false,
      quotaExceeded: false,
      searchesRemaining: getYouTubeSearchesRemaining(),
      message: result.message,
    })
  }

  return NextResponse.json({
    ok: true,
    quotaExceeded: false,
    searchesRemaining: getYouTubeSearchesRemaining(),
    message: 'YouTube is responding normally',
  })
}
