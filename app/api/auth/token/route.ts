import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get('spotify_refresh_token')?.value

  if (!refreshToken) {
    return Response.json({ error: 'no_refresh_token' }, { status: 401 })
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
    return Response.json({ error: 'refresh_failed' }, { status: 401 })
  }

  const tokens = await response.json()

  cookieStore.set('spotify_access_token', tokens.access_token, {
    httpOnly: true,
    secure: false,
    maxAge: tokens.expires_in,
    path: '/',
  })

  return Response.json({ ok: true })
}
