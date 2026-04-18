'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/app/components/AppHeader'
import {
  CHANNELS_EXPORT_VERSION,
  parseChannelsImport,
  type Channel,
} from '@/app/lib/channelsImportExport'
import { getBundledFactoryChannelsForReset } from '@/app/lib/demoChannel'
import { DEV_FACTORY_OVERRIDE_STORAGE_KEY, isNextDev } from '@/app/lib/devFactoryOverride'

const SHOW_SERVER_FACTORY_UI = isNextDev()

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const SETTINGS_STORAGE_KEY = 'earprint-settings'
const HISTORY_STORAGE_KEY = 'earprint-history'
/** Removed from product; strip if present so old profiles do not confuse debugging. */
const LEGACY_FACTORY_CHANNELS_KEY = 'earprint-factory-channels'
const EARPRINT_ALL_CHANNEL_ID = 'earprint-all'

/** After system reset the player keeps a single empty All channel (no factory load). */
function systemResetChannelsJson(): string {
  return JSON.stringify([
    {
      id: EARPRINT_ALL_CHANNEL_ID,
      name: 'All',
      isAutoNamed: false,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      createdAt: 0,
      genres: [],
      genreText: '',
      timePeriod: '',
      notes: '',
      regions: [],
      artists: [],
      artistText: '',
      popularity: 50,
      discovery: 50,
    },
  ])
}

type LLMProvider = 'anthropic' | 'openai' | 'deepseek' | 'gemini'
type PlaybackSource = 'spotify' | 'youtube'

const LLM_OPTIONS: { value: LLMProvider; label: string; sub: string }[] = [
  { value: 'anthropic', label: 'Claude', sub: 'Anthropic' },
  { value: 'openai', label: 'GPT-4o', sub: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek', sub: 'DeepSeek' },
  { value: 'gemini', label: 'Gemini', sub: 'Google' },
]

const SOURCE_OPTIONS: { value: PlaybackSource; label: string; sub: string }[] = [
  { value: 'spotify', label: 'Spotify', sub: 'Requires Premium' },
  { value: 'youtube', label: 'YouTube', sub: '~100 searches/day' },
]

function readSettings(): { provider: LLMProvider; source: PlaybackSource; globalNotes: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        provider: (['anthropic', 'openai', 'deepseek', 'gemini'].includes(parsed.provider) ? parsed.provider : 'deepseek') as LLMProvider,
        source: (['spotify', 'youtube'].includes(parsed.source) ? parsed.source : 'spotify') as PlaybackSource,
        globalNotes: typeof parsed.globalNotes === 'string' ? parsed.globalNotes : '',
      }
    }
  } catch {}
  return { provider: 'deepseek', source: 'spotify', globalNotes: '' }
}

function writeSettings(patch: Partial<{ provider: LLMProvider; source: PlaybackSource; globalNotes: string }>) {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const existing = raw ? JSON.parse(raw) : {}
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...existing, ...patch }))
  } catch {}
}

export default function SettingsPage() {
  const router = useRouter()
  const [provider, setProvider] = useState<LLMProvider>('deepseek')
  const [source, setSource] = useState<PlaybackSource>('spotify')
  const [globalNotes, setGlobalNotes] = useState('')
  const [mounted, setMounted] = useState(false)
  const [confirm, setConfirm] = useState<
    'system-reset' | 'factory-reset' | 'save-server-factory' | null
  >(null)
  const [serverFactoryPresent, setServerFactoryPresent] = useState(false)
  const [serverFactorySavedAt, setServerFactorySavedAt] = useState<string | null>(null)
  const [factoryFileNotice, setFactoryFileNotice] = useState<string | null>(null)
  const [factoryWriteToken, setFactoryWriteToken] = useState('')
  const [importDialog, setImportDialog] = useState<{
    channels: Channel[]
    activeChannelId?: string
    previousCount: number
  } | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const settings = readSettings()
    setProvider(settings.provider)
    setSource(settings.source)
    setGlobalNotes(settings.globalNotes)
    if (SHOW_SERVER_FACTORY_UI) {
      void fetch('/api/factory-defaults', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((d: { ok?: boolean; savedAt?: string } | null) => {
          if (d?.ok) {
            setServerFactoryPresent(true)
            if (typeof d.savedAt === 'string') setServerFactorySavedAt(d.savedAt)
          } else {
            setServerFactoryPresent(false)
            setServerFactorySavedAt(null)
          }
        })
        .catch(() => {
          setServerFactoryPresent(false)
          setServerFactorySavedAt(null)
        })
    }
    setMounted(true)
  }, [])

  const handleProviderChange = (p: LLMProvider) => {
    setProvider(p)
    writeSettings({ provider: p })
  }

  const handleSourceChange = (s: PlaybackSource) => {
    setSource(s)
    writeSettings({ source: s })
  }

  const handleGlobalNotesChange = (value: string) => {
    setGlobalNotes(value)
    writeSettings({ globalNotes: value })
  }

  const handleSystemReset = () => {
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, systemResetChannelsJson())
      localStorage.setItem(ACTIVE_CHANNEL_KEY, EARPRINT_ALL_CHANNEL_ID)
      localStorage.removeItem(HISTORY_STORAGE_KEY)
      localStorage.removeItem(LEGACY_FACTORY_CHANNELS_KEY)
      localStorage.removeItem(DEV_FACTORY_OVERRIDE_STORAGE_KEY)
      localStorage.removeItem('spotifyRateLimitUntil')
      sessionStorage.clear()
    } catch {}
    router.push('/player')
  }

  const handleFactoryReset = async () => {
    try {
      const r = await fetch('/api/factory-defaults', { credentials: 'same-origin', cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      if (d?.ok && Array.isArray(d.channels) && d.channels.length > 0) {
        localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(d.channels))
        const aid = typeof d.activeChannelId === 'string' && d.activeChannelId ? d.activeChannelId : d.channels[0]?.id
        if (aid) localStorage.setItem(ACTIVE_CHANNEL_KEY, aid)
      } else {
        const { channels, activeChannelId } = getBundledFactoryChannelsForReset()
        if (!channels?.length) return
        localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels))
        localStorage.setItem(ACTIVE_CHANNEL_KEY, activeChannelId)
      }
      localStorage.removeItem(HISTORY_STORAGE_KEY)
      localStorage.removeItem('spotifyRateLimitUntil')
      localStorage.removeItem(LEGACY_FACTORY_CHANNELS_KEY)
    } catch {}
    router.push('/player')
  }

  const handleSaveServerFactoryFile = async () => {
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      const channels = raw ? JSON.parse(raw) : []
      const activeChannelId = localStorage.getItem(ACTIVE_CHANNEL_KEY)
      const res = await fetch('/api/factory-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels,
          activeChannelId,
          writeToken: factoryWriteToken.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFactoryFileNotice(typeof data.error === 'string' ? `Save failed: ${data.error}` : `Save failed (${res.status})`)
        setConfirm(null)
        return
      }
      setFactoryFileNotice(
        typeof data.savedAt === 'string'
          ? `Wrote data/factory-channels.json (${channels.length} channel${channels.length !== 1 ? 's' : ''}).`
          : 'Wrote data/factory-channels.json.',
      )
      setServerFactoryPresent(true)
      if (typeof data.savedAt === 'string') setServerFactorySavedAt(data.savedAt)
    } catch {
      setFactoryFileNotice('Save failed (network or server).')
    }
    setConfirm(null)
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

      <div className="flex-1 p-6 max-w-[800px] mx-auto w-full flex flex-col gap-10">

        {/* AI Model */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">AI Model</h2>
            <p className="text-xs text-zinc-500 mt-0.5">The LLM used to suggest songs across all channels.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LLM_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleProviderChange(opt.value)}
                className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                  provider === opt.value
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500 hover:text-black'
                }`}
              >
                {opt.label}
                <span className="ml-1.5 text-xs opacity-60">{opt.sub}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Source */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Playback Source</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Where music is streamed from. Applies to all channels.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSourceChange(opt.value)}
                className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                  source === opt.value
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500 hover:text-black'
                }`}
              >
                {opt.label}
                <span className="ml-1.5 text-xs opacity-60">{opt.sub}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Global instructions */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Global Instructions</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Extra guidance sent to the AI on every request, across all channels.</p>
          </div>
          <textarea
            value={globalNotes}
            onChange={e => handleGlobalNotesChange(e.target.value)}
            placeholder="e.g. Avoid explicit lyrics. Prefer lesser-known artists."
            rows={4}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-black placeholder-zinc-400 resize-y focus:outline-none focus:border-zinc-500"
          />
        </section>

        {/* Channels backup */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Channels backup</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Download or restore your channel list and ratings from a JSON file. Import replaces everything in this
              browser.
            </p>
          </div>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-hidden
            onChange={async e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setImportNotice(null)
              try {
                const text = await file.text()
                const parsed: unknown = JSON.parse(text)
                const result = parseChannelsImport(parsed)
                if (!result) {
                  setImportNotice('Invalid file — no channels found.')
                  return
                }
                let previousCount = 0
                try {
                  const cur = JSON.parse(localStorage.getItem(CHANNELS_STORAGE_KEY) ?? '[]')
                  previousCount = Array.isArray(cur) ? cur.length : 0
                } catch {}
                setImportDialog({ ...result, previousCount })
              } catch {
                setImportNotice('Could not read file.')
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                try {
                  const chs = JSON.parse(localStorage.getItem(CHANNELS_STORAGE_KEY) ?? '[]') as Channel[]
                  const activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY)
                  const payload = {
                    earprintExportVersion: CHANNELS_EXPORT_VERSION,
                    exportedAt: new Date().toISOString(),
                    activeChannelId: activeId,
                    channels: chs,
                  }
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `soundings-channels-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch {}
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 text-sm hover:border-zinc-500 hover:text-black transition-colors"
            >
              Export channels
            </button>
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className="px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 text-sm hover:border-zinc-500 hover:text-black transition-colors"
            >
              Import channels
            </button>
          </div>
          {importNotice && <p className="text-xs text-red-600">{importNotice}</p>}
        </section>

        <hr className="border-zinc-200" />

        {/* System Reset */}
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">System reset</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              <strong className="text-zinc-600 font-medium">Deletes</strong> every custom channel and all ratings. You
              are left with only the <strong className="text-zinc-600 font-medium">All</strong> channel (the catch-all
              with no filters). Nothing else is recreated until you add channels.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setConfirm('system-reset')}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors"
            >
              Reset all channels
            </button>
          </div>
        </section>

        {/* Factory reset */}
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">Factory reset</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              <strong className="text-zinc-600 font-medium">Loads</strong> the <strong className="text-zinc-600 font-medium">Factory default</strong> channel set (from the server file when your host ships one, otherwise the built-in starter list). Ratings are cleared. Use this after a system reset when you want the full default lineup back — system reset removes channels; factory reset adds the defaults.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setConfirm('factory-reset')}
              className="px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 text-sm hover:border-zinc-500 hover:text-black transition-colors"
            >
              Factory reset
            </button>
          </div>
        </section>

        {SHOW_SERVER_FACTORY_UI && (
          <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Dev only — server factory file</h2>
              <p className="text-xs text-amber-900/80 mt-0.5">
                Blank slates load <code className="text-amber-950">data/factory-channels.json</code> on the server when it
                exists (checked via <code className="text-amber-950">GET /api/factory-defaults</code>). Save your current
                browser channels into that file so every new user (and every restart) picks them up. Commit the file to
                git if you want it in deploys. With <code className="text-amber-950">FACTORY_DEFAULTS_WRITE_SECRET</code>{' '}
                set on the server, send the same value below; with no secret in <code className="text-amber-950">next dev</code>, writes work without a token.
              </p>
            </div>
            {factoryFileNotice && (
              <div className="text-xs text-amber-900 bg-amber-100/80 border border-amber-200 rounded-lg px-3 py-2 flex justify-between gap-2">
                <span>{factoryFileNotice}</span>
                <button type="button" onClick={() => setFactoryFileNotice(null)} className="text-amber-700 hover:text-amber-950 shrink-0">
                  ×
                </button>
              </div>
            )}
            <label className="flex flex-col gap-1 text-xs text-amber-900/90">
              <span>Write token (must match server <code className="text-amber-950">FACTORY_DEFAULTS_WRITE_SECRET</code> when set)</span>
              <input
                type="password"
                autoComplete="off"
                value={factoryWriteToken}
                onChange={e => setFactoryWriteToken(e.target.value)}
                placeholder="Leave empty in dev if secret is unset"
                className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:border-amber-400"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirm('save-server-factory')}
                className="px-4 py-2 rounded-lg border border-amber-300 text-amber-950 text-sm hover:bg-amber-100/80 transition-colors"
              >
                Save current channels to server file
              </button>
            </div>
            <p className="text-xs text-amber-900/70">
              Server file:{' '}
              {serverFactoryPresent
                ? `present${serverFactorySavedAt ? ` · saved ${new Date(serverFactorySavedAt).toLocaleString()}` : ''}`
                : 'not found (blank slate uses code defaults)'}
            </p>
          </section>
        )}

      </div>

      {importDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={e => {
            if (e.target === e.currentTarget) setImportDialog(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white border border-zinc-200 rounded-xl p-6 max-w-md w-full shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-black mb-2">Replace all channels?</h2>
            <p className="text-sm text-zinc-500 mb-6">
              Replace all {importDialog.previousCount} channel(s) with {importDialog.channels.length} imported
              channel(s)? Your current channels will be overwritten.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                onClick={() => setImportDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg bg-amber-700 hover:bg-amber-600 text-white"
                onClick={() => {
                  const { channels: imported, activeChannelId: importedActiveId } = importDialog
                  const newActiveId =
                    importedActiveId && imported.some(c => c.id === importedActiveId)
                      ? importedActiveId
                      : imported[0].id
                  try {
                    localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(imported))
                    localStorage.setItem(ACTIVE_CHANNEL_KEY, newActiveId)
                  } catch {}
                  setImportDialog(null)
                  setImportNotice(null)
                }}
              >
                Replace channels
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      {confirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={e => { if (e.target === e.currentTarget) setConfirm(null) }}
        >
          <div
            className="bg-white border border-zinc-200 rounded-xl p-6 max-w-sm w-full shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {confirm === 'system-reset' && (
              <>
                <h3 className="text-base font-semibold mb-2">System reset?</h3>
                <p className="text-sm text-zinc-500 mb-6">
                  This deletes all of your channels and ratings. You will keep only the <strong className="text-zinc-700">All</strong> channel. You cannot undo this.
                </p>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50">Cancel</button>
                  <button onClick={handleSystemReset} className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white">Delete all</button>
                </div>
              </>
            )}
            {confirm === 'factory-reset' && (
              <>
                <h3 className="text-base font-semibold mb-2">Factory reset?</h3>
                <p className="text-sm text-zinc-500 mb-6">
                  Loads the <strong className="text-zinc-700">Factory default</strong> channels (server file when available, otherwise the built-in list). Ratings will be cleared. This <strong className="text-zinc-700">adds</strong> the default lineup; system reset is what <strong className="text-zinc-700">removes</strong> everything except All.
                </p>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50">Cancel</button>
                  <button onClick={() => void handleFactoryReset()} className="px-4 py-2 text-sm rounded-lg bg-black hover:bg-zinc-800 text-white">Reset to factory</button>
                </div>
              </>
            )}
            {SHOW_SERVER_FACTORY_UI && confirm === 'save-server-factory' && (
              <>
                <h3 className="text-base font-semibold mb-2">Save to server file?</h3>
                <p className="text-sm text-zinc-500 mb-6">
                  Writes <code className="text-zinc-700">data/factory-channels.json</code> on the machine running this
                  Next.js server. New browsers and blank slates will load it after restart.
                </p>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50">Cancel</button>
                  <button onClick={() => void handleSaveServerFactoryFile()} className="px-4 py-2 text-sm rounded-lg bg-black hover:bg-zinc-800 text-white">Save</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
