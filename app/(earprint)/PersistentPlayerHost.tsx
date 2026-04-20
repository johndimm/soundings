'use client'

import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import PlayerClientWrapper from '@/app/player/PlayerClientWrapper'
import { applyFreshLoginIfNeeded } from '@/app/lib/freshLogin'

function PersistentPlayerHostInner({
  children,
  accessToken,
  youtubeResolveTestFromServer,
  youtubeModeFromCookie,
}: {
  children: ReactNode
  accessToken: string
  youtubeResolveTestFromServer: boolean
  youtubeModeFromCookie: boolean
}) {
  const pathname = usePathname()
  const sp = useSearchParams()
  const router = useRouter()

  /**
   * SSR has no URL query; reading `window.location.search` (or `sp.get(...)`) during the
   * first client render would disagree with the server HTML and cause a hydration mismatch.
   * We CAN seed `youtubeLocked` from the cookie prop (same value on server + client), so
   * returning users with the cookie keep YouTube mode without a `?youtube=1` query string.
   */
  const [youtubeLocked, setYoutubeLocked] = useState(youtubeModeFromCookie)
  const [guideDemo, setGuideDemo] = useState<string | null>(null)

  /**
   * Belt-and-suspenders: fresh-login reset may also be invoked from PlayerClient (see
   * `applyFreshLoginIfNeeded` in `app/lib/freshLogin.ts`). The module-level flag inside
   * that helper makes the second caller a no-op, so whoever runs first wins and the result
   * is the same.
   *
   * Calling it here still matters because `PlayerClient` is not mounted on every route
   * that uses this host (the host wraps `{children}`), so this path is what guarantees the
   * reset fires when a user lands on a non-`/player` page immediately after login.
   */
  applyFreshLoginIfNeeded()

  useEffect(() => {
    if (!pathname.startsWith('/player')) return
    if (sp.get('youtube') === '1') {
      setYoutubeLocked(true)
      // Mirror the server route: persist YouTube-only mode so internal `/player` links
      // (header, Settings redirect) that drop the query string keep working.
      try {
        document.cookie = `earprint_youtube_mode=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
      } catch {}
    }
    const g = sp.get('guide-demo')
    if (typeof g === 'string') setGuideDemo(g)

    // The actual localStorage reset runs synchronously during render (above); this effect
    // only (a) updates the youtubeLocked flag so the player re-renders with the right source,
    // and (b) strips the query marker so a later refresh doesn't re-run anything.
    const freshSource: 'spotify' | 'youtube' | null =
      sp.get('spotify_login') === '1'
        ? 'spotify'
        : sp.get('youtube_login') === '1'
          ? 'youtube'
          : null
    if (freshSource) {
      setYoutubeLocked(freshSource === 'youtube')
      router.replace(pathname)
    }
  }, [pathname, sp, router])

  const canPlay = Boolean(accessToken) || Boolean(guideDemo) || youtubeLocked
  const isPlayerRoute = pathname.startsWith('/player')

  if (!canPlay) {
    return <>{children}</>
  }

  return (
    <>
      <div
        className={
          isPlayerRoute
            ? ''
            : 'fixed -left-[9999px] top-0 h-[480px] w-[800px] overflow-hidden opacity-0 pointer-events-none'
        }
        aria-hidden={!isPlayerRoute}
      >
        <PlayerClientWrapper
          accessToken={accessToken}
          guideDemo={guideDemo}
          youtubeResolveTestFromServer={youtubeResolveTestFromServer}
          youtubeOnly={youtubeLocked}
        />
      </div>
      {children}
    </>
  )
}

export default function PersistentPlayerHost({
  children,
  accessToken,
  youtubeResolveTestFromServer,
  youtubeModeFromCookie = false,
}: {
  children: ReactNode
  accessToken: string
  youtubeResolveTestFromServer: boolean
  youtubeModeFromCookie?: boolean
}) {
  return (
    <Suspense fallback={<>{children}</>}>
      <PersistentPlayerHostInner
        accessToken={accessToken}
        youtubeResolveTestFromServer={youtubeResolveTestFromServer}
        youtubeModeFromCookie={youtubeModeFromCookie}
      >
        {children}
      </PersistentPlayerHostInner>
    </Suspense>
  )
}
