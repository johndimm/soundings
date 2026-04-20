import { NextRequest, NextResponse } from 'next/server'
import { getBaseUrl } from '@/app/lib/baseUrl'

/**
 * Enables YouTube-only mode without a Spotify account.
 *
 * Why this is a route handler (and not just `/player?youtube=1`):
 * the `?youtube=1` flag is lost the moment the user clicks the header "Player" link,
 * navigates from Settings via `router.push('/player')`, or refreshes into a deep link.
 * A cookie persists the choice so the server-rendered player page and layout can honor
 * it on every subsequent visit.
 */
export const YOUTUBE_MODE_COOKIE = 'earprint_youtube_mode'

export async function GET(req: NextRequest) {
  const base = getBaseUrl() || req.nextUrl.origin
  const target = new URL('/player', base)
  // Symmetric with the Spotify callback's `?spotify_login=1`: signals to the client that
  // this is a fresh YouTube login, so leftover Spotify-era localStorage (source field,
  // per-channel queues full of Spotify tracks) should be reset.
  target.searchParams.set('youtube_login', '1')
  const response = NextResponse.redirect(target, { status: 303 })
  response.cookies.set(YOUTUBE_MODE_COOKIE, '1', {
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
