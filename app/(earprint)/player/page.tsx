import { cookies } from 'next/headers'
import { getBaseUrl } from '@/app/lib/baseUrl'
import { YOUTUBE_MODE_COOKIE } from '@/app/api/auth/youtube/route'

export const dynamic = 'force-dynamic'

export default async function PlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const guideDemo = typeof params['guide-demo'] === 'string' ? params['guide-demo'] : null
  const youtubeOnly = params['youtube'] === '1'
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('spotify_access_token')?.value
  // Cookie set by /api/auth/youtube — lets the user return to /player without the
  // `?youtube=1` query string (header nav, Settings redirect, etc).
  const youtubeCookieMode = cookieStore.get(YOUTUBE_MODE_COOKIE)?.value === '1'

  if (!accessToken && !guideDemo && !youtubeOnly && !youtubeCookieMode) {
    const base = getBaseUrl()
    const loginUrl = base ? `${base}/api/auth/login` : '/api/auth/login'
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-xl font-semibold">No Spotify session detected.</p>
          <p className="text-sm text-zinc-400 mt-2">
            <a href={loginUrl} className="underline text-emerald-400">Log in with Spotify</a>
          </p>
        </div>
      </div>
    )
  }

  return null
}
