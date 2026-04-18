'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AppHeader from '@/app/components/AppHeader'
import {
  genChannelId,
  type Channel,
  type HistoryEntry,
} from '@/app/lib/channelsImportExport'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const ALL_CHANNEL_ID = 'earprint-all'

const GENRE_OPTIONS = [
  'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Folk', 'Metal', 'Soul', 'Blues', 'Reggae', 'Latin', 'Punk',
]

const TIME_PERIOD_OPTIONS = [
  { label: '40s', value: '1940s' },
  { label: '50s', value: '1950s' },
  { label: '60s', value: '1960s' },
  { label: '70s', value: '1970s' },
  { label: '80s', value: '1980s' },
  { label: '90s', value: '1990s' },
  { label: '2000s', value: '2000s' },
  { label: '2010s', value: '2010s' },
  { label: 'Recent', value: 'after 2020' },
  { label: 'Medieval', value: 'medieval era' },
  { label: 'Renaissance', value: 'Renaissance era' },
  { label: 'Baroque', value: 'Baroque era' },
  { label: 'Classical', value: 'Classical era' },
  { label: 'Romantic', value: 'Romantic era' },
  { label: '20th C.', value: '20th century classical' },
]

const REGION_OPTIONS = [
  'US & Canada', 'UK & Ireland', 'Western Europe', 'Scandinavia',
  'Eastern Europe', 'Latin America', 'Brazil', 'Caribbean',
  'Africa', 'Middle East', 'India', 'East Asia', 'Southeast Asia',
]

function makeAllChannel(): Channel {
  return {
    id: ALL_CHANNEL_ID,
    name: 'All',
    isAutoNamed: false,
    cardHistory: [],
    sessionHistory: [],
    profile: '',
    createdAt: 0,
    genres: [],
    genreText: '',
    timePeriods: [],
    notes: '',
    regions: [],
    artists: [],
    artistText: '',
    popularity: 50,
    discovery: 50,
  }
}

function ensureAllChannel(channels: Channel[]): Channel[] {
  if (channels.some(c => c.id === ALL_CHANNEL_ID)) return channels
  return [makeAllChannel(), ...channels]
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-black text-white border-black'
          : 'bg-transparent text-zinc-500 border-zinc-300 hover:border-zinc-500 hover:text-black'
      }`}
    >
      {label}
    </button>
  )
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

export default function ChannelsPage() {
  const searchParams = useSearchParams()
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingChannelName, setEditingChannelName] = useState('')
  const [mounted, setMounted] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    let loaded: Channel[] = []
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      loaded = ensureAllChannel(raw ? JSON.parse(raw) : [])
      // Persist if All channel was just added
      try { localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(loaded)) } catch {}
      const activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY)
      setChannels(loaded)
      setActiveChannelId(activeId ?? loaded[0]?.id ?? null)
    } catch {}

    if (searchParams.get('new') === '1') {
      const newCh: Channel = {
        id: genChannelId(),
        name: 'New Channel',
        isAutoNamed: false,
        cardHistory: [],
        sessionHistory: [],
        profile: '',
        createdAt: Date.now(),
        genres: [],
        genreText: '',
        timePeriods: [],
        notes: '',
        regions: [],
        artists: [],
        artistText: '',
        popularity: 50,
        discovery: 50,
      }
      const updated = [...loaded, newCh]
      setChannels(updated)
      setActiveChannelId(newCh.id)
      try {
        localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(updated))
        localStorage.setItem(ACTIVE_CHANNEL_KEY, newCh.id)
      } catch {}
    }

    setMounted(true)
  }, [searchParams])

const activeChannel = channels.find(c => c.id === activeChannelId) ?? channels[0]

  const persist = (updated: Channel[]) => {
    setChannels(updated)
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(updated))
    } catch {}
  }

  const updateActive = (patch: Partial<Channel>) => {
    if (!activeChannel) return
    persist(
      channels.map(c => (c.id === activeChannel.id ? { ...c, ...patch } : c))
    )
  }

  const switchChannel = (id: string) => {
    setActiveChannelId(id)
    setSelected(new Set())
    try {
      localStorage.setItem(ACTIVE_CHANNEL_KEY, id)
    } catch {}
  }

  const createChannel = () => {
    const newCh: Channel = {
      id: genChannelId(),
      name: 'New Channel',
      isAutoNamed: false,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      createdAt: Date.now(),
      genres: [],
      genreText: '',
      timePeriod: '',
      notes: '',
      regions: [],
      artists: [],
      artistText: '',
      popularity: 50,
      discovery: 50,
    }
    const updated = [...channels, newCh]
    persist(updated)
    switchChannel(newCh.id)
  }

  const deleteChannel = (id: string) => {
    if (id === ALL_CHANNEL_ID) return
    if (channels.length <= 1) return
    const updated = channels.filter(c => c.id !== id)
    persist(updated)
    if (id === activeChannelId) {
      switchChannel(updated[0].id)
    }
  }

  const renameChannel = (id: string, name: string) => {
    persist(channels.map(c => (c.id === id ? { ...c, name, isAutoNamed: false } : c)))
  }

  const toggleGenre = (g: string) => {
    const genres = activeChannel?.genres ?? []
    updateActive({
      genres: genres.includes(g) ? genres.filter(x => x !== g) : [...genres, g],
    })
  }

  const toggleTimePeriod = (v: string) => {
    const tps = activeChannel?.timePeriods ?? []
    updateActive({ timePeriods: tps.includes(v) ? tps.filter(x => x !== v) : [...tps, v] })
  }

  const toggleRegion = (r: string) => {
    const regions = activeChannel?.regions ?? []
    updateActive({
      regions: regions.includes(r) ? regions.filter(x => x !== r) : [...regions, r],
    })
  }

  const handleRate = (index: number, stars: number | null) => {
    if (!activeChannel) return
    persist(
      channels.map(c => {
        if (c.id !== activeChannel.id) return c
        const newHistory = [...c.cardHistory]
        newHistory[index] = { ...newHistory[index], stars }
        return { ...c, cardHistory: newHistory }
      })
    )
  }

  const handleRemoveMultiple = (indices: number[]) => {
    if (!activeChannel) return
    const set = new Set(indices)
    persist(
      channels.map(c => {
        if (c.id !== activeChannel.id) return c
        return { ...c, cardHistory: c.cardHistory.filter((_, i) => !set.has(i)) }
      })
    )
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

  if (!mounted) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col">
        <AppHeader />
      </div>
    )
  }

  const ch = activeChannel
  const genres = ch?.genres ?? []
  const regions = ch?.regions ?? []
  const timePeriods = ch?.timePeriods ?? []
  const popularity = ch?.popularity ?? 50
  const discovery = ch?.discovery ?? 50
  const notes = ch?.notes ?? ''
  const history: HistoryEntry[] = ch?.cardHistory ?? []

  const discoveryLabel = discovery <= 20 ? 'Familiar' : discovery <= 40 ? 'Mostly familiar' : discovery <= 60 ? 'Balanced' : discovery <= 80 ? 'Mostly new' : 'Adventurous'
  const popularityLabel = popularity <= 20 ? 'Hidden gems' : popularity <= 40 ? 'Obscure' : popularity >= 80 ? 'Mainstream' : popularity >= 60 ? 'Popular' : 'Mixed'

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <AppHeader />

      <div className="flex flex-col sm:flex-row gap-0 flex-1 max-w-[800px] mx-auto w-full">
        {/* Channel list sidebar */}
        <div className="sm:w-48 border-b sm:border-b-0 sm:border-r border-zinc-200 p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Channels</span>
            <button
              onClick={createChannel}
              className="text-lg leading-none text-zinc-400 hover:text-black transition-colors"
              title="New channel"
            >
              +
            </button>
          </div>
          {channels.map(c => (
            <div key={c.id} className="flex items-center gap-1 group">
              {editingChannelId === c.id ? (
                <input
                  className="flex-1 bg-transparent outline-none text-xs text-black border-b border-zinc-300 px-1"
                  value={editingChannelName}
                  onChange={e => setEditingChannelName(e.target.value)}
                  onBlur={() => {
                    renameChannel(c.id, editingChannelName)
                    setEditingChannelId(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      renameChannel(c.id, editingChannelName)
                      setEditingChannelId(null)
                    }
                    if (e.key === 'Escape') setEditingChannelId(null)
                  }}
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => {
                    if (c.id === activeChannelId) {
                      if (c.id !== ALL_CHANNEL_ID) {
                        setEditingChannelId(c.id)
                        setEditingChannelName(c.name)
                      }
                    } else {
                      switchChannel(c.id)
                    }
                  }}
                  className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-colors truncate ${
                    c.id === activeChannelId
                      ? 'bg-zinc-100 text-black font-medium'
                      : 'text-zinc-500 hover:text-black hover:bg-zinc-100'
                  }`}
                >
                  {c.name}
                </button>
              )}
              {channels.length > 1 && c.id !== ALL_CHANNEL_ID && (
                <button
                  onClick={() => deleteChannel(c.id)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-all px-1"
                  title="Delete channel"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Main panel */}
        {ch ? (
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">

            {/* Settings (always) + ratings below */}
            <div className="border-b border-zinc-200 px-4 pt-4 pb-5 flex flex-col gap-5">
              {ch.id === ALL_CHANNEL_ID ? (
                <span className="text-xs text-zinc-400 italic">No filters — plays anything</span>
              ) : (
                <>
                  {/* Discovery */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-zinc-500 uppercase tracking-wide">Discovery</label>
                      <span className="text-xs text-zinc-400">{discoveryLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600">Familiar</span>
                      <input
                        type="range" min={0} max={100} value={discovery}
                        onChange={e => updateActive({ discovery: Number(e.target.value) })}
                        className="flex-1 accent-zinc-400"
                      />
                      <span className="text-xs text-zinc-600">New</span>
                    </div>
                  </div>

                  {/* Genres */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Genres</label>
                    <div className="flex flex-wrap gap-1.5">
                      {GENRE_OPTIONS.map(g => (
                        <Chip key={g} label={g} active={genres.includes(g)} onClick={() => toggleGenre(g)} />
                      ))}
                    </div>
                  </div>

                  {/* Region */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Region</label>
                    <div className="flex flex-wrap gap-1.5">
                      {REGION_OPTIONS.map(r => (
                        <Chip key={r} label={r} active={regions.includes(r)} onClick={() => toggleRegion(r)} />
                      ))}
                    </div>
                  </div>

                  {/* Time period */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Time period</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TIME_PERIOD_OPTIONS.map(opt => (
                        <Chip
                          key={opt.value}
                          label={opt.label}
                          active={timePeriods.includes(opt.value)}
                          onClick={() => toggleTimePeriod(opt.value)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Popularity */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-zinc-500 uppercase tracking-wide">Popularity</label>
                      <span className="text-xs text-zinc-400">{popularityLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600">Obscure</span>
                      <input
                        type="range" min={0} max={100} value={popularity}
                        onChange={e => updateActive({ popularity: Number(e.target.value) })}
                        className="flex-1 accent-zinc-400"
                      />
                      <span className="text-xs text-zinc-600">Mainstream</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Notes</label>
                    <textarea
                      value={notes}
                      onChange={e => updateActive({ notes: e.target.value })}
                      placeholder="Describe what you want — genres, artists, era, mood, anything. e.g. dreamy shoegaze, lean Coltrane, avoid smooth jazz, upbeat only, nothing after 1990…"
                      rows={4}
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-3 py-2 text-sm text-black placeholder-zinc-400 resize-none focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <p className="text-xs text-zinc-600 italic">
                    Changes take effect on the next song the DJ picks.
                  </p>
                </>
              )}
            </div>

            {/* Ratings list */}
            <div className="flex-1 p-4 flex flex-col gap-2 border-t border-zinc-100">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-500 uppercase tracking-wide">
                  Ratings ({history.length})
                </span>
                <div className="flex items-center gap-2">
                  {history.length > 0 && (
                    <>
                      <button
                        onClick={() => {
                          if (selected.size === history.length && history.length > 0) {
                            setSelected(new Set())
                          } else {
                            setSelected(new Set(history.map((_, i) => i)))
                          }
                        }}
                        className="text-xs text-zinc-500 hover:text-black transition-colors"
                      >
                        {selected.size === history.length && history.length > 0 ? 'Deselect all' : 'Select all'}
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
                <p className="text-zinc-400 text-sm py-4">
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
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-6 flex items-center justify-center">
            <div className="text-center">
              <p className="text-zinc-500 text-sm mb-3">No channels yet.</p>
              <button
                onClick={createChannel}
                className="text-sm px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white transition-colors"
              >
                Create a channel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
