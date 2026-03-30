import { NextRequest, NextResponse } from 'next/server'
import { resetSpotifyState } from '@/app/lib/spotify/status'

const RESET_KEY = process.env.SPOTIFY_RESET_KEY

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-reset-key')
  if (!RESET_KEY || secret !== RESET_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  resetSpotifyState()
  return NextResponse.json({ ok: true, message: 'Spotify status reset' })
}
