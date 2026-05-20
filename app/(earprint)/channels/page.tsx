'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppHeader from '@/app/components/AppHeader'
import ChannelEditorForm, { type ChannelEditorValues } from '@/app/components/ChannelEditorForm'
import { getBundledFactoryChannelsForReset } from '@/app/lib/demoChannel'
import {
  SOUNDINGS_CHANNEL_EDITOR_CONFIG,
  channelToEditorValues,
  editorValuesToChannel,
  emptySoundingsEditorValues,
  NEW_CHANNEL_PREFILL_KEY,
  prefillToEditorValues,
} from '@/app/lib/channelEditorConfig'
import {
  ALL_CHANNEL_DISCOVERY_DEFAULT,
  CHANNEL_DISCOVERY_DEFAULT,
  genChannelId,
  normalizeChannelDiscovery,
  type Channel,
} from '@/app/lib/channelsImportExport'
import { sanitizeSelectedArtists } from '@/app/lib/artistHintsFromNotes'

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const ALL_CHANNEL_ID = 'earprint-all'

function mergeArtistTextIntoNotes(ch: Channel): Channel {
  const at = typeof ch.artistText === 'string' ? ch.artistText.trim() : ''
  if (!at) return ch
  const n = typeof ch.notes === 'string' ? ch.notes.trim() : ''
  const merged = n ? `${n}\n\n${at}` : at
  return { ...ch, notes: merged, artistText: '' }
}

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
    discovery: ALL_CHANNEL_DISCOVERY_DEFAULT,
  }
}

function ensureAllChannel(channels: Channel[]): Channel[] {
  if (channels.some(c => c.id === ALL_CHANNEL_ID)) return channels
  return [makeAllChannel(), ...channels]
}

function newChannelFromValues(values: ChannelEditorValues): Channel {
  return normalizeChannelDiscovery({
    id: genChannelId(),
    name: values.name.trim() || 'New Channel',
    isAutoNamed: false,
    cardHistory: [],
    sessionHistory: [],
    profile: '',
    createdAt: Date.now(),
    genres: values.genres,
    genreText: '',
    timePeriods: values.timePeriods,
    notes: values.freeText.trim(),
    regions: values.regions,
    artists: sanitizeSelectedArtists(values.artists),
    artistText: '',
    popularity: values.popularity,
    discovery: CHANNEL_DISCOVERY_DEFAULT,
    userCreated: true,
  })
}

export default function ChannelsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const newHandled = useRef(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newChannelFormInitial, setNewChannelFormInitial] = useState<ChannelEditorValues>(
    emptySoundingsEditorValues()
  )
  const [newChannelFormKey, setNewChannelFormKey] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    let loaded: Channel[] = []
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      loaded = ensureAllChannel(raw ? JSON.parse(raw) : [])
      loaded = loaded
        .map(mergeArtistTextIntoNotes)
        .map(normalizeChannelDiscovery)
        .map(ch =>
          ch.id === ALL_CHANNEL_ID
            ? ch
            : { ...ch, artists: sanitizeSelectedArtists(ch.artists ?? []) }
        )
      try {
        localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(loaded))
      } catch {}
      const activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY)
      setChannels(loaded)
      setSelectedId(activeId ?? loaded[0]?.id ?? null)
    } catch {}

    if (searchParams.get('new') === '1' && !newHandled.current) {
      newHandled.current = true
      let next = emptySoundingsEditorValues()
      try {
        const raw = sessionStorage.getItem(NEW_CHANNEL_PREFILL_KEY)
        if (raw) {
          next = prefillToEditorValues(JSON.parse(raw) as unknown)
          sessionStorage.removeItem(NEW_CHANNEL_PREFILL_KEY)
        }
      } catch {}
      setNewChannelFormInitial(next)
      setNewChannelFormKey(k => k + 1)
      setShowNew(true)
      router.replace('/channels', { scroll: false })
    }

    const selectParam = searchParams.get('select')
    if (selectParam) {
      setSelectedId(selectParam)
      setShowNew(false)
      router.replace('/channels', { scroll: false })
    }

    setMounted(true)
  }, [searchParams, router])

  const persist = (updated: Channel[]) => {
    const normalized = ensureAllChannel(updated).map(ch =>
      ch.id === ALL_CHANNEL_ID ? ch : { ...ch, artists: sanitizeSelectedArtists(ch.artists ?? []) }
    )
    setChannels(normalized)
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(normalized))
    } catch {}
  }

  const switchChannel = (id: string) => {
    setSelectedId(id)
    setShowNew(false)
    try {
      localStorage.setItem(ACTIVE_CHANNEL_KEY, id)
    } catch {}
  }

  const createChannel = (values: ChannelEditorValues) => {
    const fresh = newChannelFromValues(values)
    const updated = [...channels, fresh]
    persist(updated)
    switchChannel(fresh.id)
    setNewChannelFormInitial(emptySoundingsEditorValues())
    router.push('/player')
  }

  const updateChannel = (id: string, values: ChannelEditorValues) => {
    const existing = channels.find(c => c.id === id)
    if (!existing) return
    const updated = channels.map(c =>
      c.id === id ? editorValuesToChannel(existing, values) : c
    )
    persist(updated)
    switchChannel(id)
    router.push('/player')
  }

  const deleteChannel = (id: string) => {
    if (id === ALL_CHANNEL_ID) return
    if (channels.length <= 1) return
    const updated = channels.filter(c => c.id !== id)
    persist(updated)
    if (id === selectedId) {
      switchChannel(updated[0]?.id ?? ALL_CHANNEL_ID)
    }
  }

  const mergeFactoryChannels = async () => {
    try {
      const r = await fetch('/api/factory-defaults', { credentials: 'same-origin', cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      let incoming: Channel[] = []
      let firstId = ''
      if (d?.ok && Array.isArray(d.channels) && d.channels.length > 0) {
        incoming = d.channels as Channel[]
        firstId = typeof d.activeChannelId === 'string' ? d.activeChannelId : incoming[0]?.id ?? ''
      } else {
        const fb = getBundledFactoryChannelsForReset()
        incoming = fb.channels as Channel[]
        firstId = fb.activeChannelId
      }
      if (!incoming.length) return
      const cur = channels
      const existingIds = new Set(cur.map(c => c.id))
      const toAdd = incoming
        .filter(c => !existingIds.has(c.id))
        .map(c => (c.id === ALL_CHANNEL_ID ? c : { ...c, userCreated: false as const }))
      const merged = [...cur, ...toAdd]
      persist(merged)
      const newActive =
        firstId && merged.find(c => c.id === firstId) ? firstId : (toAdd[0]?.id ?? cur[0]?.id ?? '')
      if (newActive) switchChannel(newActive)
    } catch {}
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
        <AppHeader />
      </div>
    )
  }

  const selected = channels.find(c => c.id === selectedId) ?? channels[0]

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <AppHeader />

      <div className="max-w-4xl mx-auto flex flex-1 w-full min-h-0 flex-col sm:flex-row">
        <div className="hidden w-44 shrink-0 flex-col border-r border-zinc-200 bg-white sm:flex">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Channels</span>
            <button
              type="button"
              onClick={() => {
                setNewChannelFormInitial(emptySoundingsEditorValues())
                setNewChannelFormKey(k => k + 1)
                setShowNew(true)
              }}
              className="text-zinc-400 hover:text-indigo-600 transition-colors text-lg leading-none"
              title="New channel"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1 min-h-0">
            {channels.map(ch => (
              <button
                key={ch.id}
                type="button"
                onClick={() => switchChannel(ch.id)}
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedId === ch.id && !showNew
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                {ch.name}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showNew ? (
            <div className="p-4 sm:p-6">
              <p className="text-sm font-semibold text-zinc-700 mb-0">New channel</p>
              <ChannelEditorForm
                key={`new-channel-${newChannelFormKey}`}
                initial={newChannelFormInitial}
                config={SOUNDINGS_CHANNEL_EDITOR_CONFIG}
                onSave={createChannel}
                onCancel={() => {
                  setNewChannelFormInitial(emptySoundingsEditorValues())
                  setShowNew(false)
                }}
              />
            </div>
          ) : selected ? (
            <div className="p-4 sm:p-6 space-y-6">
              {selected.id === ALL_CHANNEL_ID && channels.length === 1 ? (
                <div className="flex flex-col gap-3 py-2">
                  <p className="text-sm text-zinc-500">No custom channels yet.</p>
                  <button
                    type="button"
                    onClick={() => void mergeFactoryChannels()}
                    className="self-start px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-700 text-white text-sm font-medium transition-colors"
                  >
                    Merge factory channels
                  </button>
                </div>
              ) : selected.id !== ALL_CHANNEL_ID ? (
                <div>
                  <div className="flex justify-end mb-2">
                    <button
                      type="button"
                      onClick={() => deleteChannel(selected.id)}
                      className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      Delete channel
                    </button>
                  </div>
                  <ChannelEditorForm
                    key={selected.id}
                    initial={channelToEditorValues(selected)}
                    config={SOUNDINGS_CHANNEL_EDITOR_CONFIG}
                    onSave={values => updateChannel(selected.id, values)}
                  />
                </div>
              ) : null}

              <div className="border-t border-zinc-100 pt-4">
                <Link
                  href={`/ratings?channel=${selected.id}`}
                  className="block py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-medium transition-colors text-center"
                >
                  Channel History
                </Link>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-zinc-400 text-sm">Create a channel to get started.</div>
          )}
        </div>
      </div>
    </div>
  )
}
