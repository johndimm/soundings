import { NextResponse } from 'next/server'
import {
  isYouTubeQuotaExceeded,
  getYouTubeQuotaWaitMs,
  getYouTubeCreditsRemaining,
  searchYouTube,
} from '@/app/lib/youtube'

export async function GET() {
  if (isYouTubeQuotaExceeded()) {
    return NextResponse.json({
      ok: false,
      quotaExceeded: true,
      retryAfterMs: getYouTubeQuotaWaitMs(),
      creditsRemaining: getYouTubeCreditsRemaining(),
      message: 'YouTube quota exceeded (server backoff — see Status for credit count)',
    })
  }

  // Do a real search to confirm the API key works and quota is truly available
  const result = await searchYouTube('test')
  if (result.status === 'quota_exceeded') {
    return NextResponse.json({
      ok: false,
      quotaExceeded: true,
      retryAfterMs: getYouTubeQuotaWaitMs(),
      creditsRemaining: getYouTubeCreditsRemaining(),
      message: 'YouTube quota exceeded',
    })
  }
  if (result.status === 'error') {
    return NextResponse.json({
      ok: false,
      quotaExceeded: false,
      creditsRemaining: getYouTubeCreditsRemaining(),
      message: result.message,
    })
  }

  return NextResponse.json({
    ok: true,
    quotaExceeded: false,
    creditsRemaining: getYouTubeCreditsRemaining(),
    message: 'YouTube is responding normally',
  })
}
