import { cookies } from 'next/headers'
import { refreshSpotifyAccessToken } from '@/app/lib/spotify/tokens'

export async function POST() {
  const cookieStore = await cookies()
  const refreshedToken = await refreshSpotifyAccessToken(cookieStore)

  if (!refreshedToken) {
    return Response.json({ error: 'refresh_failed' }, { status: 401 })
  }

  return Response.json({ ok: true })
}
