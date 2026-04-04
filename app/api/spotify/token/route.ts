import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAccessTokenExpiry,
  refreshSpotifyAccessToken,
  TOKEN_REFRESH_THRESHOLD_MS,
} from '@/app/lib/spotify/tokens'

/** Never cache — CDN-cached 401/JSON breaks the Web Playback SDK and causes login redirect loops on Vercel. */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private, must-revalidate' }

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const requestIsHttps = req.nextUrl.protocol === 'https:'
  let accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE })
  }

  const expiresAt = getAccessTokenExpiry(cookieStore)
  const now = Date.now()
  const needsRefresh = expiresAt === null || expiresAt - now < TOKEN_REFRESH_THRESHOLD_MS

  if (needsRefresh) {
    const refreshed = await refreshSpotifyAccessToken(cookieStore, requestIsHttps)
    if (refreshed) {
      accessToken = refreshed
    } else if (expiresAt !== null && expiresAt <= now) {
      // Expired and refresh failed — do not give the SDK a dead token (triggers auth_error → redirect loop).
      return NextResponse.json({ error: 'session_expired' }, { status: 401, headers: NO_STORE })
    }
  }

  return NextResponse.json({ accessToken }, { headers: NO_STORE })
}
