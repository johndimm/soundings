import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAccessTokenExpiry,
  refreshSpotifyAccessToken,
  TOKEN_REFRESH_THRESHOLD_MS,
} from '@/app/lib/spotify/tokens'

/** Keep in sync with /api/spotify/token — avoid calling /v1/me with a stale access token. */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private, must-revalidate' } as const

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
      return NextResponse.json({ error: 'session_expired' }, { status: 401, headers: NO_STORE })
    }
  }

  console.info('spotify/me: invoking Spotify Web API', {
    tokenLength: accessToken.length,
    tokenPrefix: accessToken.slice(0, 8),
    tokenSuffix: accessToken.slice(-4),
    hasWhitespace: /\s/.test(accessToken),
  })

  const callMe = (token: string) =>
    fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })

  let response = await callMe(accessToken)
  if (response.status === 401) {
    const again = await refreshSpotifyAccessToken(cookieStore, requestIsHttps)
    if (again) {
      response = await callMe(again)
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn('spotify/me failed', { status: response.status, body: text })
    if (response.status === 401) {
      return NextResponse.json({ error: 'session_expired' }, { status: 401, headers: NO_STORE })
    }
    return NextResponse.json(
      { error: 'spotify_me_failed', status: response.status, body: text },
      { status: 502, headers: NO_STORE }
    )
  }

  const data = await response.json()
  console.info('spotify/me response', {
    id: data.id,
    display_name: data.display_name,
    product: data.product,
  })
  return NextResponse.json(
    { ok: true, user: { id: data.id, display_name: data.display_name, product: data.product } },
    { headers: NO_STORE }
  )
}
