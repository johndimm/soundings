'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  takeEmbedHandoffForInitialState,
} from '@johndimm/constellations/sessionHandoff'
import type { GraphNode } from '@johndimm/constellations/types'
import { useFullPageConstellationsHost } from '@johndimm/constellations/host'
import { readNowPlayingSnapshot } from '@/app/lib/nowPlayingBridge'

const ConstellationsApp = lazy(() =>
  import('@johndimm/constellations/host').then((m) => ({ default: m.App }))
)

function PlayerConstellationsInner({
  onNewChannelFromNode,
}: {
  onNewChannelFromNode?: (node: GraphNode) => void
}) {
  const sp = useSearchParams()
  const qParam = (sp.get('q') ?? '').trim()
  const expandParam = (sp.get('expand') ?? '').trim()
  const [embedReturnHandoff] = useState(() => {
    const h = takeEmbedHandoffForInitialState()
    // Only restore session if it has actual graph nodes — otherwise let the
    // now-playing bridge drive the search (skipPlayerBootstrapRef stays false).
    return h?.graph?.nodes?.length ? h : null
  })

  const { ready, externalSearch, autoExpandTitles, nowPlayingKey } = useFullPageConstellationsHost({
    qParam,
    expandParam,
    skipUrlAndPlayerBridge: false,
    getPlayerSnapshot: readNowPlayingSnapshot,
    nowPlayingBumperEvent: 'soundings-now-playing',
  })

  if (!ready) {
    return (
      <div className="w-full h-[min(75vh,900px)] min-h-[320px] bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Loading graph…
      </div>
    )
  }

  return (
    <div className="h-[min(75vh,900px)] w-full min-h-[480px] relative overflow-hidden">
      <ConstellationsApp
        embedded
        hideHeader
        hideControlPanel
        showExtensionWhenPanelHidden={false}
        hideSidebar
        externalSearch={externalSearch ? { ...externalSearch, typeHint: 'Music' } : null}
        onExternalSearchConsumed={() => {}}
        autoExpandMatchTitles={autoExpandTitles}
        nowPlayingKey={nowPlayingKey}
        initialSession={embedReturnHandoff}
        onNewChannelFromNode={onNewChannelFromNode}
      />
    </div>
  )
}

export default function PlayerConstellationsEmbed({
  onNewChannelFromNode,
}: {
  onNewChannelFromNode?: (node: GraphNode) => void
}) {
  return (
    <div id="soundings-constellations" className="w-full shrink-0">
      <div className="mx-auto w-full max-w-[800px] px-4 pb-4">
        <Suspense
          fallback={
            <div className="h-[min(75vh,900px)] min-h-[320px] bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
              Loading graph…
            </div>
          }
        >
          <PlayerConstellationsInner onNewChannelFromNode={onNewChannelFromNode} />
        </Suspense>
      </div>
    </div>
  )
}
