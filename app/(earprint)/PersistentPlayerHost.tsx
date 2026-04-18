'use client'

import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import PlayerClientWrapper from '@/app/player/PlayerClientWrapper'

function readYoutubeFromWindow(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('youtube') === '1'
}

function readGuideDemoFromWindow(): string | null {
  if (typeof window === 'undefined') return null
  const g = new URLSearchParams(window.location.search).get('guide-demo')
  return typeof g === 'string' ? g : null
}

function PersistentPlayerHostInner({
  children,
  accessToken,
  youtubeResolveTestFromServer,
}: {
  children: ReactNode
  accessToken: string
  youtubeResolveTestFromServer: boolean
}) {
  const pathname = usePathname()
  const sp = useSearchParams()

  const [youtubeLocked, setYoutubeLocked] = useState(readYoutubeFromWindow)
  const [guideDemo, setGuideDemo] = useState<string | null>(readGuideDemoFromWindow)

  useEffect(() => {
    if (!pathname.startsWith('/player')) return
    if (sp.get('youtube') === '1') setYoutubeLocked(true)
    const g = sp.get('guide-demo')
    if (typeof g === 'string') setGuideDemo(g)
  }, [pathname, sp])

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
}: {
  children: ReactNode
  accessToken: string
  youtubeResolveTestFromServer: boolean
}) {
  return (
    <Suspense fallback={<>{children}</>}>
      <PersistentPlayerHostInner
        accessToken={accessToken}
        youtubeResolveTestFromServer={youtubeResolveTestFromServer}
      >
        {children}
      </PersistentPlayerHostInner>
    </Suspense>
  )
}
