import { NextRequest, NextResponse } from 'next/server'

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ')

export const dynamic = 'force-dynamic'

/**
 * Spotify OAuth. By default we do NOT send `prompt=consent` — that forces the full consent
 * screen every time and feels broken on repeat logins. Use `?consent=1` when you need a fresh
 * refresh token or re-authorization (Spotify may omit refresh_token on re-auth without it).
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID!
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!

  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  })

  const forceConsent = req.nextUrl.searchParams.get('consent') === '1'
  if (forceConsent) {
    params.set('prompt', 'consent')
  }

  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`)
}
