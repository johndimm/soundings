import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAccessTokenExpiry,
  refreshSpotifyAccessToken,
  TOKEN_REFRESH_THRESHOLD_MS,
} from '@/app/lib/spotify/tokens'

export async function GET() {
  const cookieStore = await cookies()
  let accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const expiresAt = getAccessTokenExpiry(cookieStore)
  if (expiresAt === null || expiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
    const refreshed = await refreshSpotifyAccessToken(cookieStore)
    if (refreshed) accessToken = refreshed
  }

  return NextResponse.json({ accessToken })
}
