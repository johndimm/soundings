'use client'

import { useState } from 'react'
import { ListenEvent } from '@/app/lib/llm'
import { type CardState, type PlaybackSource } from '@/app/lib/playback/types'

export interface HistoryEntry extends ListenEvent {
  albumArt: string | null
  uri: string | null
  category?: string
  /** Which source this track was played from. */
  source?: PlaybackSource
  // coords is inherited from ListenEvent (coords?: {x,y})
}

const SECTION_STYLES: Record<string, { label: string; labelColor: string; textColor: string; border: string }> = {
  LIKED:    { label: 'Likes',     labelColor: 'text-green-400', textColor: 'text-green-200',  border: 'border-green-900' },
  DISLIKED: { label: 'Dislikes',  labelColor: 'text-red-400',   textColor: 'text-red-200',    border: 'border-red-900' },
  EXPLORED: { label: 'Explored',  labelColor: 'text-blue-400',  textColor: 'text-blue-200',   border: 'border-blue-900' },
  NEXT:     { label: 'Next move', labelColor: 'text-amber-400', textColor: 'text-amber-200',  border: 'border-amber-900' },
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

interface Props {
  queue: CardState[]
  loadingNext: boolean
  profile: string
  onProfileChange: (v: string) => void
  onPlayQueueItem: (index: number) => void
  onRemoveQueueItem: (index: number) => void
  pendingSuggestions: { search: string; reason: string; spotifyId?: string }[]
  /** True while resolving DJ picks into the queue (automatic). */
  promotingDjPending?: boolean
}

export default function SessionPanel({
  queue,
  loadingNext,
  profile,
  onProfileChange,
  onPlayQueueItem,
  onRemoveQueueItem,
  pendingSuggestions,
  promotingDjPending = false,
}: Props) {
  const totalCount = queue.length + pendingSuggestions.length

  return (
    <div className="flex flex-col gap-4 text-white w-full">

      {/* Taste profile */}
      {profile && <ProfileView profile={profile} onEdit={onProfileChange} />}

      <div data-guide="up-next" className="flex flex-col gap-1">
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">
            Queue{totalCount > 0 ? ` (${totalCount})` : ''}
          </span>
          {(loadingNext || promotingDjPending) && (
            <div className="flex items-center gap-1.5 text-zinc-300">
              <div className="w-3.5 h-3.5 border border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
              <span className="text-xs">{promotingDjPending ? 'Adding…' : 'Asking the DJ…'}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 mt-1">
          <div className="flex flex-col gap-1">
            {loadingNext && queue.length === 0 && (
              <div className="flex items-center gap-2 text-zinc-500 text-xs py-2 italic">
                Searching for songs…
              </div>
            )}
            {queue.length === 0 && !loadingNext && pendingSuggestions.length === 0 && (
              <p className="text-zinc-700 text-xs">Nothing queued yet.</p>
            )}
            {queue.map((card, i) => (
              <div key={`${card.track.uri ?? card.track.id}-${i}`} className="flex items-center gap-1">
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
                    {card.reason && (
                      <p className="text-zinc-500 text-xs italic leading-snug mt-0.5 line-clamp-2">{card.reason}</p>
                    )}
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

          {pendingSuggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Up next</span>
              {pendingSuggestions.map((s, i) => (
                <div key={i} className="text-xs px-1">
                  <div className="text-zinc-300 font-medium">{s.search}</div>
                  <div className="text-zinc-500 leading-relaxed">{s.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
