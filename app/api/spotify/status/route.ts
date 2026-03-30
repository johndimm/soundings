import { NextResponse } from 'next/server'
import {
  getRateLimitRemainingMs,
  getSpotifyOfflineWaitMs,
  getRateLimitUntil,
  isSpotifyAvailable,
  isSpotifyOffline,
} from '@/app/lib/spotify/status'

export async function GET() {
  const available = isSpotifyAvailable()
  const retryAfterMs = available ? 0 : Math.max(getRateLimitRemainingMs(), 0) || getSpotifyOfflineWaitMs()
  const until = getRateLimitUntil()
  return NextResponse.json({
    available,
    retryAfterMs,
    offline: isSpotifyOffline(),
    until,
  })
}
