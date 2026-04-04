import { NextRequest, NextResponse } from 'next/server'
import { clearSpotifyTokensFromResponse } from '@/app/lib/spotify/tokens'

export async function GET(req: NextRequest) {
  const url = new URL('/', req.url)
  const response = NextResponse.redirect(url, { status: 302 })
  clearSpotifyTokensFromResponse(response.cookies, req.nextUrl.protocol === 'https:')
  return response
}
