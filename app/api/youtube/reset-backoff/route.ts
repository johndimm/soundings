import { NextResponse } from 'next/server'
import {
  clearYouTubeQuotaBackoff,
  getYouTubeCreditsRemaining,
  getYouTubeCreditsUsed,
} from '@/app/lib/youtube'

/** Dev-only: clear server backoff after Google quota has reset (local counter may still be low). */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }
  clearYouTubeQuotaBackoff()
  return NextResponse.json({
    ok: true,
    creditsUsed: getYouTubeCreditsUsed(),
    creditsRemaining: getYouTubeCreditsRemaining(),
    message: 'Server YouTube backoff cleared. Also clear Player backoff in the browser (button on Status) or reload the player.',
  })
}
