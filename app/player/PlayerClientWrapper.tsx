'use client'

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
    <PlayerClient
      accessToken={accessToken}
      guideDemo={guideDemo}
      youtubeResolveTestFromServer={youtubeResolveTestFromServer}
      youtubeOnly={youtubeOnly}
    />
  )
}
