'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import AppHeader from '@/app/components/AppHeader'
import MusicMap from '@/app/player/MusicMap'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import type { HistoryEntry } from '@/app/player/SessionPanel'
import type { CardState, PlaybackSource, Track } from '@/app/lib/playback/types'

/**
 * Build a playable CardState from a HistoryEntry. Spotify tracks store the full
 * `spotify:track:<id>` URI in `entry.uri`; YouTube tracks store the bare video ID.
 * Returns null for entries that can't be mapped to a playable id.
 */
function historyEntryToCardState(entry: HistoryEntry): CardState | null {
  const src: PlaybackSource = entry.source ?? 'spotify'
  if (src === 'youtube') {
    const videoId = (entry.uri ?? '').trim()
    if (!videoId) return null
    const track: Track = {
      id: videoId,
      name: entry.track,
      artist: entry.artist,
      album: '',
      albumArt: entry.albumArt ?? null,
      durationMs: 0,
      source: 'youtube',
      videoId,
    }
    return { track, reason: 'From History', coords: entry.coords }
  }
  const spotifyId = normalizeSpotifyTrackId(entry.uri ?? undefined)
  if (!spotifyId) return null
  const track: Track = {
    id: spotifyId,
    name: entry.track,
    artist: entry.artist,
    album: '',
    albumArt: entry.albumArt ?? null,
    durationMs: 0,
    source: 'spotify',
    uri: `spotify:track:${spotifyId}`,
  }
  return { track, reason: 'From History', coords: entry.coords }
}

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const PAGE_SIZE = 50

interface Channel {
  id: string
  name: string
  cardHistory: HistoryEntry[]
  [key: string]: unknown
}

interface FlatEntry {
  entry: HistoryEntry
  channelId: string
  channelName: string
  globalIndex: number
}

function StarRating({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const display = hovered ?? value ?? 0

  return (
    <div className="flex" onMouseLeave={() => setHovered(null)} style={{ gap: '0.1rem' }}>
      {[1, 2, 3, 4, 5].map(star => {
        const isFull = display >= star
        const isHalf = !isFull && display >= star - 0.5
        return (
          <div key={star} className="relative select-none cursor-pointer" style={{ fontSize: '1.0rem', lineHeight: 1 }}>
            <span className="text-zinc-300">★</span>
            {(isFull || isHalf) && (
              <span
                className="absolute inset-0 text-amber-400 overflow-hidden"
                style={isHalf ? { clipPath: 'inset(0 50% 0 0)' } : {}}
              >★</span>
            )}
            <span
              className="absolute inset-y-0 left-0 w-1/2"
              onMouseEnter={() => setHovered(star - 0.5)}
              onClick={() => onChange(value === star - 0.5 ? null : star - 0.5)}
            />
            <span
              className="absolute inset-y-0 right-0 w-1/2"
              onMouseEnter={() => setHovered(star)}
              onClick={() => onChange(value === star ? null : star)}
            />
          </div>
        )
      })}
    </div>
  )
}

export default function RatingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const channelFilter = searchParams.get('channel')

  const [channels, setChannels] = useState<Channel[]>([])
  const [mounted, setMounted] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [starFilter, setStarFilter] = useState<number | 'unrated' | null>(null)
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'stars' | 'channel'>('date')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      const loaded: Channel[] = raw ? JSON.parse(raw) : []
      setChannels(loaded)
    } catch {}
    setMounted(true)
  }, [])

  // Reset page when filters/sort change
  useEffect(() => {
    setPage(1)
    setSelectedKeys(new Set())
  }, [channelFilter, starFilter, sortBy, sortAsc])

  const saveChannels = (updated: Channel[]) => {
    setChannels(updated)
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(updated))
    } catch {}
  }

  const encodeSelectionKey = (channelId: string, index: number) => `${channelId}::${index}`

  const visibleChannels = channelFilter
    ? channels.filter(c => c.id === channelFilter)
    : channels

  // Flatten all entries across channels, newest first within each channel, then apply star filter
  const allEntries: FlatEntry[] = visibleChannels.flatMap(ch =>
    [...ch.cardHistory].reverse().map((entry, reversedIdx) => ({
      entry,
      channelId: ch.id,
      channelName: ch.name,
      globalIndex: ch.cardHistory.length - 1 - reversedIdx,
    }))
  ).filter(fe => {
    if (starFilter === null) return true
    if (starFilter === 'unrated') return fe.entry.stars == null
    return (fe.entry.stars ?? 0) >= starFilter
  }).sort((a, b) => {
    let cmp = 0
    if (sortBy === 'title') cmp = (a.entry.track ?? '').localeCompare(b.entry.track ?? '')
    else if (sortBy === 'stars') cmp = (b.entry.stars ?? -1) - (a.entry.stars ?? -1)
    else if (sortBy === 'channel') {
      // Primary: channel name alphabetical. Secondary: newest first within a channel,
      // so grouping stays sensible even when the user toggles ascending.
      cmp = a.channelName.localeCompare(b.channelName)
      if (cmp === 0) cmp = b.globalIndex - a.globalIndex
    }
    // 'date': flatMap order is already newest-first (desc); treat that as the base
    return sortAsc ? -cmp : cmp
  })

  const totalPages = Math.max(1, Math.ceil(allEntries.length / PAGE_SIZE))
  const pageEntries = allEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleRate = (channelId: string, index: number, stars: number | null) => {
    const updated = channels.map(c => {
      if (c.id !== channelId) return c
      const newHistory = [...c.cardHistory]
      newHistory[index] = { ...newHistory[index], stars }
      return { ...c, cardHistory: newHistory }
    })
    saveChannels(updated)
  }

  const toggleSelect = (channelId: string, index: number) => {
    const key = encodeSelectionKey(channelId, index)
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /**
   * Send the selected entries to the persistent PlayerClient as an ordered queue.
   * Order follows the current sort order of the flattened list (so Date↓ gives
   * newest-first, Title↑ gives alphabetical, etc.), not the order in which the
   * user ticked the checkboxes — a simpler mental model than tracking click order.
   */
  const handlePlaySelectedKeys = () => {
    if (selectedKeys.size === 0) return
    const ordered: CardState[] = allEntries
      .filter(fe => selectedKeys.has(encodeSelectionKey(fe.channelId, fe.globalIndex)))
      .map(fe => historyEntryToCardState(fe.entry))
      .filter((c): c is CardState => c !== null)
    if (ordered.length === 0) return
    window.dispatchEvent(new CustomEvent('earprint:enqueue', { detail: { cards: ordered } }))
    setSelectedKeys(new Set())
    router.push('/player')
  }

  const handleRemoveSelectedKeys = () => {
    const toRemove = new Map<string, Set<number>>()
    for (const key of selectedKeys) {
      const sep = key.lastIndexOf('::')
      const cid = key.slice(0, sep)
      const idx = Number(key.slice(sep + 2))
      if (!toRemove.has(cid)) toRemove.set(cid, new Set())
      toRemove.get(cid)!.add(idx)
    }
    const updated = channels.map(c => {
      const removeSet = toRemove.get(c.id)
      if (!removeSet) return c
      return { ...c, cardHistory: c.cardHistory.filter((_, i) => !removeSet.has(i)) }
    })
    saveChannels(updated)
    setSelectedKeys(new Set())
  }

  const allPageSelected = pageEntries.length > 0 && pageEntries.every(
    fe => selectedKeys.has(encodeSelectionKey(fe.channelId, fe.globalIndex))
  )

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedKeys(prev => {
        const next = new Set(prev)
        for (const fe of pageEntries) next.delete(encodeSelectionKey(fe.channelId, fe.globalIndex))
        return next
      })
    } else {
      setSelectedKeys(prev => {
        const next = new Set(prev)
        for (const fe of pageEntries) next.add(encodeSelectionKey(fe.channelId, fe.globalIndex))
        return next
      })
    }
  }

  const isChannelView = Boolean(channelFilter)
  const activeChannelName = isChannelView ? (channels.find(c => c.id === channelFilter)?.name ?? '') : ''

  // For map, collect history from visible channels
  const mapHistory = visibleChannels.flatMap(ch =>
    ch.cardHistory.map(e => ({ ...e, albumArt: e.albumArt ?? null, uri: e.uri ?? null, stars: e.stars ?? null }))
  )

  if (!mounted) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col">
        <AppHeader />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <AppHeader />

      <div className="flex-1 max-w-[800px] mx-auto w-full flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-black">
              {isChannelView ? `Channel History — ${activeChannelName}` : 'Listening History'}
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">{allEntries.length} tracks</p>
          </div>
          <div className="flex items-center gap-2">
            {allEntries.length > 0 && (
              <>
                <button
                  onClick={toggleSelectAll}
                  className="text-xs text-zinc-500 hover:text-black transition-colors"
                >
                  {allPageSelected ? 'Deselect page' : 'Select page'}
                </button>
                {selectedKeys.size > 0 && (
                  <>
                    <button
                      onClick={handlePlaySelectedKeys}
                      className="text-xs px-3 py-1 rounded-full bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
                      title="Queue selected tracks and play in the player, in order"
                    >
                      Play {selectedKeys.size}
                    </button>
                    <button
                      onClick={handleRemoveSelectedKeys}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      Delete {selectedKeys.size}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Filters + sort */}
        <div className="px-4 pb-2 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {([null, 'unrated', 1, 2, 3, 4, 5] as const).map(v => {
              const active = starFilter === v
              const label = v === null ? 'All' : v === 'unrated' ? 'Unrated' : '★'.repeat(v) + '+'
              return (
                <button
                  key={String(v)}
                  onClick={() => setStarFilter(active ? null : v)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-zinc-900 border-zinc-800 text-white'
                      : 'border-zinc-300 text-zinc-500 hover:text-black hover:border-zinc-500'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-zinc-400">Sort:</span>
            {(['date', 'title', 'stars', 'channel'] as const)
              // Channel sort is only meaningful when multiple channels are visible.
              .filter(s => s !== 'channel' || !isChannelView)
              .map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${
                    sortBy === s ? 'text-black font-medium' : 'text-zinc-400 hover:text-black'
                  }`}
                >
                  {s === 'date'
                    ? 'Date'
                    : s === 'title'
                      ? 'Title'
                      : s === 'stars'
                        ? 'Stars'
                        : 'Channel'}
                </button>
              ))}
            <button
              onClick={() => setSortAsc(v => !v)}
              className="text-xs px-1.5 py-0.5 rounded text-zinc-400 hover:text-black transition-colors"
              title={sortAsc ? 'Ascending' : 'Descending'}
            >
              {sortAsc ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* History list */}
        <div className="flex-1 px-4 flex flex-col gap-1">
          {allEntries.length === 0 && (
            <p className="text-zinc-400 text-sm py-4">
              {starFilter !== null ? 'No tracks match this filter.' : 'No history yet. Head to the '}
              {starFilter === null && (
                <><a href="/player" className="underline text-zinc-500 hover:text-black">Player</a> to start listening.</>
              )}
            </p>
          )}

          {pageEntries.map((fe, i) => {
            const { entry, channelId, channelName, globalIndex } = fe
            const selKey = encodeSelectionKey(channelId, globalIndex)
            const isSelected = selectedKeys.has(selKey)
            const playableTrackId = normalizeSpotifyTrackId(entry.uri ?? undefined)
            const canOpen = Boolean(entry.track)
            return (
              <div
                key={`${channelId}-${globalIndex}-${i}`}
                className={`flex items-center gap-2 py-1 rounded-lg px-1 transition-colors ${
                  isSelected ? 'bg-zinc-200' : 'hover:bg-zinc-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(channelId, globalIndex)}
                  className="flex-shrink-0 accent-zinc-400 cursor-pointer"
                />
                <a
                  href={entry.track ? `/player?q=${encodeURIComponent(entry.track)}` : '#'}
                  className={`flex-1 min-w-0 flex items-center gap-2 bg-zinc-100 hover:bg-zinc-200 rounded-xl px-2 py-1 text-left transition-colors ${
                    !canOpen ? 'pointer-events-none' : ''
                  }`}
                >
                  {entry.albumArt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.albumArt}
                      alt=""
                      className="w-9 h-9 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-md bg-zinc-300 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-black text-xs font-medium truncate">{entry.track}</p>
                    <p className="text-zinc-500 text-xs truncate">{entry.artist}</p>
                  </div>
                </a>
                {!isChannelView && (
                  <span className="text-xs text-zinc-400 flex-shrink-0 hidden sm:block max-w-[80px] truncate" title={channelName}>
                    {channelName}
                  </span>
                )}
                <div className="flex-shrink-0">
                  <StarRating
                    value={entry.stars ?? null}
                    onChange={stars => handleRate(channelId, globalIndex, stars)}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs px-3 py-1 rounded border border-zinc-300 text-zinc-500 hover:text-black hover:border-zinc-500 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-zinc-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-xs px-3 py-1 rounded border border-zinc-300 text-zinc-500 hover:text-black hover:border-zinc-500 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              Next →
            </button>
          </div>
        )}

        {/* Music map */}
        {mapHistory.length > 0 && (
          <div className="px-4 pb-6 pt-2 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Music map</span>
              <span className="text-xs text-zinc-600">{mapHistory.length} tracks</span>
            </div>
            <MusicMap
              history={mapHistory}
              width={560}
              height={380}
              embedded={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}
