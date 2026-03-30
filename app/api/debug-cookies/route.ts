import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const cookieStore = await cookies()
  const all = cookieStore.getAll()
  const names = all.map(c => c.name)
  const spotifyKeys = ['spotify_access_token', 'spotify_refresh_token', 'spotify_access_token_expires_at']
  const spotifyDiag = spotifyKeys.map(k => {
    const v = cookieStore.get(k)?.value
    return { name: k, present: Boolean(v), length: v?.length ?? 0, prefix: v?.slice(0, 8) ?? null }
  })
  return NextResponse.json({ allCookieNames: names, spotify: spotifyDiag })
}
