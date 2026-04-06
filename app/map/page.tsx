'use client'

import { useEffect, useState } from 'react'
import { GUIDE_DEMO_MAP_HISTORY } from '@/app/lib/guideDemo'
import MusicMap from '@/app/player/MusicMap'
import type { HistoryEntry } from '@/app/player/SessionPanel'

export default function MapPage() {
  const [guideDemo, setGuideDemo] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setGuideDemo(new URLSearchParams(window.location.search).get('guide-demo') === '1')
  }, [])

  useEffect(() => {
    if (guideDemo) {
      setHistory(GUIDE_DEMO_MAP_HISTORY as HistoryEntry[])
      return
    }
    function load() {
      try {
        // Channels system: history lives inside each channel in earprint-channels
        const rawChannels = localStorage.getItem('earprint-channels')
        if (rawChannels) {
          const channels = JSON.parse(rawChannels) as { cardHistory?: HistoryEntry[] }[]
          const combined = channels.flatMap(ch => ch.cardHistory ?? [])
          setHistory(combined)
          return
        }
        // Legacy fallback
        const raw = localStorage.getItem('earprint-history')
        if (!raw) { setHistory([]); return }
        setHistory(JSON.parse(raw) as HistoryEntry[])
      } catch {
        /* ignore */
      }
    }
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [guideDemo])

  const estimatedCount = history.filter(e => !e.coords).length

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono">
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <button
          type="button"
          onClick={() => {
            if (window.opener) window.close()
            else window.location.href = '/player'
          }}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
        >
          ← Player
        </button>
        <h1 className="text-base font-bold">Music Map</h1>
        <span className="text-zinc-600 text-xs">{history.length} songs heard</span>
        {estimatedCount > 0 && (
          <span className="text-zinc-700 text-xs">{estimatedCount} with estimated position</span>
        )}
        <span className="text-zinc-700 text-xs ml-auto">drag to rotate</span>
      </div>

      <MusicMap history={history} width={800} height={520} embedded={false} />

      <p className="text-zinc-700 text-xs mt-3 text-right">History updates every 2s from this tab (same storage as the player).</p>
    </div>
  )
}
