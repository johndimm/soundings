import { NextResponse } from 'next/server'

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ')

export const dynamic = 'force-dynamic'

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID!
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!

  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    /** Spotify only returns a refresh_token on first auth unless we force consent again. */
    prompt: 'consent',
  })

  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`)
}
