'use client'

import dynamic from 'next/dynamic'

const PlayerClient = dynamic(() => import('./PlayerClient'), { ssr: false })

export default function PlayerClientWrapper({
  accessToken,
  guideDemo,
  youtubeResolveTestFromServer,
}: {
  accessToken: string
  guideDemo?: string | null
  /** Read from server env at request time — does not rely on NEXT_PUBLIC in the client bundle. */
  youtubeResolveTestFromServer: boolean
}) {
  return (
    <PlayerClient
      accessToken={accessToken}
      guideDemo={guideDemo}
      youtubeResolveTestFromServer={youtubeResolveTestFromServer}
    />
  )
}
