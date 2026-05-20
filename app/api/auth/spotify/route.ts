import { NextRequest, NextResponse } from 'next/server'
import { getBaseUrl } from '@/app/lib/baseUrl'
import { YOUTUBE_MODE_COOKIE } from '@/app/api/auth/youtube/route'

/**
 * Enter Spotify playback mode (clears YouTube-only cookie, signals fresh-login reset).
 * Used when the user already has a Spotify session and clicks Spotify on the landing page.
 */
export async function GET(req: NextRequest) {
  const base = getBaseUrl() || req.nextUrl.origin
  const target = new URL('/player', base)
  target.searchParams.set('spotify_login', '1')
  const response = NextResponse.redirect(target, { status: 303 })
  response.cookies.set(YOUTUBE_MODE_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}
