'use client'

import { useState } from 'react'
import { ListenEvent } from '@/app/lib/llm'
import { SpotifyTrack } from '@/app/lib/spotify'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import { type PlaybackSource, PLAYBACK_SOURCE_LABELS, DEFAULT_PLAYBACK_SOURCE } from '@/app/lib/playback/types'

export interface HistoryEntry extends ListenEvent {
  albumArt: string | null
  uri: string | null
  category?: string
  /** Which source this track was played from. */
  source?: PlaybackSource
  // coords is inherited from ListenEvent (coords?: {x,y})
}

interface CardState {
  track: SpotifyTrack
  reason: string
}

const GENRE_OPTIONS = [
  'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Folk', 'Metal', 'Soul', 'Blues', 'Reggae', 'Latin', 'Punk',
]

// Broad musical regions — meaningful traditions without listing every country
const REGION_OPTIONS = [
  'US & Canada', 'UK & Ireland', 'Latin America', 'Brazil',
  'West Africa', 'East Africa', 'North Africa & Middle East',
  'India', 'East Asia', 'Southeast Asia',
  'Caribbean', 'Scandinavia', 'Eastern Europe',
]

function gradeColor(entry: HistoryEntry): string {
  if (entry.percentListened >= 75) return 'text-green-400'
  if (entry.percentListened >= 45) return 'text-zinc-300'
  return 'text-red-400'
}

function gradeLabel(entry: HistoryEntry): string {
  if (entry.percentListened >= 70) return 'liked'
  if (entry.percentListened >= 40) return 'ok'
  return 'nope'
}

interface Props {
  history: HistoryEntry[]
  queue: CardState[]
  loadingNext: boolean
  profile: string
  onProfileChange: (v: string) => void
  notes: string
  onNotesChange: (v: string) => void
  genres: string[]
  onGenresChange: (v: string[]) => void
  genreText: string
  onGenreTextChange: (v: string) => void
  timePeriod: string
  onTimePeriodChange: (v: string) => void
  regions: string[]
  onRegionsChange: (v: string[]) => void
  popularity: number
  onPopularityChange: (v: number) => void
  discovery: number
  onDiscoveryChange: (v: number) => void
  onRemoveMultiple: (indices: number[]) => void
  onRateHistoryItem: (index: number, percent: number) => void
  onPlayQueueItem: (index: number) => void
  onRemoveQueueItem: (index: number) => void
  onPlayHistoryItem: (entry: HistoryEntry) => void
  submittedUris: Set<string>
  pendingSuggestions: { search: string; reason: string; spotifyId?: string }[]
  /** True while resolving DJ picks into the queue (automatic). */
  promotingDjPending?: boolean
  settingsDirty: boolean
  source: PlaybackSource
  onSourceChange: (v: PlaybackSource) => void
}

const SECTION_STYLES: Record<string, { label: string; labelColor: string; textColor: string; border: string }> = {
  LIKED:    { label: 'Likes',    labelColor: 'text-green-400',  textColor: 'text-green-200',  border: 'border-green-900' },
  DISLIKED: { label: 'Dislikes', labelColor: 'text-red-400',    textColor: 'text-red-200',    border: 'border-red-900' },
  EXPLORED: { label: 'Explored', labelColor: 'text-blue-400',   textColor: 'text-blue-200',   border: 'border-blue-900' },
  NEXT:     { label: 'Next move',labelColor: 'text-amber-400',  textColor: 'text-amber-200',  border: 'border-amber-900' },
}

function ProfileView({ profile, onEdit }: { profile: string; onEdit: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const parts = profile.split(/\s*\|\s*|\n/).map(s => s.trim()).filter(Boolean)
  const sections = parts.map(part => {
    const colon = part.indexOf(':')
    if (colon === -1) return { key: '', value: part }
    return { key: part.slice(0, colon).trim().toUpperCase(), value: part.slice(colon + 1).trim() }
  })
  const hasKnownKeys = sections.some(s => s.key in SECTION_STYLES)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-zinc-500 uppercase tracking-wide">What I know about you</label>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {editing ? 'done' : 'edit'}
        </button>
      </div>
      {editing ? (
        <textarea
          value={profile}
          onChange={e => onEdit(e.target.value)}
          rows={5}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500 leading-relaxed"
        />
      ) : hasKnownKeys ? (
        <div className="flex flex-col gap-1.5">
          {sections.map((s, i) => {
            const style = SECTION_STYLES[s.key]
            if (!style) return null
            return (
              <div key={i} className={`rounded-lg border ${style.border} bg-black/30 px-3 py-2`}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${style.labelColor} mr-2`}>
                  {style.label}
                </span>
                <span className={`text-xs ${style.textColor} leading-relaxed`}>{s.value}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-zinc-300 leading-relaxed">{profile}</p>
      )}
    </div>
  )
}

export default function SessionPanel({
  history,
  queue,
  loadingNext,
  profile,
  onProfileChange,
  notes,
  onNotesChange,
  genres,
  onGenresChange,
  genreText,
  onGenreTextChange,
  timePeriod,
  onTimePeriodChange,
  regions,
  onRegionsChange,
  popularity,
  onPopularityChange,
  onRemoveMultiple,
  onRateHistoryItem,
  onPlayQueueItem,
  onRemoveQueueItem,
  onPlayHistoryItem,
  discovery,
  onDiscoveryChange,
  submittedUris,
  pendingSuggestions,
  promotingDjPending = false,
  settingsDirty,
  source,
  onSourceChange,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggleSelect = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === history.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(history.map((_, i) => i)))
    }
  }

  const deleteSelected = () => {
    onRemoveMultiple(Array.from(selected))
    setSelected(new Set())
  }

  const toggleGenre = (g: string) => {
    if (genres.includes(g)) {
      onGenresChange(genres.filter(x => x !== g))
    } else {
      onGenresChange([...genres, g])
    }
  }

  const toggleRegion = (r: string) => {
    if (regions.includes(r)) {
      onRegionsChange(regions.filter(x => x !== r))
    } else {
      onRegionsChange([...regions, r])
    }
  }

  return (
    <div className="flex flex-col gap-4 text-white w-full">

      {/* Up next */}
      <div data-guide="up-next" className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">
            Up next{queue.length > 0 ? ` (${queue.length})` : ''}
          </label>
          {loadingNext && (
            <div className="flex items-center gap-1.5 text-zinc-300">
              <div className="w-3.5 h-3.5 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
              <span className="text-xs">Asking the DJ…</span>
            </div>
          )}
        </div>

        {loadingNext && queue.length === 0 && (
          <div className="flex items-center gap-2 text-zinc-500 text-xs py-2 italic">
            Searching for songs…
          </div>
        )}

        {queue.length === 0 && !loadingNext && (
          <p className="text-zinc-700 text-xs">Nothing queued yet.</p>
        )}

        <div className="flex flex-col gap-1">
          {queue.map((card, i) => (
            <div key={card.track.uri} className="flex items-center gap-1">
              <button
                onClick={() => onPlayQueueItem(i)}
                className="flex items-center gap-3 bg-zinc-900 hover:bg-zinc-800 rounded-xl p-2 text-left transition-colors flex-1 min-w-0"
              >
                <span className="text-zinc-600 text-xs w-3 flex-shrink-0">{i + 1}</span>
                {card.track.albumArt ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.track.albumArt}
                    alt={card.track.album}
                    className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">♪</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{card.track.name}</p>
                  <p className="text-zinc-400 text-xs truncate">{card.track.artist}</p>
                </div>
              </button>
              <button
                onClick={() => onRemoveQueueItem(i)}
                className="flex-shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors px-2 py-2"
                title="Remove from queue"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* DJ's pending suggestions — feed into Up Next from below */}
        {pendingSuggestions.length > 0 && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-xs text-zinc-500 uppercase tracking-wider">DJ is thinking…</div>
              {promotingDjPending && (
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <div className="w-3 h-3 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
                  <span className="text-[10px]">Adding to queue…</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {pendingSuggestions.map((s, i) => (
                <div key={i} className="text-xs px-1">
                  <div className="text-zinc-300 font-medium">{s.search}</div>
                  <div className="text-zinc-500 leading-relaxed">{s.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Taste profile */}
      {profile && <ProfileView profile={profile} onEdit={onProfileChange} />}

      {/* Playback source */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500 uppercase tracking-wide">Source</label>
        <div className="flex gap-1.5">
          {(Object.keys(PLAYBACK_SOURCE_LABELS) as PlaybackSource[]).map(s => (
            <button
              key={s}
              onClick={() => onSourceChange(s)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                source === s
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {PLAYBACK_SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Discovery slider */}
      <div data-guide="discovery" className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
            Discovery
            {settingsDirty && <span data-guide="discovery-queued" className="text-amber-500 text-[10px] normal-case tracking-normal font-normal">· queued</span>}
          </label>
          <span className="text-xs text-zinc-400">
            {discovery <= 20 ? 'Familiar' : discovery <= 40 ? 'Mostly familiar' : discovery <= 60 ? 'Balanced' : discovery <= 80 ? 'Mostly new' : 'Adventurous'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">Familiar</span>
          <input
            type="range"
            min={0}
            max={100}
            value={discovery}
            onChange={e => onDiscoveryChange(Number(e.target.value))}
            className="flex-1 accent-zinc-400"
          />
          <span className="text-xs text-zinc-600">New</span>
        </div>
      </div>

      {/* Genre selector */}
      <div data-guide="genres" className="flex flex-col gap-2">
        <label className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
          Genres
          {settingsDirty && <span className="text-amber-500 text-[10px] normal-case tracking-normal font-normal">· queued</span>}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {GENRE_OPTIONS.map(g => (
            <button
              key={g}
              onClick={() => toggleGenre(g)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                genres.includes(g)
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <input
          value={genreText}
          onChange={e => onGenreTextChange(e.target.value)}
          placeholder="e.g. dreamy shoegaze, dark ambient…"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* World region */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
          Region
          {settingsDirty && <span className="text-amber-500 text-[10px] normal-case tracking-normal font-normal">· queued</span>}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {REGION_OPTIONS.map(r => (
            <button
              key={r}
              onClick={() => toggleRegion(r)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                regions.includes(r)
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Time period */}
      <div data-guide="heard" className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
          Time period
          {settingsDirty && <span className="text-amber-500 text-[10px] normal-case tracking-normal font-normal">· queued</span>}
        </label>
        <input
          value={timePeriod}
          onChange={e => onTimePeriodChange(e.target.value)}
          placeholder="e.g. 1970s, after 2020, baroque era…"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Popularity */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">Popularity</label>
          <span className="text-xs text-zinc-400">
            {popularity <= 20 ? 'Hidden gems' : popularity <= 40 ? 'Obscure' : popularity >= 80 ? 'Mainstream' : popularity >= 60 ? 'Popular' : 'Mixed'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">Obscure</span>
          <input
            type="range"
            min={0}
            max={100}
            value={popularity}
            onChange={e => onPopularityChange(Number(e.target.value))}
            className="flex-1 accent-zinc-400"
          />
          <span className="text-xs text-zinc-600">Mainstream</span>
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
          Tell the DJ
          {settingsDirty && <span className="text-amber-500 text-[10px] normal-case tracking-normal font-normal">· queued</span>}
        </label>
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          placeholder="e.g. more 80s, no country, upbeat only…"
          rows={2}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* History */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">
            Heard ({history.length})
          </label>
          {history.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-zinc-500 hover:text-white transition-colors"
              >
                {selected.size === history.length && history.length > 0 ? 'Deselect all' : 'Select all'}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={deleteSelected}
                  className="text-xs text-red-500 hover:text-red-400 transition-colors"
                >
                  Delete {selected.size}
                </button>
              )}
            </div>
          )}
        </div>

        {history.length === 0 && (
          <p className="text-zinc-700 text-xs py-1">No songs yet.</p>
        )}

        <div className="flex flex-col gap-1">
          {[...history].reverse().map((entry, i) => {
            const realIndex = history.length - 1 - i
            const isSelected = selected.has(realIndex)
            const isPending = !submittedUris.has(entry.uri ?? '')
            const playableTrackId = normalizeSpotifyTrackId(entry.uri ?? undefined)
            return (
              <div
                key={realIndex}
                data-guide={i === 0 ? 'heard-item' : undefined}
                className={`flex items-center gap-2 py-1 rounded-lg px-1 transition-colors ${isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-900/50'} ${isPending ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(realIndex)}
                  className="flex-shrink-0 accent-zinc-400 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => onPlayHistoryItem(entry)}
                  disabled={!playableTrackId}
                  className="flex-1 min-w-0 flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl px-2 py-1 text-left transition-colors disabled:opacity-50"
                  style={{
                    cursor: playableTrackId ? 'pointer' : 'not-allowed',
                    touchAction: 'manipulation',
                  }}
                >
                  {entry.albumArt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.albumArt}
                      alt=""
                      className="w-9 h-9 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-md bg-zinc-800 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{entry.track}</p>
                    <p className="text-zinc-500 text-xs truncate">{entry.artist}</p>
                  </div>
                </button>
                <div className="flex flex-col flex-shrink-0 gap-1" style={{ width: 96 }}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${gradeColor(entry)}`}>{gradeLabel(entry)}</span>
                    <span className="text-[10px] text-zinc-500">{Math.round(entry.percentListened)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(entry.percentListened)}
                    onChange={e => onRateHistoryItem(realIndex, Number(e.target.value))}
                    className={`w-full ${entry.percentListened >= 75 ? 'accent-green-500' : entry.percentListened >= 45 ? 'accent-zinc-400' : 'accent-red-500'}`}
                    style={{ height: 16 }}
                    title={`${Math.round(entry.percentListened)}%`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
