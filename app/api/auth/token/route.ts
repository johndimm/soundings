import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { refreshSpotifyAccessToken } from '@/app/lib/spotify/tokens'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const requestIsHttps = req.nextUrl.protocol === 'https:'
  const refreshedToken = await refreshSpotifyAccessToken(cookieStore, requestIsHttps)

  if (!refreshedToken) {
    return Response.json({ error: 'refresh_failed' }, { status: 401 })
  }

  return Response.json({ ok: true })
}
