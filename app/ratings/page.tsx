'use client'

import { useEffect, useState } from 'react'
import AppHeader from '@/app/components/AppHeader'
import MusicMap from '@/app/player/MusicMap'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import type { HistoryEntry } from '@/app/player/SessionPanel'

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const SETTINGS_STORAGE_KEY = 'earprint-settings'
const HISTORY_STORAGE_KEY = 'earprint-history'

interface Channel {
  id: string
  name: string
  cardHistory: HistoryEntry[]
  [key: string]: unknown
}

function StarRating({
  value,
  onChange,
  size = 'sm',
}: {
  value: number | null
  onChange: (v: number | null) => void
  size?: 'sm' | 'md'
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const display = hovered ?? value ?? 0
  const fontSize = size === 'md' ? '1.4rem' : '1.0rem'

  return (
    <div
      className="flex"
      onMouseLeave={() => setHovered(null)}
      style={{ gap: '0.1rem' }}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const isFull = display >= star
        const isHalf = !isFull && display >= star - 0.5
        return (
          <div
            key={star}
            className="relative select-none cursor-pointer"
            style={{ fontSize, lineHeight: 1 }}
          >
            <span className="text-zinc-700">★</span>
            {(isFull || isHalf) && (
              <span
                className="absolute inset-0 text-amber-400 overflow-hidden"
                style={isHalf ? { clipPath: 'inset(0 50% 0 0)' } : {}}
              >
                ★
              </span>
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
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [mounted, setMounted] = useState(false)
  const [resetDialog, setResetDialog] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      const loaded: Channel[] = raw ? JSON.parse(raw) : []
      const activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY)
      setChannels(loaded)
      setActiveChannelId(activeId)
    } catch {}
    setMounted(true)
  }, [])

  const activeChannel =
    channels.find(c => c.id === activeChannelId) ?? channels[0]
  const history: HistoryEntry[] = activeChannel?.cardHistory ?? []

  const saveChannels = (updated: Channel[]) => {
    setChannels(updated)
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(updated))
    } catch {}
  }

  const handleRate = (index: number, stars: number | null) => {
    if (!activeChannel) return
    const updated = channels.map(c => {
      if (c.id !== activeChannel.id) return c
      const newHistory = [...c.cardHistory]
      newHistory[index] = { ...newHistory[index], stars }
      return { ...c, cardHistory: newHistory }
    })
    saveChannels(updated)
  }

  const handleRemoveMultiple = (indices: number[]) => {
    if (!activeChannel) return
    const set = new Set(indices)
    const updated = channels.map(c => {
      if (c.id !== activeChannel.id) return c
      return { ...c, cardHistory: c.cardHistory.filter((_, i) => !set.has(i)) }
    })
    saveChannels(updated)
    setSelected(new Set())
  }

  const toggleSelect = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === history.length && history.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(history.map((_, i) => i)))
    }
  }

  const switchChannel = (id: string) => {
    setActiveChannelId(id)
    setSelected(new Set())
    try {
      localStorage.setItem(ACTIVE_CHANNEL_KEY, id)
    } catch {}
  }

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

      <div className="flex flex-col gap-4 p-4 flex-1 max-w-[800px] mx-auto w-full">
        {/* Channel tabs */}
        {channels.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {channels.map(ch => (
              <button
                key={ch.id}
                onClick={() => switchChannel(ch.id)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  ch.id === (activeChannel?.id)
                    ? 'bg-zinc-900 border-zinc-800 text-white'
                    : 'border-zinc-300 text-zinc-500 hover:text-black hover:border-zinc-500'
                }`}
              >
                {ch.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-6 flex-1">
          {/* Music map */}
          <div className="w-full sm:w-auto flex-shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Music map</span>
              <span className="text-xs text-zinc-600">{history.length} songs</span>
            </div>
            <MusicMap
              history={history}
              width={480}
              height={380}
              embedded={false}
            />
          </div>

          {/* History list */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">
                Ratings ({history.length})
              </span>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <>
                    <button
                      onClick={selectAll}
                      className="text-xs text-zinc-500 hover:text-black transition-colors"
                    >
                      {selected.size === history.length && history.length > 0
                        ? 'Deselect all'
                        : 'Select all'}
                    </button>
                    {selected.size > 0 && (
                      <button
                        onClick={() => handleRemoveMultiple(Array.from(selected))}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors"
                      >
                        Delete {selected.size}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {history.length === 0 && (
              <p className="text-zinc-600 text-sm py-4">
                No ratings yet. Head to the{' '}
                <a href="/player" className="underline text-zinc-500 hover:text-black">
                  Player
                </a>{' '}
                to start listening.
              </p>
            )}

            <div className="flex flex-col gap-1">
              {[...history].reverse().map((entry, i) => {
                const realIndex = history.length - 1 - i
                const isSelected = selected.has(realIndex)
                const playableTrackId = normalizeSpotifyTrackId(entry.uri ?? undefined)
                const canOpen = Boolean(playableTrackId) || entry.source === 'youtube'
                return (
                  <div
                    key={realIndex}
                    className={`flex items-center gap-2 py-1 rounded-lg px-1 transition-colors ${
                      isSelected ? 'bg-zinc-200' : 'hover:bg-zinc-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(realIndex)}
                      className="flex-shrink-0 accent-zinc-400 cursor-pointer"
                    />
                    <a
                      href={
                        entry.source === 'youtube'
                          ? `https://www.youtube.com/watch?v=${entry.uri}`
                          : `https://open.spotify.com/track/${playableTrackId ?? ''}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
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
                    <div className="flex-shrink-0">
                      <StarRating
                        value={entry.stars ?? null}
                        onChange={stars => handleRate(realIndex, stars)}
                        size="sm"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Reset all */}
      <div className="border-t border-zinc-200">
      <div className="px-4 py-3 flex justify-end max-w-[800px] mx-auto">
        <button
          type="button"
          onClick={() => setResetDialog(true)}
          className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
          title="Delete all channels and saved settings; start with one empty channel"
        >
          Reset all
        </button>
      </div>
      </div>

      {resetDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
          role="presentation"
          onClick={e => { if (e.target === e.currentTarget) setResetDialog(false) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-zinc-900 border border-zinc-600 rounded-xl p-6 max-w-md w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white mb-2">Reset all channels?</h2>
            <p className="text-sm text-zinc-300 mb-6">
              Delete all channels and start over? This removes every channel, listen history, and saved DJ settings from this browser. You cannot undo this.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                onClick={() => setResetDialog(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg bg-red-800 hover:bg-red-700 text-white"
                onClick={() => {
                  try {
                    localStorage.removeItem(CHANNELS_STORAGE_KEY)
                    localStorage.removeItem(ACTIVE_CHANNEL_KEY)
                    localStorage.removeItem(HISTORY_STORAGE_KEY)
                    localStorage.removeItem(SETTINGS_STORAGE_KEY)
                    localStorage.removeItem('spotifyRateLimitUntil')
                  } catch {}
                  window.location.href = '/player'
                }}
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
