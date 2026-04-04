import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/spotify/tokens'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const { uri, deviceId } = (await req.json()) as { uri?: string; deviceId?: string | null }
  if (!uri) {
    return NextResponse.json({ error: 'missing_parameters' }, { status: 400 })
  }

  /** Omit `device_id` to use Spotify&apos;s currently active device (Web SDK not ready yet, or another app). */
  const playUrl =
    deviceId && deviceId.trim()
      ? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`
      : 'https://api.spotify.com/v1/me/player/play'

  const response = await fetch(playUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [uri] }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return NextResponse.json(
      { error: 'spotify_play_error', status: response.status, body: text },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true })
}
