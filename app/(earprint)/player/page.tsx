import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBaseUrl } from '@/app/lib/baseUrl'
import { kvGet } from '@/app/lib/kvStore'
import { parseShareId } from '@/app/lib/shareId'
import { YOUTUBE_MODE_COOKIE } from '@/app/api/auth/youtube/route'

/** Must match `SHARE_KEY_PREFIX` in `app/api/share/route.ts`. */
const SHARE_KV_PREFIX = 'earprint:share:'

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

  const shareRaw =
    typeof params['share'] === 'string'
      ? params['share']
      : Array.isArray(params['share'])
        ? params['share'][0]
        : undefined
  const shareId = parseShareId(shareRaw)

  // Shared links must work without Spotify when the payload is YouTube-only.
  // Force the same path as an explicit `?youtube=1` visit so PersistentPlayerHost
  // mounts in YouTube mode (no Web Playback SDK / token churn).
  if (
    shareId &&
    !accessToken &&
    !guideDemo &&
    !youtubeOnly &&
    !youtubeCookieMode
  ) {
    const payload = await kvGet<{ source?: string }>(SHARE_KV_PREFIX + shareId)
    if (payload?.source === 'youtube') {
      const sp = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
          for (const item of value) sp.append(key, item)
        } else {
          sp.set(key, value)
        }
      }
      sp.set('youtube', '1')
      redirect(`/player?${sp.toString()}`)
    }
  }

  const allowWithoutSpotify =
    Boolean(accessToken) ||
    Boolean(guideDemo) ||
    youtubeOnly ||
    youtubeCookieMode ||
    Boolean(shareId)

  if (!allowWithoutSpotify) {
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
