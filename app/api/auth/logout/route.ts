import { NextRequest, NextResponse } from 'next/server'
import { clearSpotifyTokensFromResponse } from '@/app/lib/spotify/tokens'
import { getBaseUrl } from '@/app/lib/baseUrl'

export async function GET(req: NextRequest) {
  const base = getBaseUrl() || req.nextUrl.origin
  const url = new URL('/', base)
  const response = NextResponse.redirect(url, { status: 302 })
  clearSpotifyTokensFromResponse(response.cookies, req.nextUrl.protocol === 'https:')
  return response
}
