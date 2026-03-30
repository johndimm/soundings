import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/spotify/tokens'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!accessToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const { uri, deviceId } = (await req.json()) as { uri?: string; deviceId?: string }
  if (!uri || !deviceId) {
    return NextResponse.json({ error: 'missing_parameters' }, { status: 400 })
  }

  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
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
