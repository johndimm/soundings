import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { storeSpotifyTokens } from '@/app/lib/spotify/tokens'

export async function POST(req: NextRequest) {
  if (process.env.SKIP_TEST_LOGIN === 'true') {
    return NextResponse.json({ ok: false, message: 'disabled' }, { status: 403 })
  }

  const payload = (await req.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!payload.access_token || !payload.expires_in) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 })
  }

  const cookieStore = await cookies()
  storeSpotifyTokens(
    cookieStore,
    {
      access_token: payload.access_token,
      expires_in: payload.expires_in,
      refresh_token: payload.refresh_token,
    },
    req.nextUrl.protocol === 'https:'
  )

  return NextResponse.json({ ok: true })
}
