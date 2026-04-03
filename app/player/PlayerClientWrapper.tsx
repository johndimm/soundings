'use client'

import dynamic from 'next/dynamic'

const PlayerClient = dynamic(() => import('./PlayerClient'), { ssr: false })

export default function PlayerClientWrapper({
  accessToken,
  guideDemo,
}: {
  accessToken: string
  guideDemo?: string | null
}) {
  return <PlayerClient accessToken={accessToken} guideDemo={guideDemo} />
}
