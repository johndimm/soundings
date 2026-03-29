'use client'

import { useState } from 'react'
import { ListenEvent } from '@/app/lib/llm'
import { SpotifyTrack } from '@/app/lib/spotify'

export interface HistoryEntry extends ListenEvent {
  albumArt: string | null
}

interface CardState {
  track: SpotifyTrack
  reason: string
}

const GENRE_OPTIONS = [
  'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Folk', 'Metal', 'Soul', 'Blues', 'Reggae', 'Latin', 'Punk',
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
  notes: string
  onNotesChange: (v: string) => void
  genres: string[]
  onGenresChange: (v: string[]) => void
  genreText: string
  onGenreTextChange: (v: string) => void
  timePeriod: string
  onTimePeriodChange: (v: string) => void
  onRemoveMultiple: (indices: number[]) => void
  onPlayQueueItem: (index: number) => void
}

export default function SessionPanel({
  history,
  queue,
  loadingNext,
  profile,
  notes,
  onNotesChange,
  genres,
  onGenresChange,
  genreText,
  onGenreTextChange,
  timePeriod,
  onTimePeriodChange,
  onRemoveMultiple,
  onPlayQueueItem,
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

  return (
    <div className="flex flex-col gap-4 text-white w-full">

      {/* Taste profile */}
      {profile && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">What I know about you</label>
          <p className="text-sm text-zinc-300 leading-relaxed">{profile}</p>
        </div>
      )}

      {/* Genre selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-zinc-500 uppercase tracking-wide">Genres</label>
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

      {/* Time period */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500 uppercase tracking-wide">Time period</label>
        <input
          value={timePeriod}
          onChange={e => onTimePeriodChange(e.target.value)}
          placeholder="e.g. 1970s, after 2020, baroque era…"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500 uppercase tracking-wide">Tell the DJ</label>
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          placeholder="e.g. more 80s, no country, upbeat only…"
          rows={2}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Up next */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">
            Up next{queue.length > 0 ? ` (${queue.length})` : ''}
          </label>
          {loadingNext && (
            <span className="text-xs text-zinc-600">Finding…</span>
          )}
        </div>

        {loadingNext && queue.length === 0 && (
          <div className="flex items-center gap-2 text-zinc-600 text-xs py-2">
            <div className="w-4 h-4 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
            Asking the DJ…
          </div>
        )}

        {queue.length === 0 && !loadingNext && (
          <p className="text-zinc-700 text-xs">Nothing queued yet.</p>
        )}

        <div className="flex flex-col gap-1">
          {queue.map((card, i) => (
            <button
              key={card.track.uri}
              onClick={() => onPlayQueueItem(i)}
              className="flex items-center gap-3 bg-zinc-900 hover:bg-zinc-800 rounded-xl p-2 text-left transition-colors w-full"
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
          ))}
        </div>
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
            return (
              <div
                key={realIndex}
                className={`flex items-center gap-2 py-1 rounded-lg px-1 transition-colors ${isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-900/50'}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(realIndex)}
                  className="flex-shrink-0 accent-zinc-400 cursor-pointer"
                />
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

                <div className={`flex flex-col items-center flex-shrink-0 w-10 ${gradeColor(entry)}`}>
                  <span className="text-xs font-bold">{gradeLabel(entry)}</span>
                  <span className="text-xs opacity-60">{Math.round(entry.percentListened)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
