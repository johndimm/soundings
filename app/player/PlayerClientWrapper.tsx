'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const PlayerClient = dynamic(() => import('./PlayerClient'), { ssr: false })

export default function PlayerClientWrapper({
  accessToken,
  guideDemo,
  youtubeResolveTestFromServer,
  youtubeOnly,
}: {
  accessToken: string
  guideDemo?: string | null
  youtubeResolveTestFromServer: boolean
  youtubeOnly?: boolean
}) {
  return (
    <Suspense fallback={null}>
      <PlayerClient
        accessToken={accessToken}
        guideDemo={guideDemo}
        youtubeResolveTestFromServer={youtubeResolveTestFromServer}
        youtubeOnly={youtubeOnly}
      />
    </Suspense>
  )
}
