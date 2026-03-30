import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/spotify/tokens'

export async function GET() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  console.info('spotify/me: invoking Spotify Web API')

  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn('spotify/me failed', { status: response.status, body: text })
    return NextResponse.json({ error: 'spotify_me_failed', status: response.status, body: text }, { status: 502 })
  }

  const data = await response.json()
  console.info('spotify/me response', {
    id: data.id,
    display_name: data.display_name,
    product: data.product,
  })
  return NextResponse.json({ ok: true, user: { id: data.id, display_name: data.display_name, product: data.product } })
}
