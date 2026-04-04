import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE_NAME, refreshSpotifyAccessToken, getAccessTokenExpiry, TOKEN_REFRESH_THRESHOLD_MS } from '@/app/lib/spotify/tokens'
import { resetSpotifyState } from '@/app/lib/spotify/status'

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const requestIsHttps = req.nextUrl.protocol === 'https:'
  let accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!accessToken) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 })
  }

  const expiresAt = getAccessTokenExpiry(cookieStore)
  if (expiresAt === null || expiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
    const refreshed = await refreshSpotifyAccessToken(cookieStore, requestIsHttps)
    if (refreshed) accessToken = refreshed
  }

  const start = Date.now()
  const res = await fetch('https://api.spotify.com/v1/search?q=test&type=track&limit=1', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const latencyMs = Date.now() - start

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 30)
    return NextResponse.json({
      ok: false,
      status: 429,
      retryAfterMs: retryAfter * 1000,
      latencyMs,
      message: `Rate limited — retry after ${retryAfter}s`,
    })
  }

  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ ok: false, status: res.status, latencyMs, message: 'Unauthorized' })
  }

  if (!res.ok) {
    return NextResponse.json({ ok: false, status: res.status, latencyMs, message: `Spotify returned ${res.status}` })
  }

  resetSpotifyState()
  return NextResponse.json({ ok: true, status: 200, latencyMs, message: 'Spotify is responding normally' })
}
