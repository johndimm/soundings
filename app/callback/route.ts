import { NextRequest, NextResponse } from 'next/server'
import { storeSpotifyTokensInResponse, type SpotifyTokenResponse } from '@/app/lib/spotify/tokens'
import { getBaseUrl } from '@/app/lib/baseUrl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const baseUrl = getBaseUrl() || req.nextUrl.origin

  if (error || !code) {
    return Response.redirect(`${baseUrl}/?error=spotify_auth_failed`, 302)
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: redirectUri,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    console.error('callback: token exchange failed', { status: response.status, body: errBody })
    return Response.redirect(`${getBaseUrl() || baseUrl}/?error=token_exchange_failed`, 302)
  }

  const tokens = (await response.json()) as SpotifyTokenResponse
  const requestIsHttps = req.nextUrl.protocol === 'https:'
  console.info('callback: token exchange result', {
    has_access_token: Boolean(tokens.access_token),
    has_refresh_token: Boolean(tokens.refresh_token),
    expires_in: tokens.expires_in,
  })

  const base = getBaseUrl() || req.nextUrl.origin
  const res = NextResponse.redirect(new URL('/player', base), {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  })
  // Single Set-Cookie path on the redirect response (avoids duplicate / merge quirks with cookies()).
  storeSpotifyTokensInResponse(res.cookies, tokens, requestIsHttps)
  console.info('callback: cookies set on redirect response → /player')
  return res
}
