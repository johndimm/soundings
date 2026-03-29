'use client'

import dynamic from 'next/dynamic'

const PlayerClient = dynamic(() => import('./PlayerClient'), { ssr: false })

export default function PlayerClientWrapper({ accessToken }: { accessToken: string }) {
  return <PlayerClient accessToken={accessToken} />
}
