import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    redirect('/?error=spotify_auth_failed')
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
    redirect('/?error=token_exchange_failed')
  }

  const tokens = await response.json()
  const cookieStore = await cookies()

  cookieStore.set('spotify_access_token', tokens.access_token, {
    httpOnly: true,
    secure: false, // localhost only
    maxAge: tokens.expires_in,
    path: '/',
  })

  if (tokens.refresh_token) {
    cookieStore.set('spotify_refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: false,
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })
  }

  redirect('/player')
}
