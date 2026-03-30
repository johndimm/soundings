import { NextRequest, NextResponse } from 'next/server'
import { storeSpotifyTokensInResponse, type SpotifyTokenResponse } from '@/app/lib/spotify/tokens'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(new URL('/?error=spotify_auth_failed', req.url))
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
    return NextResponse.redirect(new URL('/?error=token_exchange_failed', req.url))
  }

  const tokens = (await response.json()) as SpotifyTokenResponse
  const redirectResponse = NextResponse.redirect(new URL('/player', req.url))
  storeSpotifyTokensInResponse(redirectResponse.cookies, tokens)
  return redirectResponse
}
