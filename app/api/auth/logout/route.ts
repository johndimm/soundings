import { NextRequest, NextResponse } from 'next/server'
import { clearSpotifyTokensFromResponse } from '@/app/lib/spotify/tokens'
import { getBaseUrl } from '@/app/lib/baseUrl'
import { YOUTUBE_MODE_COOKIE } from '@/app/api/auth/youtube/route'

export async function GET(req: NextRequest) {
  const base = getBaseUrl() || req.nextUrl.origin
  const url = new URL('/', base)
  const response = NextResponse.redirect(url, { status: 302 })
  clearSpotifyTokensFromResponse(response.cookies, req.nextUrl.protocol === 'https:')
  // Also forget YouTube-only mode so logging out always returns users to the landing picker,
  // regardless of how they signed in.
  response.cookies.set(YOUTUBE_MODE_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}
