'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { countCustomChannels, deleteChannelsByIds } from '@/app/lib/channelBulkActions'
import {
  ALL_CHANNEL_DISCOVERY_DEFAULT,
  CHANNEL_DISCOVERY_DEFAULT,
  ensureAllChannel,
  EARPRINT_ALL_CHANNEL_ID,
  fetchFactoryChannelSet,
  genChannelId,
  normalizeChannelDiscovery,
  sortChannelsAlpha,
  type Channel,
} from '@/app/lib/channelsImportExport'
import { sanitizeSelectedArtists } from '@/app/lib/artistHintsFromNotes'

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const ALL_CHANNEL_ID = EARPRINT_ALL_CHANNEL_ID
const SETTINGS_STORAGE_KEY = 'earprint-settings'

function readSettingsSource(): 'spotify' | 'youtube' {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { source?: string }
      if (parsed.source === 'youtube' || parsed.source === 'spotify') return parsed.source
    }
  } catch {}
  return 'spotify'
}

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

function ensureAllChannelLocal(channels: Channel[]): Channel[] {
  return ensureAllChannel(channels.length ? channels : [makeAllChannel()])
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
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState<'delete-selected' | 'replace-factory' | null>(null)

  useEffect(() => {
    let loaded: Channel[] = []
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      loaded = sortChannelsAlpha(
        ensureAllChannelLocal(raw ? JSON.parse(raw) : [])
          .map(mergeArtistTextIntoNotes)
          .map(normalizeChannelDiscovery)
          .map(ch =>
            ch.id === ALL_CHANNEL_ID
              ? ch
              : { ...ch, artists: sanitizeSelectedArtists(ch.artists ?? []) }
          )
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
    const normalized = sortChannelsAlpha(
      ensureAllChannelLocal(updated).map(ch =>
        ch.id === ALL_CHANNEL_ID ? ch : { ...ch, artists: sanitizeSelectedArtists(ch.artists ?? []) }
      )
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

  const deleteSelected = () => {
    const ids = checkedIds
    const updated = deleteChannelsByIds(channels, ids)
    persist(updated)
    setCheckedIds(new Set())
    if (selectedId && ids.has(selectedId)) {
      switchChannel(updated[0]?.id ?? ALL_CHANNEL_ID)
    }
    setBulkConfirm(null)
  }

  const toggleChecked = (id: string, on: boolean) => {
    if (id === ALL_CHANNEL_ID) return
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectAllCustom = () => {
    setCheckedIds(new Set(channels.filter(c => c.id !== ALL_CHANNEL_ID).map(c => c.id)))
  }

  const clearSelection = () => setCheckedIds(new Set())

  const replaceWithFactory = async () => {
    const loaded = await fetchFactoryChannelSet(readSettingsSource())
    if (!loaded) {
      setBulkConfirm(null)
      return
    }
    persist(loaded.channels)
    switchChannel(loaded.activeChannelId)
    setBulkConfirm(null)
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
      const merged = sortChannelsAlpha(ensureAllChannelLocal([...cur, ...toAdd]))
      persist(merged)
      const newActive =
        firstId && merged.find(c => c.id === firstId) ? firstId : (toAdd[0]?.id ?? cur[0]?.id ?? '')
      if (newActive) switchChannel(newActive)
    } catch {}
  }

  const openNewChannelForm = useCallback(() => {
    setNewChannelFormInitial(emptySoundingsEditorValues())
    setNewChannelFormKey(k => k + 1)
    setShowNew(true)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
        <AppHeader />
      </div>
    )
  }

  const selected = channels.find(c => c.id === selectedId) ?? channels[0]
  const customCount = countCustomChannels(channels)
  const hasCustomChannels = customCount > 0
  const selectedDeleteCount = checkedIds.size
  const deletableIds = channels.filter(c => c.id !== ALL_CHANNEL_ID).map(c => c.id)
  const allCustomSelected =
    deletableIds.length > 0 && deletableIds.every(id => checkedIds.has(id))

  const channelListRow = (ch: Channel) => {
    const isActive = selectedId === ch.id && !showNew
    const canCheck = ch.id !== ALL_CHANNEL_ID
    const isChecked = checkedIds.has(ch.id)
    return (
      <div
        key={ch.id}
        className={`flex items-center gap-2 ${
          isActive ? 'bg-zinc-100' : 'hover:bg-zinc-50'
        } rounded-lg transition-colors`}
      >
        {canCheck ? (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={e => toggleChecked(ch.id, e.target.checked)}
            className="ml-2 h-4 w-4 shrink-0 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            aria-label={`Select ${ch.name} for deletion`}
          />
        ) : (
          <span className="ml-2 w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => switchChannel(ch.id)}
          className={`min-w-0 flex-1 text-left py-2.5 pr-3 text-sm font-medium transition-colors ${
            isActive ? 'text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'
          }`}
        >
          <span className="block truncate">{ch.name}</span>
        </button>
      </div>
    )
  }

  const bulkActionsBar = (className = '') => (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          type="button"
          onClick={selectAllCustom}
          disabled={deletableIds.length === 0 || allCustomSelected}
          className="text-zinc-500 hover:text-zinc-800 disabled:opacity-40 disabled:hover:text-zinc-500"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearSelection}
          disabled={selectedDeleteCount === 0}
          className="text-zinc-500 hover:text-zinc-800 disabled:opacity-40 disabled:hover:text-zinc-500"
        >
          Clear
        </button>
      </div>
      <button
        type="button"
        onClick={() => selectedDeleteCount > 0 && setBulkConfirm('delete-selected')}
        disabled={selectedDeleteCount === 0}
        className="w-full text-left text-xs text-red-600 hover:text-red-700 disabled:opacity-40 disabled:hover:text-red-600 transition-colors"
      >
        Delete selected{selectedDeleteCount > 0 ? ` (${selectedDeleteCount})` : ''}…
      </button>
      {customCount > 0 && (
        <button
          type="button"
          onClick={() => setBulkConfirm('replace-factory')}
          className="w-full text-left text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          Replace with factory defaults…
        </button>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <AppHeader />

      {mounted && !hasCustomChannels && !showNew && (
        <div className="mx-auto flex min-h-[calc(100dvh-2.75rem)] max-w-2xl flex-col justify-center px-4 py-12 sm:px-6">
          <div className="mb-8 text-center">
            <Link href="/player" className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors">
              ← Player
            </Link>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">Channels</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              Channels are taste filters — genres, eras, artists — each with its own queue and history.
              Start from scratch or load bundled examples.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={openNewChannelForm}
              className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm transition-all hover:border-indigo-300 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-xl font-light text-white transition-colors group-hover:bg-indigo-500">
                +
              </span>
              <span className="mt-4 text-base font-semibold text-zinc-900">Create a channel</span>
              <span className="mt-1.5 text-sm leading-relaxed text-zinc-500">
                Define genres, time periods, and a free-text prompt for the AI.
              </span>
            </button>

            <button
              type="button"
              onClick={() => void mergeFactoryChannels()}
              className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-lg text-zinc-600 transition-colors group-hover:border-zinc-300 group-hover:bg-zinc-100">
                ✦
              </span>
              <span className="mt-4 text-base font-semibold text-zinc-900">Load starter channels</span>
              <span className="mt-1.5 text-sm leading-relaxed text-zinc-500">
                Bundled examples (jazz, indie, etc.) you can edit or delete anytime.
              </span>
            </button>
          </div>
        </div>
      )}

      {mounted && !hasCustomChannels && showNew && (
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
          <div className="mb-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setNewChannelFormInitial(emptySoundingsEditorValues())
                setShowNew(false)
              }}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-lg font-bold text-zinc-900">New channel</h1>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
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
        </div>
      )}

      {hasCustomChannels && (
      <div className="max-w-4xl mx-auto flex h-[calc(100dvh-2.75rem)] sm:h-[calc(100vh-2.75rem)] flex-col sm:flex-row min-h-0 w-full">
        <div className="hidden w-44 shrink-0 flex-col border-r border-zinc-200 bg-white sm:flex">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Channels</span>
            <button
              type="button"
              onClick={openNewChannelForm}
              className="text-zinc-400 hover:text-indigo-600 transition-colors text-lg leading-none"
              title="New channel"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1 min-h-0 px-1">
            {channels.map(ch => channelListRow(ch))}
          </div>
          {customCount > 0 && (
            <div className="border-t border-zinc-100 p-3">{bulkActionsBar()}</div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="sm:hidden border-b border-zinc-200 bg-white px-3 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Channels</span>
              <button
                type="button"
                onClick={openNewChannelForm}
                className="text-zinc-400 hover:text-indigo-600 text-lg leading-none"
                title="New channel"
              >
                +
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto">{channels.map(ch => channelListRow(ch))}</div>
            {customCount > 0 && bulkActionsBar('pt-1 border-t border-zinc-100')}
          </div>
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
              {selected.id !== ALL_CHANNEL_ID ? (
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
            <div className="p-10 text-center text-zinc-400 text-sm">Select a channel to edit.</div>
          )}
        </div>
      </div>
      )}

      {bulkConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setBulkConfirm(null)}
        >
          <div
            className="bg-white border border-zinc-200 rounded-xl p-6 max-w-sm w-full shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {bulkConfirm === 'delete-selected' && (
              <>
                <h3 className="text-base font-semibold mb-2">Delete selected channels?</h3>
                <p className="text-sm text-zinc-500 mb-6">
                  Removes {selectedDeleteCount} channel{selectedDeleteCount !== 1 ? 's' : ''} and their history. The{' '}
                  <strong className="text-zinc-700">All</strong> channel cannot be deleted.
                </p>
                <ul className="text-sm text-zinc-600 mb-6 max-h-40 overflow-y-auto space-y-1">
                  {channels
                    .filter(c => checkedIds.has(c.id))
                    .map(c => (
                      <li key={c.id} className="truncate">
                        {c.name}
                      </li>
                    ))}
                </ul>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkConfirm(null)}
                    className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white"
                  >
                    Delete {selectedDeleteCount}
                  </button>
                </div>
              </>
            )}
            {bulkConfirm === 'replace-factory' && (
              <>
                <h3 className="text-base font-semibold mb-2">Replace with factory defaults?</h3>
                <p className="text-sm text-zinc-500 mb-6">
                  Replaces your entire channel list with the factory default set. All {customCount} current custom
                  channel{customCount !== 1 ? 's are' : ' is'} removed.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkConfirm(null)}
                    className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void replaceWithFactory()}
                    className="px-4 py-2 text-sm rounded-lg bg-zinc-900 hover:bg-zinc-700 text-white"
                  >
                    Replace
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
