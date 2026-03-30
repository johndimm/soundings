import { NextRequest } from 'next/server'
import { buildSpotifyTokenSetCookieHeaders, type SpotifyTokenResponse } from '@/app/lib/spotify/tokens'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const baseUrl = new URL('/', req.url).origin

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
    return Response.redirect(`${baseUrl}/?error=token_exchange_failed`, 302)
  }

  const tokens = (await response.json()) as SpotifyTokenResponse
  console.info('callback: token exchange result', {
    has_access_token: Boolean(tokens.access_token),
    has_refresh_token: Boolean(tokens.refresh_token),
    expires_in: tokens.expires_in,
  })

  const setCookieHeaders = buildSpotifyTokenSetCookieHeaders(tokens)
  console.info('callback: setting cookies', setCookieHeaders.map(h => h.split('=')[0]))

  const headers = new Headers({ Location: `${baseUrl}/player` })
  for (const cookie of setCookieHeaders) {
    headers.append('Set-Cookie', cookie)
  }
  return new Response(null, { status: 302, headers })
}
