'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { SpotifyTrack } from '@/app/lib/spotify'
import { ListenEvent, LLMProvider, SongSuggestion } from '@/app/lib/llm'
import SessionPanel, { HistoryEntry } from './SessionPanel'
import MusicMap from './MusicMap'
import { recordFetch, readStats } from '@/app/lib/callTracker'
import { getGuideDemoState } from '@/app/lib/guideDemo'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import { type PlaybackSource, DEFAULT_PLAYBACK_SOURCE } from '@/app/lib/playback/types'
import { isYoutubeResolveTestClientEnabled } from '@/app/lib/youtubeResolveTestClient'
import {
  getYoutubeResolveTestFixtureSuggestion,
  isYoutubeResolveTestFixtureSuggestion,
} from '@/app/lib/youtubeResolveTestDefaults'
import YoutubePlayer, { type YoutubePlayerHandle } from './YoutubePlayer'
import { DEMO_CHANNEL_IMPORT, YOUTUBE_DEMO_CHANNEL_IMPORT } from '@/app/lib/demoChannel'

const HISTORY_STORAGE_KEY = 'earprint-history'
const SETTINGS_STORAGE_KEY = 'earprint-settings'
const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const DEMO_LOADED_KEY = 'earprint-demo-loaded'
const YT_DEMO_LOADED_KEY = 'earprint-yt-demo-loaded'
const CHANNELS_EXPORT_VERSION = 1

interface Channel {
  id: string
  name: string
  isAutoNamed: boolean
  cardHistory: HistoryEntry[]
  sessionHistory: ListenEvent[]
  profile: string
  createdAt: number
  currentCard?: CardState | null
  queue?: CardState[]
  // Profile settings
  genres?: string[]
  genreText?: string
  timePeriod?: string
  notes?: string
  regions?: string[]
  popularity?: number
  discovery?: number
  /** Last playback position (ms) for `playbackTrackUri` when leaving this channel */
  playbackPositionMs?: number
  /** Must match `currentCard.track.uri` for `playbackPositionMs` to apply */
  playbackTrackUri?: string
  /** Which audio source this channel uses. Defaults to 'spotify'. */
  source?: PlaybackSource
  /** User-selected artist names (from LLM quick-picks + free text). */
  artists?: string[]
  artistText?: string
}

function genChannelId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function deriveChannelName(history: HistoryEntry[], profile: string): string {
  const counts: Record<string, number> = {}
  for (const e of history) {
    if (!e.category) continue
    const top = e.category.split('>')[0].trim().split('/')[0].trim()
    if (top) counts[top] = (counts[top] ?? 0) + 1
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g)
  if (top.length >= 2) return `${top[0]} & ${top[1]}`
  if (top.length === 1) return top[0]
  const keywords = profile.match(/\b(jazz|folk|electronic|rock|pop|classical|blues|soul|metal|indie|ambient|hip.hop|reggae|funk|latin|punk|experimental|acoustic|orchestral|country)\b/gi)
  if (keywords?.length) {
    const unique = [...new Set(keywords.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()))].slice(0, 2)
    return unique.join(' & ')
  }
  return ''
}

function loadChannels(): Channel[] {
  try {
    const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Channel[]
  } catch {}
  return []
}

function saveChannels(channels: Channel[]) {
  try {
    localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels))
  } catch {}
}

function normalizeImportedChannel(raw: unknown): Channel | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : genChannelId()
  const name = typeof o.name === 'string' ? o.name : 'Channel'
  const createdAt =
    typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now()
  const cardHistory = Array.isArray(o.cardHistory) ? (o.cardHistory as HistoryEntry[]) : []
  const sessionHistory = Array.isArray(o.sessionHistory) ? (o.sessionHistory as ListenEvent[]) : []
  const profile = typeof o.profile === 'string' ? o.profile : ''
  const isAutoNamed = typeof o.isAutoNamed === 'boolean' ? o.isAutoNamed : false
  const queue = Array.isArray(o.queue) ? (o.queue as CardState[]) : []
  const currentCard =
    o.currentCard === null || o.currentCard === undefined ? null : (o.currentCard as CardState)

  return {
    id,
    name,
    isAutoNamed,
    cardHistory,
    sessionHistory,
    profile,
    createdAt,
    currentCard,
    queue,
    genres: Array.isArray(o.genres) ? (o.genres as string[]) : undefined,
    genreText: typeof o.genreText === 'string' ? o.genreText : undefined,
    timePeriod: typeof o.timePeriod === 'string' ? o.timePeriod : undefined,
    notes: typeof o.notes === 'string' ? o.notes : undefined,
    regions: Array.isArray(o.regions) ? (o.regions as string[]) : undefined,
    popularity: typeof o.popularity === 'number' ? o.popularity : undefined,
    discovery: typeof o.discovery === 'number' ? o.discovery : undefined,
    playbackPositionMs: typeof o.playbackPositionMs === 'number' ? o.playbackPositionMs : undefined,
    playbackTrackUri: typeof o.playbackTrackUri === 'string' ? o.playbackTrackUri : undefined,
    artists: Array.isArray(o.artists) ? (o.artists as string[]) : undefined,
    artistText: typeof o.artistText === 'string' ? o.artistText : undefined,
  }
}

/** Accepts our export shape, `{ channels: [...] }`, or a raw `Channel[]`. */
function parseChannelsImport(raw: unknown): { channels: Channel[]; activeChannelId?: string } | null {
  let list: unknown[] | undefined
  let activeChannelId: string | undefined

  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.channels)) {
      list = o.channels
      if (typeof o.activeChannelId === 'string' && o.activeChannelId) {
        activeChannelId = o.activeChannelId
      }
    } else {
      return null
    }
  } else {
    return null
  }

  const channels: Channel[] = []
  for (const item of list) {
    const ch = normalizeImportedChannel(item)
    if (ch) channels.push(ch)
  }
  if (channels.length === 0) return null
  return { channels, activeChannelId }
}

export interface CommittedSettings {
  notes: string
  genreText: string
  timePeriod: string
  genres: string[]
  regions: string[]
  artists: string[]
  artistText: string
  popularity: number
  discovery: number
}

interface SavedSettings {
  genres?: string[]
  genreText?: string
  timePeriod?: string
  notes?: string
  regions?: string[]
  artists?: string[]
  artistText?: string
  popularity?: number
  provider?: LLMProvider
  discovery?: number
  source?: PlaybackSource
}

function loadSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as SavedSettings
  } catch {}
  return {}
}
const RATE_LIMIT_DEFAULT_WAIT_MS = 30_000
const QUEUE_TARGET = 3   // desired "Up Next" depth
const BUFFER_TARGET = 3  // desired "DJ Thinking" depth

/** Queue and DJ suggestion buffer both at target — no need for another LLM round-trip. */
function djInventoryFull(
  queueLen: number,
  suggestionLen: number
): boolean {
  return queueLen >= QUEUE_TARGET && suggestionLen >= BUFFER_TARGET
}

/** True when DJ constraint fields match the last committed snapshot (no user edit since last LLM commit). */
function djSettingsMatchCommitted(
  c: CommittedSettings,
  notes: string,
  genreText: string,
  timePeriod: string,
  genres: string[],
  regions: string[],
  artists: string[],
  artistText: string,
  popularity: number,
  discovery: number
): boolean {
  if (
    c.notes !== notes ||
    c.genreText !== genreText ||
    c.timePeriod !== timePeriod ||
    c.artistText !== artistText ||
    c.popularity !== popularity ||
    c.discovery !== discovery
  ) {
    return false
  }
  if (
    c.genres.length !== genres.length ||
    c.regions.length !== regions.length ||
    c.artists.length !== artists.length
  ) {
    return false
  }
  for (let i = 0; i < genres.length; i++) if (c.genres[i] !== genres[i]) return false
  for (let i = 0; i < regions.length; i++) if (c.regions[i] !== regions[i]) return false
  for (let i = 0; i < artists.length; i++) if (c.artists[i] !== artists[i]) return false
  return true
}

/** How many LLM songs to request: exactly what's needed to fill queue + buffer, capped at 6. */
function computeNumSongs(queueLen: number, bufferLen: number): number {
  const needed = Math.max(0, QUEUE_TARGET - queueLen) + Math.max(0, BUFFER_TARGET - bufferLen)
  return Math.max(3, Math.min(6, needed))
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void
    Spotify: {
      Player: new (options: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume: number
      }) => SpotifyPlayer
    }
  }
}

interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, cb: (state: unknown) => void): void
  getCurrentState(): Promise<SpotifyPlaybackState | null>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
}

const FADE_DURATION_MS = 700
const FADE_STEPS = 20

async function fadeVolume(player: SpotifyPlayer, from: number, to: number) {
  const stepMs = FADE_DURATION_MS / FADE_STEPS
  for (let i = 1; i <= FADE_STEPS; i++) {
    const v = from + (to - from) * (i / FADE_STEPS)
    await player.setVolume(Math.max(0, Math.min(1, v)))
    await new Promise(r => setTimeout(r, stepMs))
  }
}

interface SpotifyPlaybackState {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: { id: string; name: string; artists: { name: string }[] }
  }
}

interface CardState {
  track: SpotifyTrack
  reason: string
  category?: string
  coords?: { x: number; y: number }
  composed?: number
  performer?: string
}

/** Next card that would play (matches loadChannelIntoState queue shift). */
function peekNextCard(ch: Channel): CardState | null {
  if (ch.currentCard) return ch.currentCard
  if (ch.queue?.length) return ch.queue[0] ?? null
  return null
}

const HEARD_RATE_LIMIT_REASON = 'Replay from your Heard (while Spotify rate limits are active)'
const HEARD_PLAYBACK_REASON = 'Replay from Heard'
const HEARD_FALLBACK_DURATION_MS = 180_000

function historyEntryToTrack(entry: HistoryEntry): SpotifyTrack | null {
  const id = normalizeSpotifyTrackId(entry.uri ?? undefined)
  if (!id) return null
  const uri = `spotify:track:${id}`
  return {
    id,
    uri,
    name: entry.track,
    artist: entry.artist,
    album: 'Unknown',
    albumArt: entry.albumArt ?? null,
    durationMs: HEARD_FALLBACK_DURATION_MS,
    source: 'spotify' as const,
  }
}

/** Liked / ok territory — same idea as green dots on the map (not "not-now"). */
function isPositiveHeard(entry: HistoryEntry): boolean {
  if (entry.reaction === 'not-now') return false
  return entry.percentListened >= 50
}

/** Stable dedup key that works for both Spotify (uses uri) and YouTube (uses id). */
function trackPlayKey(track: { uri?: string; id: string }): string {
  return track.uri ?? track.id
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Matches buildCombinedNotes: 41–59 = no popularity constraint in the prompt. */
function popularityCountsAsExplicitChoice(p: number): boolean {
  return p <= 40 || p >= 60
}

/** Matches SessionPanel discovery labels: 41–60 = "Balanced" (no strong preference). */
function discoveryCountsAsExplicitChoice(d: number): boolean {
  return d <= 40 || d > 60
}

/** True if the user has changed any DJ constraint from defaults (genres, regions, text, sliders, etc.). */
function hasUserChosenDjSettings(
  genres: string[],
  genreText: string,
  regions: string[],
  artists: string[],
  artistText: string,
  notes: string,
  timePeriod: string,
  popularity: number,
  discovery: number
): boolean {
  if (genres.length > 0) return true
  if (genreText.trim()) return true
  if (regions.length > 0) return true
  if (artists.length > 0) return true
  if (artistText.trim()) return true
  if (notes.trim()) return true
  if (timePeriod.trim()) return true
  if (popularityCountsAsExplicitChoice(popularity)) return true
  if (discoveryCountsAsExplicitChoice(discovery)) return true
  return false
}

/** Empty channel (no Heard yet): skip LLM until the user makes an explicit DJ choice. */
function shouldDeferLlmUntilDjChoice(
  cardHistoryLen: number,
  genres: string[],
  genreText: string,
  regions: string[],
  artists: string[],
  artistText: string,
  notes: string,
  timePeriod: string,
  popularity: number,
  discovery: number
): boolean {
  if (cardHistoryLen > 0) return false
  return !hasUserChosenDjSettings(
    genres,
    genreText,
    regions,
    artists,
    artistText,
    notes,
    timePeriod,
    popularity,
    discovery
  )
}

function buildCombinedNotes(
  genres: string[],
  genreText: string,
  timePeriod: string,
  notes: string,
  popularity: number,
  regions: string[],
  artists: string[],
  artistText: string
): string {
  const parts: string[] = []
  if (genres.length > 0) parts.push(`Genres: ${genres.join(', ')}`)
  if (regions.length > 0) parts.push(`World region: ${regions.join(', ')}`)
  if (genreText.trim()) parts.push(`Style: ${genreText.trim()}`)
  if (artists.length > 0) {
    parts.push(
      `Favor these artists when compatible with the 3-slot batch rules (different artists per batch): ${artists.join(', ')}`
    )
  }
  if (artistText.trim()) parts.push(`More artist hints: ${artistText.trim()}`)
  if (timePeriod.trim()) parts.push(`Time period: ${timePeriod.trim()}`)
  if (notes.trim()) parts.push(notes.trim())
  if (popularity <= 20) parts.push('Popularity: obscure hidden gems only — avoid anything well-known or mainstream')
  else if (popularity <= 40) parts.push('Popularity: lean toward lesser-known tracks, avoid obvious hits')
  else if (popularity >= 80) parts.push('Popularity: well-known popular songs preferred')
  else if (popularity >= 60) parts.push('Popularity: lean toward recognizable songs')
  // 41–59 = no constraint (default middle)
  return parts.join('. ')
}

function determineReaction(percent: number): ListenEvent['reaction'] {
  if (percent >= 80) return 'more-from-artist'
  if (percent <= 30) return 'not-now'
  return 'move-on'
}

const formatRetryTime = (ms: number) => {
  const until = new Date(Date.now() + ms)
  return until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

class RateLimitError extends Error {
  retryAfterMs?: number

  constructor(retryAfterMs?: number) {
    super('rate_limited')
    this.retryAfterMs = retryAfterMs
  }
}

class AuthError extends Error {
  constructor() {
    super('not_authenticated')
  }
}

/** Web Playback SDK can emit auth errors repeatedly; avoid a redirect storm on Vercel. */
let spotifyLoginRedirectScheduled = false

const SPOTIFY_REDIRECT_WINDOW_START = 'spotifyAuthRedirectWindowStart'
const SPOTIFY_REDIRECT_COUNT = 'spotifyAuthRedirectCount'
/** Set before first auto-redirect to OAuth; cleared on successful token. Blocks Vercel reload loop when cookies still fail after callback. */
const SPOTIFY_AUTH_REDIRECT_ONCE_KEY = 'spotifyAuthRedirectOnce'
const REDIRECT_WINDOW_MS = 10 * 60 * 1000
const MAX_REDIRECTS_PER_WINDOW = 5

function clearSpotifyAuthRedirectLoop() {
  try {
    sessionStorage.removeItem(SPOTIFY_REDIRECT_WINDOW_START)
    sessionStorage.removeItem(SPOTIFY_REDIRECT_COUNT)
    sessionStorage.removeItem(SPOTIFY_AUTH_REDIRECT_ONCE_KEY)
  } catch {}
}

/** Returns false if too many redirects in the window (loop breaker). */
function recordSpotifyAuthRedirectAttempt(): boolean {
  try {
    const now = Date.now()
    const start = sessionStorage.getItem(SPOTIFY_REDIRECT_WINDOW_START)
    let count = Number(sessionStorage.getItem(SPOTIFY_REDIRECT_COUNT) || '0')
    if (!start || now - Number(start) > REDIRECT_WINDOW_MS) {
      sessionStorage.setItem(SPOTIFY_REDIRECT_WINDOW_START, String(now))
      sessionStorage.setItem(SPOTIFY_REDIRECT_COUNT, '1')
      return true
    }
    if (count >= MAX_REDIRECTS_PER_WINDOW) return false
    count += 1
    sessionStorage.setItem(SPOTIFY_REDIRECT_COUNT, String(count))
    return true
  } catch {
    return true
  }
}

/** SDK `authentication_error` can fire in a tight loop; cap redirects per window. */
function trySpotifyRedirect(
  setError: (msg: string | null) => void,
  reason: string,
): void {
  if (typeof window === 'undefined' || spotifyLoginRedirectScheduled) return
  if (!recordSpotifyAuthRedirectAttempt()) {
    setError(
      'Spotify login could not complete. Please try again later or clear site data for this site.',
    )
    console.warn('Spotify session: blocked redirect loop:', reason)
    return
  }
  spotifyLoginRedirectScheduled = true
  console.warn('Spotify session: redirecting to login:', reason)
  window.location.href = '/api/auth/login'
}

/** Set by inline script in `app/player/page.tsx` before the client bundle loads. */
function readWindowYtResolveTestFlag(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (window as unknown as { __EP_YT_RESOLVE_TEST__?: boolean }).__EP_YT_RESOLVE_TEST__ === true
  )
}

export default function PlayerClient({
  accessToken: initialAccessToken,
  guideDemo,
  youtubeResolveTestFromServer,
  youtubeOnly,
}: {
  accessToken: string
  guideDemo?: string | null
  /** From server env on `/player` — reliable when NEXT_PUBLIC_* is missing from the client bundle. */
  youtubeResolveTestFromServer: boolean
  /** No Spotify token — force YouTube source and skip Spotify SDK. */
  youtubeOnly?: boolean
}) {
  const isGuideDemo = Boolean(guideDemo)

  /** null = still fetching `/api/player-config` when server + NEXT_PUBLIC + window flag are all false. */
  const [playerConfigDj, setPlayerConfigDj] = useState<boolean | null>(() => {
    if (youtubeResolveTestFromServer) return true
    if (isYoutubeResolveTestClientEnabled()) return true
    if (readWindowYtResolveTestFlag()) return true
    return null
  })

  useEffect(() => {
    if (playerConfigDj !== null) return
    let cancelled = false
    fetch('/api/player-config')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { youtubeResolveTestDj?: boolean } | null) => {
        if (cancelled || !data) return
        setPlayerConfigDj(Boolean(data.youtubeResolveTestDj))
      })
      .catch(() => {
        if (!cancelled) setPlayerConfigDj(false)
      })
    const t = setTimeout(() => {
      if (!cancelled) setPlayerConfigDj(prev => (prev === null ? false : prev))
    }, 8000)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [playerConfigDj])

  const youtubeResolveTestActive =
    youtubeResolveTestFromServer ||
    isYoutubeResolveTestClientEnabled() ||
    playerConfigDj === true

  // ── React state ──────────────────────────────────────────────────────────
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [currentCard, setCurrentCard] = useState<CardState | null>(null)
  const [queue, setQueue] = useState<CardState[]>([])
  const [, setSessionHistory] = useState<ListenEvent[]>([])
  const [cardHistory, setCardHistory] = useState<HistoryEntry[]>([])
  const [, setPriorProfile] = useState('')
  const [profile, setProfile] = useState('')
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backoffUntil, setBackoffUntil] = useState<number | null>(null)
  const backoffUntilRef = useRef<number | null>(null)
  useEffect(() => {
    backoffUntilRef.current = backoffUntil
  }, [backoffUntil])

  /** True while Spotify resolve should be avoided (rate limit / gate). Profile-only LLM is skipped server-side when Spotify is offline. */
  const isSpotifyBackoffActive = () => {
    const u = backoffUntilRef.current
    return Boolean(u && u > Date.now())
  }

  const [spotifyUser, setSpotifyUser] = useState<{ id: string; display_name?: string; product?: string } | null>(null)
  const [playResponse, setPlayResponse] = useState<string | null>(null)
  /** Inline message for channel import/parse errors (no window.alert). */
  const [channelsNotice, setChannelsNotice] = useState<string | null>(null)
  /** Modal: confirm channel import or full reset (no window.confirm). */
  const [channelsDialog, setChannelsDialog] = useState<
    | null
    | { kind: 'import'; data: { channels: Channel[]; activeChannelId?: string } }
    | { kind: 'reset' }
  >(null)
  const [notes, setNotes] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [genreText, setGenreText] = useState('')
  const [regions, setRegions] = useState<string[]>([])
  const [artists, setArtists] = useState<string[]>([])
  const [artistText, setArtistText] = useState('')
  /** Names from the latest LLM response (`suggested_artists`); not persisted per channel. */
  const [llmSuggestedArtists, setLlmSuggestedArtists] = useState<string[]>([])
  const [timePeriod, setTimePeriod] = useState('')
  const [popularity, setPopularity] = useState(50)
  const [discovery, setDiscovery] = useState(50)
  const [provider, setProvider] = useState<LLMProvider>('deepseek')
  const [source, setSource] = useState<PlaybackSource>(youtubeOnly ? 'youtube' : DEFAULT_PLAYBACK_SOURCE)
  const [ytSearchesRemaining, setYtSearchesRemaining] = useState<number | null>(null)
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null)
  const [sliderPosition, setSliderPosition] = useState(0)
  const [youtubeDuration, setYoutubeDuration] = useState(0)
  const [gradePercent, setGradePercent] = useState(0)
  const [gradeTracking, setGradeTracking] = useState(true)
  const [hasRated, setHasRated] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  /** False until loadSettings runs — prevents persist effects from overwriting localStorage with empty defaults on first paint. */
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  /** Bumps when user presses Next (etc.) so the play effect re-runs even if the next track has the same URI as before. */
  const [playGeneration, setPlayGeneration] = useState(0)
  /** LLM suggestions not yet looked up on Spotify — resolved one-at-a-time when filling Up Next or starting playback. */
  const [suggestionBuffer, setSuggestionBuffer] = useState<SongSuggestion[]>([])
  const [submittedUris, setSubmittedUris] = useState<Set<string>>(new Set())
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string>('')
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingChannelName, setEditingChannelName] = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const settingsInitRef = useRef(false)
  const skipNextDirtyRef = useRef(false)
  const [committedSettings, setCommittedSettings] = useState<CommittedSettings>({
    notes: '',
    genreText: '',
    timePeriod: '',
    genres: [],
    regions: [],
    artists: [],
    artistText: '',
    popularity: 50,
    discovery: 50,
  })
  const committedSettingsRef = useRef<CommittedSettings>(committedSettings)
  useEffect(() => {
    committedSettingsRef.current = committedSettings
  }, [committedSettings])
  const [cooldownTick, setCooldownTick] = useState(0)
  const cooldownRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [spotifyPingInFlight, setSpotifyPingInFlight] = useState(false)
  const [promotingDjPending, setPromotingDjPending] = useState(false)

  const dedupeHistory = useCallback((entries: HistoryEntry[]) => {
    const map = new Map<string, HistoryEntry>()
    entries.forEach(entry => map.set(`${entry.track}|${entry.artist}`, entry))
    return Array.from(map.values())
  }, [])

  // ── Refs ─────────────────────────────────────────────────────────────────
  const accessTokenRef = useRef(initialAccessToken)
  const redirectToSpotifyLoginRef = useRef<(reason: string) => void>(() => {})
  redirectToSpotifyLoginRef.current = (reason: string) => {
    trySpotifyRedirect(setError, reason)
  }
  const forceSpotifyLoginRedirectRef = useRef<(reason: string) => void>(() => {})
  forceSpotifyLoginRedirectRef.current = (reason: string) => {
    if (typeof window === 'undefined' || spotifyLoginRedirectScheduled) return
    try {
      if (sessionStorage.getItem(SPOTIFY_AUTH_REDIRECT_ONCE_KEY) === '1') {
        setError(
          'Spotify session could not be restored after sign-in (token still unauthorized). Use the button below to try again, or a private window if cookies are stuck.',
        )
        console.warn('Spotify session: not auto-redirecting again (would loop on Vercel):', reason)
        return
      }
      sessionStorage.setItem(SPOTIFY_AUTH_REDIRECT_ONCE_KEY, '1')
    } catch {
      /* sessionStorage unavailable — still try one redirect */
    }
    spotifyLoginRedirectScheduled = true
    console.warn('Spotify session: redirecting to login:', reason)
    window.location.href = '/api/auth/login'
  }
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const youtubePlayerRef = useRef<YoutubePlayerHandle | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sdkReadyRef = useRef(false)
  const isSeekingRef = useRef(false)
  const currentCardRef = useRef<CardState | null>(null)
  const queueRef = useRef<CardState[]>([])
  const sessionHistoryRef = useRef<ListenEvent[]>([])
  const priorProfileRef = useRef('')
  const notesRef = useRef('')
  const genresRef = useRef<string[]>([])
  const genreTextRef = useRef('')
  const regionsRef = useRef<string[]>([])
  const artistsRef = useRef<string[]>([])
  const artistTextRef = useRef('')
  const timePeriodRef = useRef('')
  const popularityRef = useRef(50)
  const providerRef = useRef<LLMProvider>('deepseek')
  const sourceRef = useRef<PlaybackSource>(DEFAULT_PLAYBACK_SOURCE)
  const sliderRef = useRef(0)
  const durationRef = useRef(0)
  const isPausedRef = useRef(true)
  const advanceRef = useRef<((playedToEnd?: boolean) => void) | null>(null)
  const pendingFadeInRef = useRef(false)
  const channelSwitchingRef = useRef(false)
  const importChannelsInputRef = useRef<HTMLInputElement>(null)
  const deviceIdRef = useRef<string | null>(null)
  const lastPlayedUriRef = useRef<string | null>(null)
  const trackPlayStartAtRef = useRef<number>(0)
  const playedUrisRef = useRef<Set<string>>(new Set())
  const fetchGenRef = useRef(0)
  const fetchingRef = useRef(false)
  const exploreModeRef = useRef<number>(50)
  const gradeRef = useRef(50)
  const hasRatedRef = useRef(false)
  const cardHistoryRef = useRef<HistoryEntry[]>([])
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionBufferRef = useRef<SongSuggestion[]>([])
  /** Track resolve success rate to calibrate how many songs to request from LLM. */
  const resolveStatsRef = useRef({ attempts: 0, successes: 0 })
  const getResolveSuccessRate = () => {
    const { attempts, successes } = resolveStatsRef.current
    return attempts === 0 ? 0.75 : successes / attempts
  }
  /** Set after `consumeDjSuggestionBuffer` is defined — used from fetchToBuffer before effect runs. */
  const consumeDjSuggestionBufferRef = useRef<
    ((opts?: { userInitiated?: boolean }) => Promise<void>) | null
  >(null)
  const djQueueLoggedHistoryWaitRef = useRef(false)
  const resolvingRef = useRef(false)
  const profileGenRef = useRef(0)
  const channelsRef = useRef<Channel[]>([])
  const activeChannelIdRef = useRef<string>('')
  const lastFetchAtRef = useRef<number>(0)
  /** After constraint resolve returns 0 cards but LLM had rows, avoid immediate LLM refetch loop when consume empties the buffer. */
  const djLlmRetryAfterMsRef = useRef(0)
  const FETCH_COOLDOWN_MS = 15_000
  const pendingPlaybackPositionMsRef = useRef<number | undefined>(undefined)
  /** Console filter: `[dj-queue]` — why DJ suggestions do or don’t reach Up Next */
  const DJQ = '[dj-queue]'

  function clampPlaybackOffsetMs(positionMs: number, durationMs: number): number {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return Math.max(0, positionMs)
    const cap = Math.max(0, durationMs - 750)
    return Math.min(Math.max(0, positionMs), cap)
  }

  // ── Channel management ───────────────────────────────────────────────────

  useEffect(() => {
    if (!guideDemo) return

    const demo = getGuideDemoState(guideDemo)
    const demoDeviceId = 'guide-demo-device'

    setDeviceId(demoDeviceId)
    deviceIdRef.current = demoDeviceId
    setCurrentCard(demo.currentCard)
    currentCardRef.current = demo.currentCard
    setQueue(demo.queue)
    queueRef.current = demo.queue
    setSuggestionBuffer([])
    suggestionBufferRef.current = []
    setSessionHistory(demo.sessionHistory)
    sessionHistoryRef.current = demo.sessionHistory
    setCardHistory(demo.cardHistory)
    cardHistoryRef.current = demo.cardHistory
    setPriorProfile(demo.priorProfile)
    priorProfileRef.current = demo.priorProfile
    setProfile(demo.profile)
    setLoadingQueue(demo.loadingQueue)
    setError(null)
    setBackoffUntil(demo.backoffUntil)
    setSpotifyUser(demo.spotifyUser)
    setPlayResponse(null)
    setNotes(demo.notes)
    notesRef.current = demo.notes
    setGenres(demo.genres)
    genresRef.current = demo.genres
    setGenreText(demo.genreText)
    genreTextRef.current = demo.genreText
    setRegions(demo.regions)
    regionsRef.current = demo.regions
    setArtists(demo.artists)
    artistsRef.current = demo.artists
    setArtistText(demo.artistText)
    artistTextRef.current = demo.artistText
    setLlmSuggestedArtists(demo.llmSuggestedArtists)
    setTimePeriod(demo.timePeriod)
    timePeriodRef.current = demo.timePeriod
    setPopularity(demo.popularity)
    popularityRef.current = demo.popularity
    setDiscovery(demo.discovery)
    exploreModeRef.current = demo.discovery
    setProvider(demo.provider)
    providerRef.current = demo.provider
    setPlaybackState(demo.playbackState)
    setSliderPosition(demo.sliderPosition)
    sliderRef.current = demo.sliderPosition
    durationRef.current = demo.playbackState.duration
    isPausedRef.current = demo.playbackState.paused
    setGradePercent(demo.gradePercent)
    gradeRef.current = demo.gradePercent
    setGradeTracking(true)
    setHasRated(demo.hasRated)
    hasRatedRef.current = demo.hasRated
    setHistoryReady(true)
    setSuggestionBuffer(demo.pendingSuggestions)
    suggestionBufferRef.current = demo.pendingSuggestions
    setSubmittedUris(new Set(demo.submittedUris))
    setChannels(demo.channels)
    channelsRef.current = demo.channels
    setActiveChannelId(demo.activeChannelId)
    activeChannelIdRef.current = demo.activeChannelId
    lastPlayedUriRef.current = demo.currentCard.track.uri
    playedUrisRef.current = new Set(demo.cardHistory.map(entry => entry.uri ?? '').filter(Boolean))
    settingsInitRef.current = true
    setSettingsDirty(demo.settingsDirty)
    setSettingsHydrated(true)
  }, [guideDemo])

  const snapshotCurrentChannel = useCallback((): Channel[] => {
    return channelsRef.current.map(ch => {
      if (ch.id !== activeChannelIdRef.current) return ch
      const autoName = deriveChannelName(cardHistoryRef.current, priorProfileRef.current)
      const name = ch.isAutoNamed && autoName ? autoName : ch.name
      const cur = currentCardRef.current
      const dur = durationRef.current
      const uri = cur?.track.uri
      const playbackPositionMs =
        cur && uri && dur > 0 ? clampPlaybackOffsetMs(sliderRef.current, dur) : undefined
      return {
        ...ch,
        name,
        source: sourceRef.current ?? DEFAULT_PLAYBACK_SOURCE,
        cardHistory: cardHistoryRef.current,
        sessionHistory: sessionHistoryRef.current,
        profile: priorProfileRef.current,
        currentCard: currentCardRef.current,
        queue: queueRef.current,
        genres: genresRef.current,
        genreText: genreTextRef.current,
        timePeriod: timePeriodRef.current,
        notes: notesRef.current,
        regions: regionsRef.current,
        artists: artistsRef.current,
        artistText: artistTextRef.current,
        popularity: popularityRef.current,
        discovery: exploreModeRef.current,
        playbackTrackUri: uri,
        playbackPositionMs,
      }
    })
  }, [])

  const loadChannelIntoState = useCallback((ch: Channel) => {
    const restoredQueue = [...(ch.queue ?? [])]
    const restoredCurrent = ch.currentCard ?? null
    const nextCurrent = restoredCurrent ?? restoredQueue.shift() ?? null

    if (
      nextCurrent &&
      ch.playbackTrackUri === nextCurrent.track.uri &&
      typeof ch.playbackPositionMs === 'number' &&
      ch.playbackPositionMs > 0
    ) {
      pendingPlaybackPositionMsRef.current = clampPlaybackOffsetMs(
        ch.playbackPositionMs,
        nextCurrent.track.durationMs
      )
    } else {
      pendingPlaybackPositionMsRef.current = undefined
    }

    // Stop playback and clear transient state
    setCurrentCard(nextCurrent); currentCardRef.current = nextCurrent
    setQueue(restoredQueue); queueRef.current = restoredQueue
    setSuggestionBuffer([]); suggestionBufferRef.current = []
    fetchingRef.current = false
    lastPlayedUriRef.current = null
    playedUrisRef.current = new Set()
    fetchGenRef.current++

    const deduped = dedupeHistory(ch.cardHistory)
    setCardHistory(deduped); cardHistoryRef.current = deduped
    setSessionHistory(ch.sessionHistory); sessionHistoryRef.current = ch.sessionHistory
    setPriorProfile(ch.profile); priorProfileRef.current = ch.profile
    setProfile(ch.profile)

    // Restore settings
    const g = ch.genres ?? []; setGenres(g); genresRef.current = g
    const gt = ch.genreText ?? ''; setGenreText(gt); genreTextRef.current = gt
    const tp = ch.timePeriod ?? ''; setTimePeriod(tp); timePeriodRef.current = tp
    const n = ch.notes ?? ''; setNotes(n); notesRef.current = n
    const r = ch.regions ?? []; setRegions(r); regionsRef.current = r
    const ar = ch.artists ?? []; setArtists(ar); artistsRef.current = ar
    const at = ch.artistText ?? ''; setArtistText(at); artistTextRef.current = at
    const pop = ch.popularity ?? 50; setPopularity(pop); popularityRef.current = pop
    const disc = ch.discovery ?? 50; setDiscovery(disc); exploreModeRef.current = disc

    setLlmSuggestedArtists([])

    setLoadingQueue(false)

    const nextCommitted: CommittedSettings = {
      notes: n,
      genreText: gt,
      timePeriod: tp,
      genres: [...g],
      regions: [...r],
      artists: [...ar],
      artistText: at,
      popularity: pop,
      discovery: disc,
    }
    setCommittedSettings(nextCommitted)
    committedSettingsRef.current = nextCommitted
    setSettingsDirty(false)

    const nextSource = youtubeOnly ? 'youtube' : (ch.source ?? DEFAULT_PLAYBACK_SOURCE)
    setSource(nextSource)
    sourceRef.current = nextSource

    setActiveChannelId(ch.id); activeChannelIdRef.current = ch.id
    localStorage.setItem(ACTIVE_CHANNEL_KEY, ch.id)
  }, [dedupeHistory])

  /** Fade out whatever is playing (YouTube iframe or Spotify Web Playback) before switching channels. */
  const fadeOutCurrentPlayback = useCallback(async () => {
    if (isGuideDemo) return
    const cur = currentCardRef.current
    if (!cur) return
    if ((cur.track.source as string) === 'youtube') {
      await youtubePlayerRef.current?.fadeOut()
    } else if (playerRef.current) {
      await fadeVolume(playerRef.current, 1, 0)
      await playerRef.current.pause()
      isPausedRef.current = true
    }
  }, [isGuideDemo])

  const switchChannel = useCallback(
    async (id: string) => {
      if (id === activeChannelIdRef.current) return
      if (channelSwitchingRef.current) return
      const target = channelsRef.current.find(c => c.id === id)
      if (!target) return
      channelSwitchingRef.current = true
      try {
        const willPlay = peekNextCard(target) != null
        const hadCurrent = currentCardRef.current != null
        if (!isGuideDemo && hadCurrent) {
          if (willPlay) pendingFadeInRef.current = true
          await fadeOutCurrentPlayback()
        }
        const saved = snapshotCurrentChannel()
        const t = saved.find(c => c.id === id)
        if (!t) return
        setChannels(saved)
        channelsRef.current = saved
        saveChannels(saved)
        loadChannelIntoState(t)
        if (!isGuideDemo && playerRef.current && hadCurrent && !willPlay) {
          pendingFadeInRef.current = false
          await playerRef.current.setVolume(1)
        }
      } finally {
        channelSwitchingRef.current = false
      }
    },
    [snapshotCurrentChannel, loadChannelIntoState, isGuideDemo, fadeOutCurrentPlayback]
  )

  const createChannel = useCallback(async () => {
    if (channelSwitchingRef.current) return
    const fresh: Channel = {
      id: genChannelId(),
      name: 'New Channel',
      isAutoNamed: true,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      currentCard: null,
      queue: [],
      createdAt: Date.now(),
    }
    const willPlay = peekNextCard(fresh) != null
    const hadCurrent = currentCardRef.current != null
    channelSwitchingRef.current = true
    try {
      if (!isGuideDemo && hadCurrent) {
        await fadeOutCurrentPlayback()
      }
      const saved = snapshotCurrentChannel()
      const updated = [...saved, fresh]
      setChannels(updated)
      channelsRef.current = updated
      saveChannels(updated)
      loadChannelIntoState(fresh)
      // Empty new channel: stay paused and quiet until the user picks DJ settings and playback starts again.
      // Do not setVolume(1) here — Spotify would resume the previous track at full volume.
      // Do set pending fade-in so the first play on this channel runs fade 0→1 (volume was left at 0 after fade-out).
      if (!isGuideDemo && playerRef.current && hadCurrent && !willPlay) {
        pendingFadeInRef.current = true
      }
    } finally {
      channelSwitchingRef.current = false
    }
  }, [snapshotCurrentChannel, loadChannelIntoState, isGuideDemo, fadeOutCurrentPlayback])

  const deleteChannel = useCallback(
    async (id: string) => {
      let updated = channelsRef.current.filter(c => c.id !== id)
      if (updated.length === 0) {
        const newId = genChannelId()
        updated = [
          {
            id: newId,
            name: 'New Channel',
            isAutoNamed: true,
            cardHistory: [],
            sessionHistory: [],
            profile: '',
            currentCard: null,
            queue: [],
            createdAt: Date.now(),
          },
        ]
      }

      if (id !== activeChannelIdRef.current) {
        setChannels(updated)
        channelsRef.current = updated
        saveChannels(updated)
        return
      }

      // Deleting the active channel: fade out first, then drop the tab + load replacement
      // so activeChannelId never points at a removed id during the fade.
      if (channelSwitchingRef.current) return
      const replacement = updated[0]
      channelSwitchingRef.current = true
      try {
        const willPlay = peekNextCard(replacement) != null
        const hadCurrent = currentCardRef.current != null
        if (!isGuideDemo && hadCurrent) {
          if (willPlay) pendingFadeInRef.current = true
          await fadeOutCurrentPlayback()
        }
        setChannels(updated)
        channelsRef.current = updated
        saveChannels(updated)
        loadChannelIntoState(replacement)
        if (!isGuideDemo && playerRef.current && hadCurrent && !willPlay) {
          pendingFadeInRef.current = false
          await playerRef.current.setVolume(1)
        }
      } finally {
        channelSwitchingRef.current = false
      }
    },
    [loadChannelIntoState, isGuideDemo, fadeOutCurrentPlayback]
  )

  const renameChannel = useCallback((id: string, name: string) => {
    setChannels(prev => {
      const updated = prev.map(ch => ch.id === id ? { ...ch, name: name.trim() || ch.name, isAutoNamed: false } : ch)
      channelsRef.current = updated
      saveChannels(updated)
      return updated
    })
  }, [])

  const handleExportChannels = useCallback(() => {
    if (isGuideDemo) return
    const snapshot = snapshotCurrentChannel()
    const payload = {
      earprintExportVersion: CHANNELS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      activeChannelId: activeChannelIdRef.current,
      channels: snapshot,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `earprint-channels-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [isGuideDemo, snapshotCurrentChannel])

  const applyImportedChannels = useCallback(
    (result: { channels: Channel[]; activeChannelId?: string }) => {
      saveChannels(result.channels)
      channelsRef.current = result.channels
      setChannels(result.channels)
      const activeId =
        result.activeChannelId && result.channels.some(c => c.id === result.activeChannelId)
          ? result.activeChannelId
          : result.channels[0].id
      const active = result.channels.find(c => c.id === activeId) ?? result.channels[0]
      loadChannelIntoState(active)
      setSubmittedUris(new Set(cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean)))
      setError(null)
      setChannelsNotice(null)
      setChannelsDialog(null)
    },
    [loadChannelIntoState]
  )

  const handleImportChannelsFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || isGuideDemo) return
      setChannelsNotice(null)
      try {
        const text = await file.text()
        const parsed: unknown = JSON.parse(text)
        const result = parseChannelsImport(parsed)
        if (!result) {
          setChannelsNotice(
            'Could not read channels from this file. Expected a JSON object with a "channels" array, or a JSON array of channels.'
          )
          return
        }
        setChannelsDialog({
          kind: 'import',
          data: { channels: result.channels, activeChannelId: result.activeChannelId },
        })
      } catch (err) {
        setChannelsNotice(err instanceof SyntaxError ? 'Invalid JSON file.' : (err as Error).message)
      }
    },
    [isGuideDemo]
  )

  /** Clear all channels, legacy history, and global DJ settings; leave one empty channel. */
  const performResetAllChannels = useCallback(async () => {
    if (isGuideDemo) return
    if (channelSwitchingRef.current) return
    setChannelsDialog(null)
    channelSwitchingRef.current = true
    try {
      if (!isGuideDemo && currentCardRef.current) {
        await fadeOutCurrentPlayback()
        pendingFadeInRef.current = false
        if (playerRef.current) await playerRef.current.setVolume(1)
      }
      try {
        localStorage.removeItem(CHANNELS_STORAGE_KEY)
        localStorage.removeItem(ACTIVE_CHANNEL_KEY)
        localStorage.removeItem(HISTORY_STORAGE_KEY)
        localStorage.removeItem(SETTINGS_STORAGE_KEY)
        localStorage.removeItem('spotifyRateLimitUntil')
      } catch {
        /* ignore */
      }
      setBackoffUntil(null)
      if (backoffTimerRef.current) {
        clearTimeout(backoffTimerRef.current)
        backoffTimerRef.current = null
      }
      const freshChannels = [{
        id: genChannelId(),
        name: 'New Channel',
        isAutoNamed: true,
        cardHistory: [],
        sessionHistory: [],
        profile: '',
        currentCard: null,
        queue: [],
        createdAt: Date.now(),
      }]
      const fresh = freshChannels[0]
      const freshActive = fresh
      saveChannels(freshChannels)
      try {
        localStorage.setItem(ACTIVE_CHANNEL_KEY, freshActive.id)
      } catch {
        /* ignore */
      }
      setChannels(freshChannels)
      channelsRef.current = freshChannels
      loadChannelIntoState(freshActive)
      setSubmittedUris(new Set())
      setError(null)
    } finally {
      channelSwitchingRef.current = false
    }
  }, [isGuideDemo, loadChannelIntoState, fadeOutCurrentPlayback])

  // Restore backoff timer from localStorage on mount
  useEffect(() => {
    if (isGuideDemo) return
    if (backoffUntil && backoffUntil > Date.now()) {
      const remaining = backoffUntil - Date.now()
      backoffTimerRef.current = setTimeout(() => {
        setBackoffUntil(null)
        setError(null)
        try { localStorage.removeItem('spotifyRateLimitUntil') } catch {}
      }, remaining)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  useEffect(() => {
    sourceRef.current = source
  }, [source])

  /** Test mode: show a DJ suggestion immediately when switching to YouTube (no genre click required). */
  useEffect(() => {
    if (isGuideDemo) return
    if (!youtubeResolveTestActive) return
    if (source !== 'youtube') return
    if (!historyReady) return
    if (suggestionBufferRef.current.length > 0) return
    const fixture = getYoutubeResolveTestFixtureSuggestion()
    suggestionBufferRef.current = [fixture]
    setSuggestionBuffer([fixture])
  }, [source, youtubeResolveTestActive, historyReady, isGuideDemo])

  useEffect(() => {
    genresRef.current = genres
  }, [genres])

  useEffect(() => {
    regionsRef.current = regions
  }, [regions])

  useEffect(() => {
    genreTextRef.current = genreText
  }, [genreText])

  useEffect(() => {
    artistsRef.current = artists
  }, [artists])

  useEffect(() => {
    artistTextRef.current = artistText
  }, [artistText])

  useEffect(() => {
    timePeriodRef.current = timePeriod
  }, [timePeriod])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    popularityRef.current = popularity
  }, [popularity])

  useEffect(() => {
    exploreModeRef.current = discovery
  }, [discovery])

  // Persist settings to localStorage whenever they change
  useEffect(() => {
    if (isGuideDemo) return
    if (!settingsHydrated) return
    try {
      const s: SavedSettings = {
        genres,
        genreText,
        timePeriod,
        notes,
        regions,
        artists,
        artistText,
        popularity,
        provider,
        discovery,
        source,
      }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s))
    } catch {}
  }, [
    genres,
    genreText,
    timePeriod,
    notes,
    regions,
    artists,
    artistText,
    popularity,
    provider,
    discovery,
    source,
    isGuideDemo,
    settingsHydrated,
  ])

  // Load settings from localStorage after mount (safe: avoids SSR/client hydration mismatch)
  useEffect(() => {
    if (isGuideDemo) {
      setSettingsHydrated(true)
      return
    }
    const s = loadSettings()
    skipNextDirtyRef.current = true
    setNotes(s.notes ?? '')
    setGenres(s.genres ?? [])
    setGenreText(s.genreText ?? '')
    setRegions(s.regions ?? [])
    setArtists(s.artists ?? [])
    setArtistText(s.artistText ?? '')
    setTimePeriod(s.timePeriod ?? '')
    setPopularity(s.popularity ?? 50)
    setDiscovery(s.discovery ?? 50)
    setProvider(s.provider ?? 'deepseek')
    setSource(youtubeOnly ? 'youtube' : (s.source ?? DEFAULT_PLAYBACK_SOURCE))
    setCommittedSettings({
      notes: s.notes ?? '',
      genreText: s.genreText ?? '',
      timePeriod: s.timePeriod ?? '',
      genres: s.genres ?? [],
      regions: s.regions ?? [],
      artists: s.artists ?? [],
      artistText: s.artistText ?? '',
      popularity: s.popularity ?? 50,
      discovery: s.discovery ?? 50,
    })
    try {
      const stored = localStorage.getItem('spotifyRateLimitUntil')
      if (stored) {
        const until = Number(stored)
        if (until > Date.now()) setBackoffUntil(until)
      }
    } catch {}
    setSettingsHydrated(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mark settings dirty after initial load
  useEffect(() => {
    if (!settingsInitRef.current) { settingsInitRef.current = true; return }
    if (skipNextDirtyRef.current) { skipNextDirtyRef.current = false; return }
    setSettingsDirty(true)
  }, [notes, genreText, timePeriod, genres, regions, artists, artistText, popularity, discovery])

  // Proactively refresh Spotify token on mount so LLM-resolve calls don't use an expired initial token
  useEffect(() => {
    if (isGuideDemo) return
    if (youtubeOnly) return
    fetch('/api/spotify/token', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.accessToken) accessTokenRef.current = d.accessToken })
      .catch(() => {})
  }, [isGuideDemo])

  // Fetch Spotify user info once on mount
  useEffect(() => {
    if (isGuideDemo) return
    if (youtubeOnly) return
    let canceled = false
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/spotify/me')
        if (!res.ok) throw new Error(`me failed ${res.status}`)
        const data = await res.json()
        if (!canceled && data.ok) {
          setSpotifyUser(data.user)
        }
      } catch (err) {
        if (!canceled) {
          console.error('failed to fetch Spotify user', err)
        }
      }
    }
    fetchUser()
    return () => { canceled = true }
  }, [isGuideDemo])

  // ── Load channels and history from localStorage ──────────────────────────
  useEffect(() => {
    if (isGuideDemo) return
    if (typeof window === 'undefined') return
    let chs = loadChannels()
    let activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY) ?? ''

    const demoLoadedKey = youtubeOnly ? YT_DEMO_LOADED_KEY : DEMO_LOADED_KEY
    const demoAlreadyLoaded = Boolean(localStorage.getItem(demoLoadedKey))
    const demoImport = youtubeOnly ? YOUTUBE_DEMO_CHANNEL_IMPORT : DEMO_CHANNEL_IMPORT

    // Treat a single blank auto-named channel (from old reset) the same as no channels,
    // but only on true first launch (not after a reset).
    const isBlankSlate =
      !demoAlreadyLoaded &&
      chs.length === 1 &&
      chs[0].isAutoNamed &&
      !chs[0].profile &&
      !chs[0].currentCard &&
      (chs[0].queue?.length ?? 0) === 0 &&
      (chs[0].cardHistory?.length ?? 0) === 0

    // Migrate legacy earprint-history into a default channel, or load demo on first launch
    if (chs.length === 0 || isBlankSlate) {
      let legacyHistory: HistoryEntry[] = []
      try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
        if (raw) legacyHistory = JSON.parse(raw)
      } catch {}

      if (legacyHistory.length > 0) {
        // Existing user with old history format — migrate into a channel
        const id = genChannelId()
        const name = deriveChannelName(legacyHistory, '') || 'My Music'
        const events = legacyHistory.map(({ track, artist, percentListened, reaction, coords }) => ({ track, artist, percentListened, reaction, coords }))
        const ch: Channel = { id, name, isAutoNamed: true, cardHistory: legacyHistory, sessionHistory: events, profile: '', currentCard: null, queue: [], createdAt: Date.now() }
        chs = [ch]
        activeId = id
      } else if (!demoAlreadyLoaded) {
        // Brand new user — load the mode-appropriate demo channel once
        const result = parseChannelsImport(demoImport)
        if (result) {
          chs = result.channels
          activeId = result.activeChannelId ?? chs[0].id
          localStorage.setItem(demoLoadedKey, '1')
        } else {
          const id = genChannelId()
          const ch: Channel = { id, name: 'My Music', isAutoNamed: true, cardHistory: [], sessionHistory: [], profile: '', currentCard: null, queue: [], createdAt: Date.now() }
          chs = [ch]
          activeId = id
        }
      } else {
        // Post-reset: demo already shown before, start blank
        const id = genChannelId()
        const ch: Channel = { id, name: 'My Music', isAutoNamed: true, cardHistory: [], sessionHistory: [], profile: '', currentCard: null, queue: [], createdAt: Date.now() }
        chs = [ch]
        activeId = id
      }
      saveChannels(chs)
      localStorage.setItem(ACTIVE_CHANNEL_KEY, activeId)
    }

    if (!activeId || !chs.find(c => c.id === activeId)) {
      activeId = chs[0].id
      localStorage.setItem(ACTIVE_CHANNEL_KEY, activeId)
    }

    const active = chs.find(c => c.id === activeId)!
    try {
      const deduped = dedupeHistory(active.cardHistory)
      setCardHistory(deduped)
      cardHistoryRef.current = deduped
      setSessionHistory(active.sessionHistory)
      sessionHistoryRef.current = active.sessionHistory
      const restoredQueue = [...(active.queue ?? [])]
      const restoredCurrent = active.currentCard ?? null
      const nextCurrent = restoredCurrent ?? restoredQueue.shift() ?? null
      setCurrentCard(nextCurrent)
      currentCardRef.current = nextCurrent
      setQueue(restoredQueue)
      queueRef.current = restoredQueue
      if (active.profile) {
        setPriorProfile(active.profile)
        priorProfileRef.current = active.profile
        setProfile(active.profile)
      }
      // Restore channel settings if present
      if (active.genres) { setGenres(active.genres); genresRef.current = active.genres }
      if (active.genreText !== undefined) { setGenreText(active.genreText); genreTextRef.current = active.genreText }
      if (active.timePeriod !== undefined) { setTimePeriod(active.timePeriod); timePeriodRef.current = active.timePeriod }
      if (active.notes !== undefined) { setNotes(active.notes); notesRef.current = active.notes }
      if (active.regions) { setRegions(active.regions); regionsRef.current = active.regions }
      if (active.artists) { setArtists(active.artists); artistsRef.current = active.artists }
      if (active.artistText !== undefined) { setArtistText(active.artistText); artistTextRef.current = active.artistText }
      if (active.popularity !== undefined) { setPopularity(active.popularity); popularityRef.current = active.popularity }
      if (active.discovery !== undefined) { setDiscovery(active.discovery); exploreModeRef.current = active.discovery }

      if (
        nextCurrent &&
        active.playbackTrackUri === nextCurrent.track.uri &&
        typeof active.playbackPositionMs === 'number' &&
        active.playbackPositionMs > 0
      ) {
        pendingPlaybackPositionMsRef.current = clampPlaybackOffsetMs(
          active.playbackPositionMs,
          nextCurrent.track.durationMs
        )
      } else {
        pendingPlaybackPositionMsRef.current = undefined
      }
    } catch {}

    setChannels(chs)
    channelsRef.current = chs
    setActiveChannelId(activeId)
    activeChannelIdRef.current = activeId
    setHistoryReady(true)
  }, [dedupeHistory, isGuideDemo])

  // ── Persist active channel data on change (same snapshot as channel switch — includes DJ settings) ──
  useEffect(() => {
    if (isGuideDemo) return
    if (!activeChannelId || typeof window === 'undefined') return
    if (!settingsHydrated || !historyReady) return
    const updated = snapshotCurrentChannel()
    channelsRef.current = updated
    saveChannels(updated)
    setChannels(updated)
  }, [
    cardHistory,
    profile,
    activeChannelId,
    currentCard,
    queue,
    genres,
    genreText,
    timePeriod,
    notes,
    regions,
    artists,
    artistText,
    popularity,
    discovery,
    isGuideDemo,
    settingsHydrated,
    historyReady,
    snapshotCurrentChannel,
  ])

  // ── Spotify SDK ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (isGuideDemo) return
    if (youtubeOnly) return
    if (sdkReadyRef.current) return
    sdkReadyRef.current = true

    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: 'Earprint',
        getOAuthToken: cb => {
          fetch('/api/spotify/token', { credentials: 'same-origin', cache: 'no-store' })
            .then(async r => {
              if (r.status === 401) {
                forceSpotifyLoginRedirectRef.current(`token HTTP ${r.status}`)
                return
              }
              if (!r.ok) {
                console.warn('Spotify token: transient HTTP error', r.status)
                setError(
                  'Could not reach Spotify right now. Your session is still here; try again in a moment.',
                )
                const fallback = accessTokenRef.current
                if (fallback) cb(fallback)
                return
              }
              const d = (await r.json()) as { accessToken?: string }
              if (d.accessToken) {
                clearSpotifyAuthRedirectLoop()
                accessTokenRef.current = d.accessToken
                cb(d.accessToken)
              } else {
                forceSpotifyLoginRedirectRef.current('token response missing accessToken')
              }
            })
            .catch(err => {
              console.warn('Spotify token: fetch failed', err)
              setError(
                'Could not reach Spotify right now. Your session is still here; try again in a moment.',
              )
              const fallback = accessTokenRef.current
              if (fallback) cb(fallback)
            })
        },
        volume: 0.8,
      })
      playerRef.current = p

      p.addListener('ready', (s: unknown) => {
        setDeviceId((s as { device_id: string }).device_id)
        deviceIdRef.current = (s as { device_id: string }).device_id
      })
      p.addListener('player_state_changed', (s: unknown) => {
        if (s) {
          const state = s as SpotifyPlaybackState
          setPlaybackState(state)

          // Detect natural track end in the background.
          // When a track ends, the SDK fires paused=true, position=0 for the same track.
          // The local 250ms timer is frozen by the browser when backgrounded, so this is
          // the only reliable signal for auto-advance while the app is not visible.
          if (
            state.paused &&
            state.position === 0 &&
            !autoAdvanceRef.current &&
            Date.now() - trackPlayStartAtRef.current > 8_000
          ) {
            console.info('player_state_changed: track-end detected (background), advancing')
            autoAdvanceRef.current = true
            advanceRef.current?.(true)
          }
        } else {
          // null = SDK lost the active device (another device took over, or SDK disconnected).
          // Mark paused so the local timer stops and the UI reflects reality.
          isPausedRef.current = true
          setPlaybackState(prev => prev ? { ...prev, paused: true } : null)
          console.info('player_state_changed: null — device lost, marking paused')
        }
      })
      p.addListener('initialization_error', () => {
        console.error('Spotify SDK: initialization_error')
        setError('Spotify player failed to initialize.')
      })
      p.addListener('authentication_error', () => {
        console.error('Spotify SDK: authentication_error — redirecting to login')
        playerRef.current?.disconnect()
        redirectToSpotifyLoginRef.current('sdk authentication_error')
      })

      p.connect()
    }

    if (!document.getElementById('spotify-sdk')) {
      const script = document.createElement('script')
      script.id = 'spotify-sdk'
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      document.body.appendChild(script)
    }
  }, [isGuideDemo])

  // ── YouTube progress poll — reads position/duration from YT IFrame API ──────
  const autoAdvanceRef = useRef(false)
  useEffect(() => {
    if (isGuideDemo) return
    if ((currentCard?.track.source as string | undefined) !== 'youtube') return
    const TICK = 250
    const interval = setInterval(() => {
      const ytRef = youtubePlayerRef.current
      if (!ytRef || !currentCardRef.current) return
      const currentTimeSec = ytRef.getCurrentTime()
      const durationSec = ytRef.getDuration()
      if (durationSec > 0) { durationRef.current = durationSec * 1000; setYoutubeDuration(durationSec * 1000) }
      if (currentTimeSec >= 0) {
        sliderRef.current = currentTimeSec * 1000
        setSliderPosition(currentTimeSec * 1000)
      }
      const endThreshold = Math.max(1000, durationRef.current * 0.98)
      if (durationRef.current > 0 && sliderRef.current >= endThreshold) {
        if (!autoAdvanceRef.current) {
          autoAdvanceRef.current = true
          advanceRef.current?.(true)
        }
      } else if (sliderRef.current < endThreshold - 1000) {
        autoAdvanceRef.current = false
      }
    }, TICK)
    return () => clearInterval(interval)
  }, [currentCard, isGuideDemo])

  // ── Local progress animation (no Spotify API calls) ──────────────────────
  useEffect(() => {
    if (isGuideDemo) return
    if (!deviceId) return
    const TICK = 250
    pollRef.current = setInterval(() => {
      if (isPausedRef.current || isSeekingRef.current || !currentCardRef.current) return
      const next = Math.min(sliderRef.current + TICK, durationRef.current)
      sliderRef.current = next
      setSliderPosition(next)
      const endThreshold = Math.max(1000, durationRef.current * 0.98)
      if (next >= endThreshold) {
        if (!autoAdvanceRef.current) {
          autoAdvanceRef.current = true
          advanceRef.current?.(true)
        }
      } else if (next < endThreshold - 1000) {
        autoAdvanceRef.current = false
      }
    }, TICK)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [deviceId, isGuideDemo])

  useEffect(() => {
    if (!playbackState || isSeekingRef.current) return
    const sdkTrackId = playbackState.track_window?.current_track?.id
    const cur = currentCardRef.current
    if (cur && sdkTrackId && (cur.track.source as string) !== 'youtube') {
      const curId = normalizeSpotifyTrackId(cur.track.id)
      if (curId && sdkTrackId !== curId) return
    }
    const sdkDur = playbackState.duration
    const trackDur = cur?.track.durationMs ?? 0
    // Web Playback SDK often reports duration 0 until the track is ready; use track metadata so the timer can run.
    const dur = sdkDur > 0 ? sdkDur : trackDur > 0 ? trackDur : sdkDur
    durationRef.current = dur
    isPausedRef.current = playbackState.paused
    setSliderPosition(playbackState.position)
    sliderRef.current = playbackState.position
  }, [playbackState])

  // Reclaim playback device when Spotify steals it (e.g. user opened a Spotify tab)
  const lastReclaimRef = useRef(0)
  const wasPlayingRef = useRef(false)
  const openedSpotifyRef = useRef(false)
  useEffect(() => {
    if (isGuideDemo) return
    const handleVisibility = () => {
      if (document.hidden) {
        wasPlayingRef.current = !isPausedRef.current
        return
      }
      const dId = deviceIdRef.current
      const player = playerRef.current
      if (!dId) return
      const forceReclaim = openedSpotifyRef.current
      openedSpotifyRef.current = false
      if (!wasPlayingRef.current && !forceReclaim) return
      const now = Date.now()
      if (!forceReclaim && now - lastReclaimRef.current < 10_000) return

      // Use SDK getCurrentState() (local, no quota) to get ground truth before deciding to reclaim.
      const check = player ? player.getCurrentState() : Promise.resolve(null)
      check.then((state: unknown) => {
        const sdkState = state as SpotifyPlaybackState | null
        if (sdkState) {
          // SDK is active — sync local state in case it drifted while tab was hidden.
          isPausedRef.current = sdkState.paused
          setPlaybackState(sdkState)
          if (!sdkState.paused) return // already playing, nothing to do
        }
        // SDK null or paused — reclaim and resume.
        lastReclaimRef.current = Date.now()
        console.info('visibilitychange: reclaiming device', dId, { forceReclaim, sdkState: sdkState ? 'paused' : 'null' })
        fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessTokenRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [dId], play: true }),
        }).catch(() => {})
      }).catch(() => {
        // getCurrentState failed — fall back to unconditional reclaim
        lastReclaimRef.current = Date.now()
        fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessTokenRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [dId], play: true }),
        }).catch(() => {})
      })
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isGuideDemo])

  useEffect(() => {
    return () => {
      if (backoffTimerRef.current) {
        clearTimeout(backoffTimerRef.current)
      }
    }
  }, [])

  // ── Play a track ──────────────────────────────────────────────────────────
  const playTrack = useCallback(async (uri: string, positionMs?: number) => {
    if (isGuideDemo) return
    const dId = deviceIdRef.current
    if (!dId) return
    const body =
      typeof positionMs === 'number' && positionMs > 0
        ? { uris: [uri], position_ms: Math.floor(positionMs) }
        : { uris: [uri] }
    const doPlay = async (token: string) =>
      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${dId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    let res = await doPlay(accessTokenRef.current)
    if (res.status === 401) {
      // Token stale — refresh and retry once
      const data = await fetch('/api/spotify/token').then(r => r.json()).catch(() => ({}))
      if (data.accessToken) {
        accessTokenRef.current = data.accessToken
        res = await doPlay(data.accessToken)
      }
    }
    if (res.status === 404) {
      // Device not yet registered on Spotify's backend — retry after a short delay
      console.warn('playTrack: device not found (404), retrying in 1s…')
      await new Promise(r => setTimeout(r, 1000))
      res = await doPlay(accessTokenRef.current)
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      const msg = `playTrack failed: HTTP ${res.status}${errBody ? ' — ' + errBody.slice(0, 120) : ''}`
      console.warn(msg, uri)
      setPlayResponse(msg)
    } else {
      setPlayResponse(null)
      const card = currentCardRef.current
      if (card?.track.uri === uri && (card.track.source as string) !== 'youtube') {
        const dm = card.track.durationMs
        if (Number.isFinite(dm) && dm > 0) {
          durationRef.current = dm
        }
        const startMs = typeof positionMs === 'number' && positionMs > 0 ? positionMs : 0
        sliderRef.current = startMs
        setSliderPosition(startMs)
        // SDK may delay player_state_changed; allow local progress until it arrives.
        isPausedRef.current = false
        trackPlayStartAtRef.current = Date.now()
      }
    }
  }, [isGuideDemo])

  const togglePlayback = useCallback(() => {
    if (isGuideDemo) {
      setPlaybackState(prev => {
        if (!prev) return prev
        const paused = !prev.paused
        isPausedRef.current = paused
        return { ...prev, paused }
      })
      return
    }
    if (playbackState?.paused) playerRef.current?.resume()
    else playerRef.current?.pause()
  }, [isGuideDemo, playbackState])

  // Play when currentCard changes
  useEffect(() => {
    if (isGuideDemo) return
    if (!currentCard) return
    if (!deviceId) return
    const key = trackPlayKey(currentCard.track)
    if (key === lastPlayedUriRef.current) return
    lastPlayedUriRef.current = key
    playedUrisRef.current.add(key)
    const resumeMs = pendingPlaybackPositionMsRef.current
    pendingPlaybackPositionMsRef.current = undefined
    // YouTube playback handled by the YouTube iframe — reset slider and skip Spotify playTrack
    if ((currentCard.track.source as string) === 'youtube') {
      sliderRef.current = 0
      setSliderPosition(0)
      durationRef.current = 0
      setYoutubeDuration(0)
      autoAdvanceRef.current = false
      return
    }
    const doPlay = async () => {
      const player = playerRef.current
      if (pendingFadeInRef.current && player) {
        pendingFadeInRef.current = false
        await player.setVolume(0)
        await player.pause()
        await playTrack(currentCard.track.uri, resumeMs)
        await fadeVolume(player, 0, 1)
      } else {
        await playTrack(currentCard.track.uri, resumeMs)
      }
    }
    doPlay().catch(err => {
      console.error('[play] doPlay failed, retrying once', err)
      pendingFadeInRef.current = false
      playTrack(currentCard.track.uri, resumeMs).catch(e =>
        console.error('[play] retry also failed', e)
      )
    })
  }, [
    currentCard?.track.uri ?? currentCard?.track.id,
    deviceId,
    isGuideDemo,
    playGeneration,
  ])

  // Reset grade slider and rated flag when song changes
  useEffect(() => {
    setGradePercent(0)
    gradeRef.current = 0
    setGradeTracking(true)
    setHasRated(false)
    hasRatedRef.current = false
  }, [currentCard?.track.uri ?? currentCard?.track.id])

  // While tracking, sync grade slider to play position
  useEffect(() => {
    if (!gradeTracking || hasRated) return
    const dur = (currentCard?.track.source as string) === 'youtube'
      ? youtubeDuration
      : durationRef.current
    if (dur <= 0) return
    const pct = Math.min(100, (sliderPosition / dur) * 100)
    setGradePercent(pct)
    gradeRef.current = pct
  }, [sliderPosition, gradeTracking, hasRated, youtubeDuration, currentCard?.track.source])

  // Seed duration from Spotify track metadata before the Web Playback SDK reports duration (often 0).
  useEffect(() => {
    if (!currentCard) return
    if ((currentCard.track.source as string) === 'youtube') return
    const dm = currentCard.track.durationMs
    if (Number.isFinite(dm) && dm > 0) {
      durationRef.current = dm
    }
  }, [currentCard?.track.uri ?? currentCard?.track.id])

  // ── LLM batch: suggestions only (no Spotify) ─────────────────────────────
  const fetchSuggestions = useCallback(
    async (
      sessionHist: ListenEvent[],
      profile: string,
      artistConstraint?: string,
      forceTextSearch?: boolean,
      numSongs?: number
    ): Promise<{ suggestions: SongSuggestion[]; profile?: string; suggestedArtists: string[] }> => {
      if (youtubeResolveTestActive) {
        console.info(
          DJQ,
          'fetchSuggestions: YOUTUBE_RESOLVE_TEST — skipping LLM; one fixture suggestion only'
        )
        return {
          suggestions: [getYoutubeResolveTestFixtureSuggestion()],
          profile: undefined,
          suggestedArtists: [],
        }
      }
      const cur = currentCardRef.current
      const alreadyHeard = [
        ...(cur ? [`${cur.track.name} by ${cur.track.artist}`] : []),
        ...cardHistoryRef.current.map(e => `${e.track} by ${e.artist}`),
        ...queueRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
        ...suggestionBufferRef.current.map(s => s.search),
      ]
      const alreadyHeardDeduped = [...new Set(alreadyHeard.map(s => s.trim()).filter(Boolean))]
      const payload: Record<string, unknown> = {
        sessionHistory: sessionHist,
        priorProfile: profile || undefined,
        provider: providerRef.current,
        artistConstraint,
        notes: buildCombinedNotes(
          genresRef.current,
          genreTextRef.current,
          timePeriodRef.current,
          notesRef.current,
          popularityRef.current,
          regionsRef.current,
          artistsRef.current,
          artistTextRef.current
        ),
        alreadyHeard: alreadyHeardDeduped.length > 0 ? alreadyHeardDeduped : undefined,
        mode: exploreModeRef.current,
        numSongs,
        profileOnly: true,
      }
      if (forceTextSearch) {
        payload.forceTextSearch = true
      }

      const res = await fetch('/api/next-song', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          accessToken: accessTokenRef.current,
          source: sourceRef.current ?? DEFAULT_PLAYBACK_SOURCE,
          youtubeResolveTest: youtubeResolveTestActive,
        }),
      })

      if (res.status === 429) {
        const errBody = await res.json().catch(() => null)
        const payloadRetry =
          errBody && typeof errBody.retryAfterMs === 'number' ? errBody.retryAfterMs : undefined
        throw new RateLimitError(payloadRetry ?? RATE_LIMIT_DEFAULT_WAIT_MS)
      }
      if (res.status === 401) {
        throw new AuthError()
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`fetch failed: ${res.status}${text ? ` ${text}` : ''}`)
      }

      const data = await res.json()
      const suggestions: SongSuggestion[] = (data.songs ?? []).map(
        (s: SongSuggestion) => ({
          search: s.search,
          reason: s.reason,
          category: s.category,
          spotifyId: s.spotifyId,
          youtubeVideoId: s.youtubeVideoId,
          coords: s.coords,
          composed: s.composed,
          performer: s.performer,
        })
      )
      console.info('fetchSuggestions LLM batch', suggestions.length, suggestions.map(s => s.search))
      console.info('fetchSuggestions profile field:', data.profile ? data.profile.slice(0, 80) + '…' : '(none)')
      const suggestedArtistsRaw = data.suggestedArtists
      const suggestedArtists = Array.isArray(suggestedArtistsRaw)
        ? suggestedArtistsRaw
            .filter((x: unknown): x is string => typeof x === 'string')
            .map((x: string) => x.trim())
            .filter(Boolean)
        : []
      return { suggestions, profile: data.profile, suggestedArtists }
    },
    [youtubeResolveTestActive]
  )

  /** Single Spotify search when a suggestion is promoted to Up Next / now playing. */
  const resolveOneSuggestion = useCallback(async (s: SongSuggestion): Promise<CardState | null> => {
    // Do not preflight on client backoff — stale localStorage spotifyRateLimitUntil can block all
    // resolves while LLM (profileOnly) still works. Rely on HTTP 429 to set backoff.
    const ytResolveTest =
      youtubeResolveTestActive &&
      (sourceRef.current === 'youtube' || isYoutubeResolveTestFixtureSuggestion(s))
    const resolveUrl = ytResolveTest ? '/api/youtube-resolve-test' : '/api/next-song'
    if (ytResolveTest) {
      console.info(DJQ, 'resolveOneSuggestion: using /api/youtube-resolve-test (fixture, no search quota)')
    }
    const res = await fetch(resolveUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songsToResolve: [s],
        sessionHistory: sessionHistoryRef.current,
        accessToken: accessTokenRef.current,
        // Prefer GET /v1/tracks?ids= when LLM supplies an id (not Search); fall back to search if no id or lookup fails.
        forceTextSearch: !normalizeSpotifyTrackId(s.spotifyId),
        source: sourceRef.current ?? DEFAULT_PLAYBACK_SOURCE,
        youtubeResolveTest: youtubeResolveTestActive,
      }),
    })

    if (res.status === 429) {
      const errBody = await res.json().catch(() => null)
      const payloadRetry =
        errBody && typeof errBody.retryAfterMs === 'number' ? errBody.retryAfterMs : undefined
      console.warn(DJQ, 'resolveOneSuggestion: HTTP 429', s.search.slice(0, 48), errBody)
      recordFetch(1)
      throw new RateLimitError(payloadRetry ?? RATE_LIMIT_DEFAULT_WAIT_MS)
    }
    if (res.status === 401) {
      console.warn(DJQ, 'resolveOneSuggestion: HTTP 401', s.search.slice(0, 48))
      throw new AuthError()
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(DJQ, 'resolveOneSuggestion: HTTP', res.status, s.search.slice(0, 48), errText.slice(0, 120))
      recordFetch(1)
      return null
    }

    const data = await res.json()
    if (typeof data.ytSearchesRemaining === 'number') {
      setYtSearchesRemaining(data.ytSearchesRemaining)
    }
    const songs = data.songs as
      | { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number }; composed?: number; performer?: string }[]
      | undefined
    resolveStatsRef.current.attempts++
    if (!songs?.length) {
      console.warn(DJQ, 'resolveOneSuggestion: empty songs[] in response', s.search.slice(0, 48))
      const { attempts, successes } = resolveStatsRef.current
      console.info(DJQ, `resolve stats: ${successes}/${attempts} (${Math.round(successes/attempts*100)}%)`)
      recordFetch(1)
      return null
    }
    resolveStatsRef.current.successes++
    recordFetch(1)
    const t = songs[0]
    const { attempts, successes } = resolveStatsRef.current
    console.info(DJQ, 'resolveOneSuggestion: ok', t.track.name, '—', t.track.artist,
      `| resolve rate: ${successes}/${attempts} (${Math.round(successes/attempts*100)}%)`)
    return {
      track: t.track,
      reason: t.reason,
      category: t.category,
      coords: t.coords,
      composed: t.composed,
      performer: t.performer,
    }
  }, [youtubeResolveTestActive])

  /** Resolve up to `max` suggestions in order (constraint / replace flows). Skips failed lookups. */
  const resolveSuggestionsToCards = useCallback(
    async (list: SongSuggestion[], max: number): Promise<CardState[]> => {
      const out: CardState[] = []
      const seenUris = new Set<string>()
      const excludeUris = new Set<string>([
        ...playedUrisRef.current,
        ...(currentCardRef.current ? [currentCardRef.current.track.uri] : []),
        ...queueRef.current.map(c => c.track.uri),
      ])
      for (const s of list) {
        if (out.length >= max) break
        try {
          const card = await resolveOneSuggestion(s)
          if (!card) continue
          const u = card.track.uri
          if (excludeUris.has(u) || seenUris.has(u)) continue
          seenUris.add(u)
          excludeUris.add(u)
          out.push(card)
        } catch (e) {
          if (e instanceof RateLimitError || e instanceof AuthError) throw e
        }
      }
      return out
    },
    [resolveOneSuggestion]
  )

  /** No Spotify search — rebuild cards from Heard when API is rate-limited. */
  const fillFromHeardWhenRateLimited = useCallback(() => {
    if (isGuideDemo) return
    if (sourceRef.current === 'youtube') return
    // Never fill from Heard while DJ rows are still pending — Spotify backoff skips `consume`, but
    // Heard must not jump ahead of the suggestion buffer (auto-fill used to run Heard first every tick).
    if (suggestionBufferRef.current.length > 0) {
      console.info(DJQ, 'fillFromHeard: skipping — DJ suggestions pending (resolve when rate limit clears)')
      return
    }

    const ranked = [...cardHistoryRef.current]
      .filter(e => isPositiveHeard(e))
      .map(e => ({ entry: e, track: historyEntryToTrack(e) }))
      .filter((x): x is { entry: HistoryEntry; track: SpotifyTrack } => x.track !== null)
      .sort((a, b) => b.entry.percentListened - a.entry.percentListened)

    const seen = new Set<string>([
      ...playedUrisRef.current,
      ...(currentCardRef.current ? [currentCardRef.current.track.uri] : []),
      ...queueRef.current.map(c => c.track.uri),
    ])

    const candidates = ranked.filter(({ track }) => !seen.has(track.uri))

    if (!currentCardRef.current && candidates.length > 0) {
      const { entry, track } = candidates[0]
      const card: CardState = {
        track,
        reason: HEARD_RATE_LIMIT_REASON,
        category: entry.category,
        coords: entry.coords,
      }
      lastPlayedUriRef.current = null
      currentCardRef.current = card
      setCurrentCard(card)
      seen.add(track.uri)
      candidates.shift()
    }

    const newQ = [...queueRef.current]
    for (const { entry, track } of candidates) {
      if (newQ.length >= 3) break
      if (seen.has(track.uri)) continue
      seen.add(track.uri)
      newQ.push({
        track,
        reason: HEARD_RATE_LIMIT_REASON,
        category: entry.category,
        coords: entry.coords,
      })
    }

    if (
      newQ.length !== queueRef.current.length ||
      newQ.some((c, i) => c.track.uri !== queueRef.current[i]?.track.uri)
    ) {
      queueRef.current = newQ
      setQueue(newQ)
    }
  }, [isGuideDemo])

  // ── Profile-only fetch on rating: updates profile + merges suggestions into buffer ──
  const fetchProfileOnly = useCallback(() => {
    if (
      playerConfigDj === null &&
      !youtubeResolveTestFromServer &&
      !isYoutubeResolveTestClientEnabled()
    ) {
      return
    }
    if (youtubeResolveTestActive) {
      console.info(DJQ, 'fetchProfileOnly: skipped (YOUTUBE_RESOLVE_TEST — no LLM)')
      return
    }
    // Do not call the LLM while DJ suggestions exist — burn those first (same rule as fetchToBuffer).
    if (suggestionBufferRef.current.length > 0) {
      console.info(DJQ, 'fetchProfileOnly: skipping (pending suggestions — no LLM until buffer used)', {
        bufferLen: suggestionBufferRef.current.length,
      })
      return
    }
    if (fetchingRef.current) {
      console.info(DJQ, 'fetchProfileOnly: skipping (LLM request already in flight)')
      return
    }
    const gen = ++profileGenRef.current
    fetchingRef.current = true
    const payload: Record<string, unknown> = {
      sessionHistory: sessionHistoryRef.current,
      priorProfile: priorProfileRef.current || undefined,
      provider: providerRef.current,
      notes: buildCombinedNotes(
        genresRef.current,
        genreTextRef.current,
        timePeriodRef.current,
        notesRef.current,
        popularityRef.current,
        regionsRef.current,
        artistsRef.current,
        artistTextRef.current
      ),
      alreadyHeard: (() => {
        const cur = currentCardRef.current
        const list = [
          ...(cur ? [`${cur.track.name} by ${cur.track.artist}`] : []),
          ...cardHistoryRef.current.map(e => `${e.track} by ${e.artist}`),
          ...queueRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
          ...suggestionBufferRef.current.map(s => s.search),
        ]
        return [...new Set(list.map(s => s.trim()).filter(Boolean))]
      })(),
      mode: exploreModeRef.current,
      profileOnly: true,
      accessToken: accessTokenRef.current,
      source: sourceRef.current ?? DEFAULT_PLAYBACK_SOURCE,
      youtubeResolveTest: youtubeResolveTestActive,
    }
    fetch('/api/next-song', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || gen !== profileGenRef.current) return
        if (data.profile) {
          setPriorProfile(data.profile)
          priorProfileRef.current = data.profile
          setProfile(data.profile)
        }
        if (Array.isArray(data.suggestedArtists) && data.suggestedArtists.length > 0) {
          const sa = data.suggestedArtists
            .filter((x: unknown): x is string => typeof x === 'string')
            .map((x: string) => x.trim())
            .filter(Boolean)
          if (sa.length > 0) setLlmSuggestedArtists(sa)
        }
        if (Array.isArray(data.songs) && data.songs.length > 0) {
          const incoming = data.songs as SongSuggestion[]
          setSuggestionBuffer(prev => {
            const seen = new Set(prev.map(p => p.search))
            const merged = [...prev]
            for (const s of incoming) {
              if (seen.has(s.search)) continue
              merged.push({
                search: s.search,
                reason: s.reason,
                category: s.category,
                spotifyId: s.spotifyId,
                youtubeVideoId: s.youtubeVideoId,
                coords: s.coords,
                composed: s.composed,
                performer: s.performer,
              })
              seen.add(s.search)
            }
            suggestionBufferRef.current = merged
            return merged
          })
          if (suggestionBufferRef.current.length > 0) {
            console.info(DJQ, 'fetchProfileOnly: invoking consume', suggestionBufferRef.current.length)
            void consumeDjSuggestionBufferRef.current?.({ userInitiated: false }).catch(e =>
              console.warn(DJQ, 'fetchProfileOnly: consume rejected', e)
            )
          }
        }
        setSubmittedUris(new Set(cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean)))
      })
      .catch(() => {})
      .finally(() => {
        fetchingRef.current = false
      })
  }, [youtubeResolveTestActive, playerConfigDj, youtubeResolveTestFromServer])

  // ── Fetch from LLM → suggestion buffer (Spotify only when promoting to queue / now playing) ──
  const fetchToBuffer = useCallback(
    (
      artistConstraint?: string,
      forceTextSearch?: boolean,
      onCards?: (cards: CardState[]) => void,
      force = false,
      replaceBuffer = false,
      /** Retry / clear-history: allow LLM with no listen history and no DJ settings. */
      bypassEmptyChannelGate = false
    ) => {
    // Mutex: never stack LLM calls (constraint/retry use force:true but must still respect in-flight).
    if (fetchingRef.current || resolvingRef.current) {
      console.info('fetchToBuffer: skipping, fetch or resolve already in flight')
      return
    }
    // Wait until we know if YOUTUBE_RESOLVE_TEST is on (avoids a real LLM call on first Jazz click).
    if (
      playerConfigDj === null &&
      !youtubeResolveTestFromServer &&
      !isYoutubeResolveTestClientEnabled()
    ) {
      console.info('fetchToBuffer: skipping until /api/player-config (test mode detection)')
      return
    }
    // Never call the LLM when Up Next + DJ buffer are both at target — even constraint debounce / retry.
    if (djInventoryFull(queueRef.current.length, suggestionBufferRef.current.length)) {
      console.info('fetchToBuffer: skipping, queue and suggestions at target', { force })
      return
    }
    if (!force && suggestionBufferRef.current.length > 0) {
      console.info('fetchToBuffer: skipping, buffer non-empty', suggestionBufferRef.current.length)
      return
    }
    // Empty channel: do not call the LLM until the user has chosen at least one DJ setting.
    // Constraint uses force:true — still blocked here unless bypassEmptyChannelGate (retry / clear history).
    if (
      !bypassEmptyChannelGate &&
      shouldDeferLlmUntilDjChoice(
        cardHistoryRef.current.length,
        genresRef.current,
        genreTextRef.current,
        regionsRef.current,
        artistsRef.current,
        artistTextRef.current,
        notesRef.current,
        timePeriodRef.current,
        popularityRef.current,
        exploreModeRef.current
      )
    ) {
      console.info('fetchToBuffer: skipping — no listen history yet and no DJ settings; choose genres, region, notes, or sliders first')
      return
    }
    if (force) {
      djLlmRetryAfterMsRef.current = 0
    }
    // Constraint path resolves LLM suggestions to tracks on Spotify — skip while backoff.
    if (onCards && isSpotifyBackoffActive()) {
      console.info('fetchToBuffer: skipping constraint path, Spotify backoff (needs resolve)')
      return
    }

    const queueTotal = (currentCardRef.current ? 1 : 0) + queueRef.current.length
    const bufferEmpty = suggestionBufferRef.current.length === 0
    // Throttle LLM refetches when we already have enough queued — but always allow when buffer is empty.
    if (!force && queueTotal >= 2 && !bufferEmpty) {
      const sinceLastFetch = Date.now() - lastFetchAtRef.current
      if (sinceLastFetch < FETCH_COOLDOWN_MS) {
        const remaining = FETCH_COOLDOWN_MS - sinceLastFetch
        console.info('fetchToBuffer: skipping, cooldown', Math.round(remaining / 1000), 's remaining')
        if (!cooldownRetryTimerRef.current) {
          cooldownRetryTimerRef.current = setTimeout(() => {
            cooldownRetryTimerRef.current = null
            setCooldownTick(t => t + 1)
          }, remaining)
        }
        return
      }
    }

    // Spotify preflight only when we will resolve suggestions to tracks (onCards path).
    if (onCards) {
      const { log } = readStats()
      const now = Date.now()
      const recent = log.filter(e => e.t >= now - 30_000).reduce((s, e) => s + e.n, 0)
      const threshold = force ? 20 : 15
      if (recent >= threshold) {
        console.info('fetchToBuffer: skipping onCards, approaching Spotify rate limit', recent, '/30s', force ? '(forced)' : '')
        return
      }
    }
    fetchingRef.current = true
    lastFetchAtRef.current = Date.now()
    setSettingsDirty(false)
    setCommittedSettings({
      notes,
      genreText,
      timePeriod,
      genres,
      regions,
      artists,
      artistText,
      popularity,
      discovery,
    })
    const gen = ++fetchGenRef.current
    const coldStart =
      queueRef.current.length === 0 && suggestionBufferRef.current.length === 0
    const numSongs = computeNumSongs(
      queueRef.current.length,
      suggestionBufferRef.current.length,
    )
    console.info('fetchToBuffer: firing', {
      force,
      gen,
      queueLen: queueRef.current.length,
      suggestionLen: suggestionBufferRef.current.length,
      numSongs,
      coldStart,
      resolveRate: Math.round(getResolveSuccessRate() * 100) + '%',
      resolveStats: { ...resolveStatsRef.current },
    })
    const sentHistory = [...sessionHistoryRef.current]
    const sentProfile = priorProfileRef.current
    setLoadingQueue(true)
    fetchSuggestions(sentHistory, sentProfile, artistConstraint, forceTextSearch, numSongs)
      .then(async ({ suggestions, profile: newProfile, suggestedArtists: nextArtists }) => {
        console.info('fetchToBuffer profile update:', newProfile ? 'YES len=' + newProfile.length : 'NO (undefined/empty)')
        if (newProfile) {
          setPriorProfile(newProfile)
          priorProfileRef.current = newProfile
          setProfile(newProfile)
        }
        if (nextArtists.length > 0) setLlmSuggestedArtists(nextArtists)
        setSubmittedUris(new Set(cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean)))

        if (gen !== fetchGenRef.current) return

        const seenSearch = new Set(suggestionBufferRef.current.map(s => s.search))
        const fresh = suggestions.filter(s => {
          if (seenSearch.has(s.search)) return false
          seenSearch.add(s.search)
          return true
        })

        if (onCards) {
          const resolved = await resolveSuggestionsToCards(suggestions, 3)
          onCards(resolved)
          if (replaceBuffer) {
            if (resolved.length > 0) {
              djLlmRetryAfterMsRef.current = 0
              suggestionBufferRef.current = []
              setSuggestionBuffer([])
            } else if (suggestions.length > 0) {
              // Constraint resolve failed — keep LLM rows for DJ / consume. Do not call consume here
              // (auto-fill effect runs once). Back off LLM refetch if consume empties buffer without filling queue.
              suggestionBufferRef.current = suggestions.map(s => ({ ...s }))
              setSuggestionBuffer(suggestionBufferRef.current)
              djLlmRetryAfterMsRef.current = Date.now() + FETCH_COOLDOWN_MS
            }
          }
        } else {
          const merged = replaceBuffer ? fresh : [...suggestionBufferRef.current, ...fresh]
          suggestionBufferRef.current = merged
          setSuggestionBuffer(merged)
          if (merged.length > 0) {
            djLlmRetryAfterMsRef.current = 0
          }
          console.info('fetchToBuffer appended suggestions', fresh.length, 'buffer length', merged.length)
          if (merged.length > 0) {
            console.info(DJQ, 'fetchToBuffer: invoking consume after merge', merged.length)
            try {
              await consumeDjSuggestionBufferRef.current?.({ userInitiated: false })
              console.info(DJQ, 'fetchToBuffer: consume finished (no throw)')
            } catch (e) {
              console.warn(DJQ, 'fetchToBuffer: consume threw', e)
            }
          }
        }

        setSessionHistory(prev => prev.slice(sentHistory.length))
        sessionHistoryRef.current = sessionHistoryRef.current.slice(sentHistory.length)
      })
      .catch(err => {
        if (err instanceof RateLimitError) {
          const waitMs = (err.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS) + 5_000
          const until = Date.now() + waitMs
          setBackoffUntil(until)
          try { localStorage.setItem('spotifyRateLimitUntil', String(until)) } catch {}
          if (backoffTimerRef.current) {
            clearTimeout(backoffTimerRef.current)
          }
          backoffTimerRef.current = setTimeout(() => {
            setBackoffUntil(null)
            setError(null)
            try { localStorage.removeItem('spotifyRateLimitUntil') } catch {}
          }, waitMs)
          setError(`${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate limiting requests. Blocked until ${formatRetryTime(waitMs)}.`)
          fillFromHeardWhenRateLimited()
          return
        }

        if (err instanceof AuthError) {
          setError('Authentication error (401). Access token may be invalid or missing.')
          const far = Date.now() + 300_000
          setBackoffUntil(far)
          return
        }

        if (gen === fetchGenRef.current && !currentCardRef.current && suggestionBufferRef.current.length === 0) {
          setError('Could not load songs — LLM may be unavailable. Will retry.')
        }
        fetchingRef.current = true
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current)
        backoffTimerRef.current = setTimeout(() => {
          fetchingRef.current = false
          setLoadingQueue(false)
          setError(null)
          setCooldownTick(t => t + 1)
        }, RATE_LIMIT_DEFAULT_WAIT_MS)
      })
      .finally(() => {
        if (gen === fetchGenRef.current) {
          fetchingRef.current = false
          setLoadingQueue(false)
        }
      })
  }, [
    fetchSuggestions,
    resolveSuggestionsToCards,
    fillFromHeardWhenRateLimited,
    notes,
    genreText,
    timePeriod,
    genres,
    regions,
    artists,
    artistText,
    popularity,
    discovery,
    playerConfigDj,
    youtubeResolveTestFromServer,
  ])

  /** Pop suggestions and resolve on Spotify one-by-one until we have a track for now playing. */
  const startPlaybackFromSuggestions = useCallback(async () => {
    while (!currentCardRef.current && suggestionBufferRef.current.length > 0) {
      const next = suggestionBufferRef.current[0]
      try {
        const card = await resolveOneSuggestion(next)
        if (!card) {
          console.warn(DJQ, 'startPlaybackFromSuggestions: resolve returned null; dropping row', next.search.slice(0, 48))
          const rest = suggestionBufferRef.current.slice(1)
          suggestionBufferRef.current = rest
          setSuggestionBuffer(rest)
          continue
        }
        const rest = suggestionBufferRef.current.slice(1)
        suggestionBufferRef.current = rest
        setSuggestionBuffer(rest)
        const played = new Set(playedUrisRef.current)
        if (!played.has(trackPlayKey(card.track))) {
          currentCardRef.current = card
          setCurrentCard(card)
          console.info(DJQ, 'startPlaybackFromSuggestions: set now playing', card.track.name)
          return
        }
        console.info(DJQ, 'startPlaybackFromSuggestions: resolved track already in played; popping', next.search.slice(0, 40))
      } catch (e) {
        if (e instanceof RateLimitError) {
          const waitMs = (e.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS) + 5_000
          console.warn(DJQ, 'startPlaybackFromSuggestions: RateLimitError', waitMs)
          setBackoffUntil(Date.now() + waitMs)
          setError(`${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate limiting requests. Blocked until ${formatRetryTime(waitMs)}.`)
          fillFromHeardWhenRateLimited()
        } else if (e instanceof AuthError) {
          console.warn(DJQ, 'startPlaybackFromSuggestions: AuthError')
          setError('Authentication error (401). Access token may be invalid or missing.')
        }
        return
      }
    }
    if (suggestionBufferRef.current.length > 0 && !currentCardRef.current) {
      console.warn(DJQ, 'startPlaybackFromSuggestions: ended with buffer left but no current card', {
        bufferLeft: suggestionBufferRef.current.length,
      })
    }
  }, [resolveOneSuggestion, fillFromHeardWhenRateLimited])

  /** Resolve one suggestion at a time until queue has 3 items or buffer is empty. */
  const topUpQueueFromSuggestions = useCallback(async () => {
    while (queueRef.current.length < 3 && suggestionBufferRef.current.length > 0) {
      const next = suggestionBufferRef.current[0]
      try {
        const card = await resolveOneSuggestion(next)
        if (!card) {
          console.warn(DJQ, 'topUpQueueFromSuggestions: resolve returned null; dropping row', next.search.slice(0, 48))
          const rest = suggestionBufferRef.current.slice(1)
          suggestionBufferRef.current = rest
          setSuggestionBuffer(rest)
          continue
        }
        const rest = suggestionBufferRef.current.slice(1)
        suggestionBufferRef.current = rest
        setSuggestionBuffer(rest)
        const seen = new Set<string>([
          ...playedUrisRef.current,
          ...cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean),
          ...(currentCardRef.current ? [trackPlayKey(currentCardRef.current.track)] : []),
          ...queueRef.current.map(c => trackPlayKey(c.track)),
        ])
        if (!seen.has(trackPlayKey(card.track))) {
          const newQ = [...queueRef.current, card]
          queueRef.current = newQ
          setQueue(newQ)
          console.info(DJQ, 'topUpQueueFromSuggestions: added', card.track.name, 'queue len', newQ.length)
        } else {
          console.info(DJQ, 'topUpQueueFromSuggestions: duplicate skipped', card.track.name)
        }
      } catch (e) {
        if (e instanceof RateLimitError) {
          const waitMs = (e.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS) + 5_000
          console.warn(DJQ, 'topUpQueueFromSuggestions: RateLimitError', waitMs)
          setBackoffUntil(Date.now() + waitMs)
          setError(`${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate limiting requests. Blocked until ${formatRetryTime(waitMs)}.`)
          fillFromHeardWhenRateLimited()
        } else if (e instanceof AuthError) {
          console.warn(DJQ, 'topUpQueueFromSuggestions: AuthError')
          setError('Authentication error (401). Access token may be invalid or missing.')
        }
        return
      }
    }
  }, [resolveOneSuggestion, fillFromHeardWhenRateLimited])

  /** Outcome of batch ID promote — do not infer from isSpotifyBackoff() (stale client timer). */
  type PromoteDjResult = 'ok' | 'noop' | 'rate_limited' | 'auth_error'

  /**
   * Batch-resolve pending DJ suggestions that already have Spotify track IDs (no text search).
   * Uses one `/api/next-song` call → `getTracksByIds` on the server.
   */
  const promoteDjPendingByIdOnly = useCallback(async (): Promise<PromoteDjResult> => {
    if (isGuideDemo) {
      console.info(DJQ, 'promoteDjPendingByIdOnly: skipped (guide demo)')
      return 'noop'
    }
    if (sourceRef.current === 'youtube') {
      console.info(DJQ, 'promoteDjPendingByIdOnly: skipped (YouTube mode — use text resolve)')
      return 'noop'
    }
    const needCurrent = !currentCardRef.current
    const queueRoom = Math.max(0, 3 - queueRef.current.length)
    const maxTake =
      needCurrent && queueRef.current.length === 0
        ? 4
        : queueRoom

    if (maxTake <= 0) {
      console.info(DJQ, 'promoteDjPendingByIdOnly: skipped (no slots)', {
        needCurrent,
        queueLen: queueRef.current.length,
      })
      return 'noop'
    }

    const buf = suggestionBufferRef.current
    const take: SongSuggestion[] = []
    const indicesToRemove = new Set<number>()
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i]
      if (take.length >= maxTake) break
      if (!normalizeSpotifyTrackId(s.spotifyId)) continue
      take.push(s)
      indicesToRemove.add(i)
    }
    if (take.length === 0) {
      console.info(DJQ, 'promoteDjPendingByIdOnly: no spotifyId on pending rows; will use text resolve')
      return 'noop'
    }

    console.info(DJQ, 'promoteDjPendingByIdOnly: batch request', take.length, 'ids')
    const res = await fetch('/api/next-song', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songsToResolve: take,
          sessionHistory: sessionHistoryRef.current,
          accessToken: accessTokenRef.current,
          forceTextSearch: false,
        }),
      })

      if (res.status === 429) {
        const errBody = await res.json().catch(() => null)
        const retryMs =
          errBody && typeof errBody.retryAfterMs === 'number' ? errBody.retryAfterMs : undefined
        console.warn(DJQ, 'promoteDjPendingByIdOnly: HTTP 429', errBody)
        const waitMs = (retryMs ?? 60_000) + 5_000
        setBackoffUntil(Date.now() + waitMs)
        setError(`Spotify is rate limiting requests. Blocked until ${formatRetryTime(waitMs)}.`)
        fillFromHeardWhenRateLimited()
        return 'rate_limited'
      }
      if (res.status === 401) {
        console.warn(DJQ, 'promoteDjPendingByIdOnly: HTTP 401')
        setError('Authentication error (401). Access token may be invalid or missing.')
        return 'auth_error'
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        console.warn(DJQ, 'promoteDjPendingByIdOnly: HTTP', res.status, t.slice(0, 160))
        return 'noop'
      }

      const data = await res.json()
      const songs = data.songs as
        | {
            track: SpotifyTrack
            reason: string
            category?: string
            coords?: { x: number; y: number }
            composed?: number
          }[]
        | undefined
      if (!songs?.length) {
        console.warn(DJQ, 'promoteDjPendingByIdOnly: empty songs in response body')
        return 'noop'
      }

      recordFetch(1)

      const seen = new Set<string>([
        ...playedUrisRef.current,
        ...cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean),
        ...(currentCardRef.current ? [currentCardRef.current.track.uri] : []),
        ...queueRef.current.map(c => c.track.uri),
      ])

      const cards: CardState[] = []
      for (const t of songs) {
        const u = t.track.uri
        if (seen.has(u)) continue
        seen.add(u)
        cards.push({
          track: t.track,
          reason: t.reason,
          category: t.category,
          coords: t.coords,
          composed: t.composed,
        })
      }
      if (cards.length === 0) {
        console.warn(DJQ, 'promoteDjPendingByIdOnly: all tracks filtered as duplicates / seen')
        const rest = buf.filter((_, i) => !indicesToRemove.has(i))
        suggestionBufferRef.current = rest
        setSuggestionBuffer(rest)
        return 'noop'
      }

      const rest = buf.filter((_, i) => !indicesToRemove.has(i))
      suggestionBufferRef.current = rest
      setSuggestionBuffer(rest)

      console.info(DJQ, 'promoteDjPendingByIdOnly: applying', cards.length, 'cards to player')
      let restCards = cards
      if (!currentCardRef.current && queueRef.current.length === 0) {
        const [first, ...afterFirst] = restCards
        currentCardRef.current = first
        setCurrentCard(first)
        lastPlayedUriRef.current = null
        setHasRated(false)
        hasRatedRef.current = false
        seen.add(first.track.uri)
        restCards = afterFirst.slice(0, 3)
      }

      const q = [...queueRef.current]
      for (const c of restCards) {
        if (q.length >= 3) break
        if (seen.has(c.track.uri)) continue
        seen.add(c.track.uri)
        q.push(c)
      }
      queueRef.current = q
      setQueue(q)
      console.info(DJQ, 'promoteDjPendingByIdOnly: done', {
        nowPlaying: Boolean(currentCardRef.current),
        queueLen: q.length,
        bufferLeft: suggestionBufferRef.current.length,
      })
      return 'ok'
  }, [isGuideDemo, fillFromHeardWhenRateLimited])

  /**
   * Move DJ buffer into now playing / Up Next: batch by Spotify ID when possible, then lazy resolve.
   * Runs automatically when there is room; `userInitiated` controls whether to surface setError toasts.
   */
  const consumeDjSuggestionBuffer = useCallback(
    async (options?: { userInitiated?: boolean }) => {
      const userInitiated = options?.userInitiated ?? false
      const label = userInitiated ? 'user' : 'auto'
      if (isGuideDemo) {
        console.info(DJQ, 'consume: skipped (guide demo)', label)
        return
      }
      if (suggestionBufferRef.current.length === 0) {
        console.info(DJQ, 'consume: skipped (buffer empty)', label)
        return
      }

      const slotsRemaining = () => {
        const needCurrent = !currentCardRef.current
        const queueRoom = Math.max(0, 3 - queueRef.current.length)
        return needCurrent && queueRef.current.length === 0 ? 4 : queueRoom
      }

      const slots = slotsRemaining()
      if (slots <= 0) {
        console.info(DJQ, 'consume: skipped (no slots for queue)', label, {
          hasCurrent: Boolean(currentCardRef.current),
          queueLen: queueRef.current.length,
        })
        if (userInitiated) {
          setError('Up Next is full — skip a track or press Next to make room.')
        }
        return
      }

      // Avoid hammering Spotify: effect re-runs when backoffUntil changes — without this we loop 429 → setBackoff → effect → consume → 429.
      const backoffActive = Boolean(backoffUntilRef.current && backoffUntilRef.current > Date.now())
      if (backoffActive) {
        console.info(DJQ, 'consume: skipped (Spotify backoff active)', label)
        if (userInitiated) {
          setError(`${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate-limited — try again after the cooldown.`)
        }
        return
      }

      const hadIds = suggestionBufferRef.current.some(s =>
        normalizeSpotifyTrackId(s.spotifyId)
      )

      console.info(DJQ, 'consume: start', label, {
        bufferLen: suggestionBufferRef.current.length,
        slots,
        hadSpotifyIds: hadIds,
        clientBackoffHint: isSpotifyBackoffActive(),
      })

      resolvingRef.current = true
      setPromotingDjPending(true)
      try {
        let promoteDone = false
        let loop = 0

        while (suggestionBufferRef.current.length > 0) {
          loop++
          if (slotsRemaining() <= 0) {
            console.info(DJQ, 'consume: loop exit (no slots)', { loop })
            if (userInitiated) {
              setError(
                'Up Next is full — skip a track or press Next to add more from the DJ.'
              )
            }
            break
          }

          if (!promoteDone && hadIds) {
            console.info(DJQ, 'consume: calling promoteDjPendingByIdOnly', { loop })
            const pr = await promoteDjPendingByIdOnly()
            promoteDone = true
            if (pr === 'rate_limited') {
              console.warn(DJQ, 'consume: promote returned HTTP 429', { loop })
              if (userInitiated) {
                setError(
                  `${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate-limited — try again after the cooldown.`
                )
              }
              break
            }
            if (pr === 'auth_error') {
              if (userInitiated) {
                setError('Authentication error (401). Access token may be invalid or missing.')
              }
              break
            }
            continue
          }

          const bufBefore = suggestionBufferRef.current.length

          if (!currentCardRef.current && suggestionBufferRef.current.length > 0) {
            console.info(DJQ, 'consume: startPlaybackFromSuggestions', { loop, bufBefore })
            await startPlaybackFromSuggestions()
          }
          if (
            currentCardRef.current &&
            queueRef.current.length < 3 &&
            suggestionBufferRef.current.length > 0
          ) {
            console.info(DJQ, 'consume: topUpQueueFromSuggestions', {
              loop,
              bufBefore: suggestionBufferRef.current.length,
              queueLen: queueRef.current.length,
            })
            await topUpQueueFromSuggestions()
          }

          if (suggestionBufferRef.current.length === bufBefore) {
            console.warn(DJQ, 'consume: no progress (buffer unchanged)', {
              loop,
              bufBefore,
              hasCurrent: Boolean(currentCardRef.current),
              queueLen: queueRef.current.length,
            })
            if (suggestionBufferRef.current.length > 0 && userInitiated) {
              setError(
                'Could not add those tracks — they may already be queued or in your history.'
              )
            }
            break
          }
        }

        if (
          userInitiated &&
          isSpotifyBackoffActive() &&
          suggestionBufferRef.current.length > 0
        ) {
          setError(`${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate-limited — try again after the cooldown.`)
        }

        console.info(DJQ, 'consume: end', label, {
          bufferLeft: suggestionBufferRef.current.length,
          queueLen: queueRef.current.length,
          hasCurrent: Boolean(currentCardRef.current),
        })
      } finally {
        if (currentCardRef.current || queueRef.current.length > 0) {
          djLlmRetryAfterMsRef.current = 0
        }
        setPromotingDjPending(false)
        resolvingRef.current = false
      }
    },
    [
      isGuideDemo,
      promoteDjPendingByIdOnly,
      startPlaybackFromSuggestions,
      topUpQueueFromSuggestions,
    ]
  )
  consumeDjSuggestionBufferRef.current = consumeDjSuggestionBuffer

  // ── Auto-fill: move DJ buffer → now playing / Up Next, or fetch more LLM suggestions ──
  useEffect(() => {
    if (isGuideDemo) return
    if (!historyReady) {
      if (!djQueueLoggedHistoryWaitRef.current) {
        djQueueLoggedHistoryWaitRef.current = true
        console.info(DJQ, 'auto-fill effect: skipped until historyReady (channels restored)')
      }
      return
    }
    // Backoff active: fill from Heard. For YouTube-only (no Spotify token at all) stop here;
    // for Spotify, the LLM profileOnly path must still run to refill the buffer — do NOT return.
    if (backoffUntil && backoffUntil > Date.now()) {
      if (!fetchingRef.current && !resolvingRef.current) {
        resolvingRef.current = true
        try {
          fillFromHeardWhenRateLimited()
        } finally {
          resolvingRef.current = false
        }
      }
      if (youtubeOnly) return
    }
    if (fetchingRef.current) {
      console.info(DJQ, 'auto-fill effect: skipped (fetchToBuffer in flight)')
      return
    }

    if (resolvingRef.current) {
      console.info(DJQ, 'auto-fill effect: skipped (resolvingRef in flight)')
      return
    }

    const run = async () => {
      if (suggestionBuffer.length > 0) {
        const needCurrent = !currentCard
        const queueRoom = Math.max(0, 3 - queue.length)
        const slots =
          needCurrent && queue.length === 0 ? 4 : queueRoom
        if (slots <= 0) {
          console.info(DJQ, 'auto-fill effect: buffer non-empty but no slots', {
            suggestionBufferLen: suggestionBuffer.length,
            hasCurrent: Boolean(currentCard),
            queueLen: queue.length,
          })
          return
        }
        if (isSpotifyBackoffActive()) {
          const u = backoffUntilRef.current
          console.info(DJQ, 'auto-fill effect: skip consume (Spotify backoff); scheduling retry', {
            untilMs: u ?? 0,
          })
          if (u && u > Date.now() && !cooldownRetryTimerRef.current) {
            const wait = Math.min(u - Date.now() + 250, 120_000)
            cooldownRetryTimerRef.current = setTimeout(() => {
              cooldownRetryTimerRef.current = null
              setCooldownTick(t => t + 1)
            }, Math.max(wait, 500))
          }
          return
        }
        console.info(DJQ, 'auto-fill effect: calling consume', {
          slots,
          suggestionBufferLen: suggestionBuffer.length,
          clientBackoffHint: isSpotifyBackoffActive(),
        })
        try {
          await consumeDjSuggestionBuffer({ userInitiated: false })
          console.info(DJQ, 'auto-fill effect: consume done')
        } catch (e) {
          console.warn(DJQ, 'auto-fill effect: consume threw', e)
        }
        return
      }
      // Call LLM only when the suggestion buffer is empty (never while suggestions remain).
      // Refill both "Up Next" and DJ buffer: either queue is short OR queue is full but we still need DJ rows.
      if (!loadingQueue && suggestionBuffer.length === 0) {
        const retryAfter = djLlmRetryAfterMsRef.current
        if (retryAfter > 0 && Date.now() < retryAfter) {
          const wait = retryAfter - Date.now()
          console.info(DJQ, 'auto-fill effect: skipping fetchToBuffer (post-failed-constraint backoff)', {
            waitMs: Math.round(wait),
          })
          if (wait > 0 && !cooldownRetryTimerRef.current) {
            cooldownRetryTimerRef.current = setTimeout(() => {
              cooldownRetryTimerRef.current = null
              setCooldownTick(t => t + 1)
            }, Math.min(wait + 100, 60_000))
          }
          return
        }
        if (
          shouldDeferLlmUntilDjChoice(
            cardHistoryRef.current.length,
            genresRef.current,
            genreTextRef.current,
            regionsRef.current,
            artistsRef.current,
            artistTextRef.current,
            notesRef.current,
            timePeriodRef.current,
            popularityRef.current,
            exploreModeRef.current
          )
        ) {
          console.info(DJQ, 'auto-fill effect: skipping fetchToBuffer — empty channel, no explicit DJ choice yet')
          return
        }
        console.info(DJQ, 'auto-fill effect: calling fetchToBuffer (buffer empty)', {
          queueLen: queue.length,
          queueTarget: QUEUE_TARGET,
          bufferTarget: BUFFER_TARGET,
        })
        fetchToBuffer()
      }
    }

    void run()
  }, [
    currentCard,
    queue.length,
    suggestionBuffer.length,
    loadingQueue,
    historyReady,
    fetchToBuffer,
    backoffUntil,
    cooldownTick,
    isGuideDemo,
    consumeDjSuggestionBuffer,
    fillFromHeardWhenRateLimited,
  ])

  // ── Record a rating (log it + fire LLM prefetch, but do NOT advance) ─────
  const recordRating = useCallback((value: number) => {
    const cur = currentCardRef.current
    if (!cur) return

    const reaction = determineReaction(value)
    const event: ListenEvent = {
      track: cur.track.name,
      artist: cur.track.artist,
      percentListened: value,
      reaction,
      coords: cur.coords,
    }
    const historyEntry: HistoryEntry = {
      ...event,
      albumArt: cur.track.albumArt,
      uri: cur.track.uri,
      category: cur.category,
      coords: cur.coords,
    }

    // If already rated this song, replace the previous entry
    const base = cardHistoryRef.current
    const existingIdx = base.findIndex(e => e.track === cur.track.name && e.artist === cur.track.artist)
    let newCardHistory: HistoryEntry[]
    let newSession: ListenEvent[]
    if (existingIdx !== -1) {
      newCardHistory = base.map((e, i) => (i === existingIdx ? historyEntry : e))
      newSession = sessionHistoryRef.current.map(e =>
        e.track === cur.track.name && e.artist === cur.track.artist ? event : e
      )
    } else {
      newCardHistory = dedupeHistory([...base, historyEntry])
      newSession = [...sessionHistoryRef.current, event]
    }

    setCardHistory(newCardHistory)
    cardHistoryRef.current = newCardHistory
    setSessionHistory(newSession)
    sessionHistoryRef.current = newSession

    setHasRated(true)
    hasRatedRef.current = true

    // On rating: call LLM for profile update + new suggestions (no Spotify lookup).
    // Spotify resolution happens lazily when songs are actually needed.
    fetchProfileOnly()
  }, [dedupeHistory, fetchProfileOnly])

  // ── Advance to next song (called by Next button or play-slider-end) ───────
  const advance = useCallback((playedToEnd = false) => {
    const cur = currentCardRef.current
    if (!cur) return

    // If user never rated, log as move-on and fire LLM
    if (!hasRatedRef.current) {
      const pct = playedToEnd ? 100 : (durationRef.current > 0 ? (sliderRef.current / durationRef.current) * 100 : 0)
      const event: ListenEvent = {
        track: cur.track.name,
        artist: cur.track.artist,
        percentListened: pct,
        reaction: 'move-on',
        coords: cur.coords,
      }
      const historyEntry: HistoryEntry = {
        ...event,
        albumArt: cur.track.albumArt,
        uri: cur.track.uri,
        category: cur.category,
        coords: cur.coords,
      }
      const newCardHistory = dedupeHistory([...cardHistoryRef.current, historyEntry])
      setCardHistory(newCardHistory)
      cardHistoryRef.current = newCardHistory
      const newSession = [...sessionHistoryRef.current, event]
      setSessionHistory(newSession)
      sessionHistoryRef.current = newSession
      if (suggestionBufferRef.current.length === 0) fetchToBuffer()
    }

    // Let the play effect run again when the next row reuses the same URI/id (queue duplicates).
    setPlayGeneration(g => g + 1)
    lastPlayedUriRef.current = null

    // Advance from queue
    const q = queueRef.current
    if (q.length > 0) {
      const [next, ...rest] = q
      currentCardRef.current = next
      setCurrentCard(next)
      setQueue(rest)
      queueRef.current = rest
    } else {
      currentCardRef.current = null
      setCurrentCard(null)
    }
  }, [dedupeHistory, fetchToBuffer])
  const advanceWithFade = useCallback(async (playedToEnd = false) => {
    const player = playerRef.current
    if (player) {
      pendingFadeInRef.current = true
      await fadeVolume(player, 1, 0)
    }
    advance(playedToEnd)
  }, [advance])
  advanceRef.current = advanceWithFade

  // ── Remove history entries ────────────────────────────────────────────────
  const handleRemoveMultiple = useCallback((indices: number[]) => {
    const indexSet = new Set(indices)
    const newCardHistory = cardHistoryRef.current.filter((_, i) => !indexSet.has(i))
    setCardHistory(newCardHistory)
    cardHistoryRef.current = newCardHistory

    // Rebuild session history from scratch; clear profile so LLM re-learns
    const newSession = newCardHistory.map(({ track, artist, percentListened, reaction, coords }) => ({
      track, artist, percentListened, reaction, coords,
    }))
    setSessionHistory(newSession)
    sessionHistoryRef.current = newSession
    setPriorProfile('')
    priorProfileRef.current = ''
    setProfile('')
    setQueue([])
    queueRef.current = []
    setSuggestionBuffer([])
    suggestionBufferRef.current = []
    fetchToBuffer(undefined, undefined, undefined, true, false, true)
  }, [fetchToBuffer])

  const handleRateHistoryItem = useCallback((index: number, percent: number) => {
    const reaction = determineReaction(percent)
    const newCardHistory = cardHistoryRef.current.map((e, i) =>
      i === index ? { ...e, percentListened: percent, reaction } : e
    )
    // Update display + localStorage via state, but do NOT call setSessionHistory —
    // that triggers a re-render which can fire the fill effect and kick off an LLM call.
    // Update the ref directly so the next natural LLM call gets the corrected ratings.
    setCardHistory(newCardHistory)
    cardHistoryRef.current = newCardHistory
    sessionHistoryRef.current = newCardHistory.map(({ track, artist, percentListened, reaction, coords }) => ({
      track, artist, percentListened, reaction, coords,
    }))
  }, [])

  // ── Genre/time period change → wipe queue+buffer and replace ─────────────
  const constraintInitRef = useRef(false)
  const handleConstraintResults = useCallback((cards: CardState[]) => {
    if (cards.length === 0) return
    setSuggestionBuffer([])
    suggestionBufferRef.current = []
    if (!currentCardRef.current) {
      // Nothing playing — start immediately
      const [first, ...rest] = cards
      currentCardRef.current = first
      setCurrentCard(first)
      setQueue(rest)
      queueRef.current = rest
      setHasRated(false)
      hasRatedRef.current = false
    } else {
      // Song in progress — only replace the upcoming queue, let current song finish
      setQueue(cards)
      queueRef.current = cards
    }
  }, [])

  // Reset the init guard on unmount so React StrictMode's double-invocation
  // (mount → unmount → remount) doesn't fire a spurious fetch on the second mount.
  useEffect(() => () => { constraintInitRef.current = false }, [])

  const constraintDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Single stable dep for constraint LLM effect — avoids a variable-length dependency array (React requires constant length). */
  const constraintDepsKey = useMemo(
    () =>
      JSON.stringify({
        isGuideDemo,
        genres,
        genreText,
        timePeriod,
        notes,
        popularity,
        regions,
        artists,
        artistText,
        discovery,
      }),
    [isGuideDemo, genres, genreText, timePeriod, notes, popularity, regions, artists, artistText, discovery]
  )

  // Deps: single memo key only (constant array length for React). Do not add fetchToBuffer — callback churn would re-fire debounce.
  useEffect(() => {
    if (isGuideDemo) return
    if (!constraintInitRef.current) {
      constraintInitRef.current = true
      return
    }
    // Debounce: sliders and text fields fire on every tick/keystroke.
    // Wait 600ms of silence before actually fetching.
    if (constraintDebounceRef.current) clearTimeout(constraintDebounceRef.current)
    // Longer debounce while there is no listen history so the user can adjust several settings in one go.
    const constraintDebounceMs = cardHistoryRef.current.length === 0 ? 1500 : 600
    constraintDebounceRef.current = setTimeout(() => {
      constraintDebounceRef.current = null
      if (!deviceIdRef.current) return
      if (
        djSettingsMatchCommitted(
          committedSettingsRef.current,
          notesRef.current,
          genreTextRef.current,
          timePeriodRef.current,
          genresRef.current,
          regionsRef.current,
          artistsRef.current,
          artistTextRef.current,
          popularityRef.current,
          exploreModeRef.current
        )
      ) {
        console.info('constraint effect: skipping fetch — settings match last commit (no change)')
        return
      }
      // Same rule as fetchToBuffer: no LLM until the user has chosen a DJ setting (constraint uses force:true).
      if (
        shouldDeferLlmUntilDjChoice(
          cardHistoryRef.current.length,
          genresRef.current,
          genreTextRef.current,
          regionsRef.current,
          artistsRef.current,
          artistTextRef.current,
          notesRef.current,
          timePeriodRef.current,
          popularityRef.current,
          exploreModeRef.current
        )
      ) {
        console.info('constraint effect: skipping — empty channel, no DJ settings yet')
        return
      }
      fetchToBuffer(
        undefined,
        undefined,
        cards => {
          handleConstraintResults(cards)
          setLoadingQueue(false)
        },
        true,
        true,
        false
      )
    }, constraintDebounceMs)
  }, [constraintDepsKey])

  // ── Grade handler — log rating, start LLM, but stay on current song ──────
  const handleGradeSubmit = useCallback((value: number) => {
    recordRating(value)
  }, [recordRating])

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    if (isGuideDemo) return
    setError(null)
    fetchToBuffer(undefined, true, undefined, true, false, true)
  }, [fetchToBuffer, isGuideDemo])

  const handleSpotifyPingRetry = useCallback(async () => {
    setSpotifyPingInFlight(true)
    try {
      const res = await fetch('/api/spotify/ping').then(r => r.json()).catch(() => null)
      if (res?.ok) {
        setBackoffUntil(null)
        setError(null)
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current)
        try {
          localStorage.removeItem('spotifyRateLimitUntil')
        } catch {}
      } else if (res?.retryAfterMs) {
        const until = Date.now() + res.retryAfterMs + 5_000
        setBackoffUntil(until)
        try {
          localStorage.setItem('spotifyRateLimitUntil', String(until))
        } catch {}
      }
    } finally {
      setSpotifyPingInFlight(false)
    }
  }, [])

  const handleYoutubePingRetry = useCallback(async () => {
    setSpotifyPingInFlight(true)
    try {
      const res = await fetch('/api/youtube/ping').then(r => r.json()).catch(() => null)
      if (res?.ok) {
        setBackoffUntil(null)
        setError(null)
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current)
      } else if (res?.retryAfterMs) {
        setBackoffUntil(Date.now() + res.retryAfterMs + 5_000)
      }
    } finally {
      setSpotifyPingInFlight(false)
    }
  }, [])

  const playUri = useCallback(async (uri: string | null, label: string): Promise<boolean> => {
    if (isGuideDemo) {
      setPlayResponse(`Guide demo mode: playback disabled for ${label}.`)
      return false
    }
    if (!uri) {
      setPlayResponse(`No URI available for ${label}.`)
      return false
    }

    const dId = deviceIdRef.current
    setPlayResponse(
      dId ? `Requesting playback for ${label}…` : `Requesting playback on your active Spotify device…`,
    )

    try {
      const res = await fetch('/api/play-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uri,
          ...(dId ? { deviceId: dId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPlayResponse(`Playback failed: ${data.error} ${data.status ?? ''}`)
        return false
      }
      setPlayResponse('Playback request accepted.')
      return true
    } catch (err) {
      setPlayResponse(`Playback error: ${(err as Error).message}`)
      return false
    }
  }, [isGuideDemo])


  const handlePlayHistoryItem = useCallback(
    async (entry: HistoryEntry) => {
      const track = historyEntryToTrack(entry)
      if (!track) {
        setPlayResponse('Cannot replay: no valid Spotify track id for this entry.')
        return
      }
      const card: CardState = {
        track,
        reason: HEARD_PLAYBACK_REASON,
        category: entry.category,
        coords: entry.coords,
      }
      const ok = await playUri(track.uri, 'history entry')
      if (!ok) return
      lastPlayedUriRef.current = track.uri
      playedUrisRef.current.add(track.uri)
      pendingPlaybackPositionMsRef.current = undefined
      currentCardRef.current = card
      setCurrentCard(card)
      setHasRated(false)
      hasRatedRef.current = false
    },
    [playUri]
  )
  const duration = playbackState?.duration ?? 0

  const spotifyStatusMessage =
    backoffUntil && backoffUntil > Date.now()
      ? `${source === 'youtube' ? 'YouTube' : 'Spotify'} rate-limited until ${new Date(backoffUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null

  return (
    <div data-guide="full-player" className="min-h-screen min-w-[min(100%,900px)] bg-black text-white flex flex-col overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-2 sm:py-4 border-b border-zinc-900 flex-wrap">
        <h1 className="text-xl font-bold">Earprint</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400">LLM</label>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value as LLMProvider)}
            className="text-xs bg-zinc-900 text-white border border-zinc-700 rounded px-2 py-1"
          >
            <option value="anthropic">Claude</option>
            <option value="openai">GPT-4o</option>
            <option value="deepseek">DeepSeek</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        {spotifyUser && (
          <div className="text-xs text-zinc-300 hidden sm:block">
            {spotifyUser.display_name ?? spotifyUser.id}
          </div>
        )}
        <div className="flex gap-2 sm:gap-3 items-center">
          <Link href="/map" target="earprint-map" className="text-xs text-zinc-300 hover:text-white transition-colors hidden sm:inline">Map ↗</Link>
          <a href="/status" className="text-xs text-zinc-300 hover:text-white transition-colors hidden sm:inline">Status</a>
          <a href="/guide.html" target="_blank" className="text-xs text-zinc-300 hover:text-white transition-colors">Guide</a>
          <a href="/diary.html" target="_blank" className="text-xs text-zinc-300 hover:text-white transition-colors hidden sm:inline">Diary</a>
          <a href="/api/auth/logout" className="text-xs text-zinc-300 hover:text-white">Logout</a>
        </div>
      </div>
      {/* Channel tabs */}
      {channels.length > 0 && (
        <div data-guide="channels" className="flex items-center gap-1 px-4 py-2 border-b border-zinc-900 overflow-x-auto">
          {channels.map(ch => (
            <div
              key={ch.id}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs border transition-colors flex-shrink-0 ${
                ch.id === activeChannelId
                  ? 'bg-zinc-800 border-zinc-600 text-white'
                  : 'border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500'
              }`}
            >
              {editingChannelId === ch.id ? (
                <input
                  className="bg-transparent outline-none w-28 text-white"
                  value={editingChannelName}
                  onChange={e => setEditingChannelName(e.target.value)}
                  onBlur={() => { renameChannel(ch.id, editingChannelName); setEditingChannelId(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { renameChannel(ch.id, editingChannelName); setEditingChannelId(null) }
                    if (e.key === 'Escape') setEditingChannelId(null)
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className={ch.id === activeChannelId ? 'cursor-text' : 'cursor-pointer'}
                  onClick={() => {
                    if (ch.id === activeChannelId) {
                      setEditingChannelId(ch.id)
                      setEditingChannelName(ch.name)
                    } else {
                      switchChannel(ch.id)
                    }
                  }}
                >
                  {ch.name}
                </span>
              )}
              {channels.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); deleteChannel(ch.id) }}
                  className="text-zinc-600 hover:text-red-400 ml-1 leading-none transition-colors"
                >×</button>
              )}
            </div>
          ))}
          <button
            onClick={createChannel}
            className="px-2 py-1 text-lg leading-none text-zinc-400 hover:text-white flex-shrink-0 transition-colors"
            title="New channel"
          >+</button>
          {!isGuideDemo && (
            <>
              <input
                ref={importChannelsInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-hidden
                onChange={handleImportChannelsFile}
              />
              <button
                type="button"
                onClick={handleExportChannels}
                className="px-2 py-1 text-xs text-zinc-600 hover:text-zinc-300 flex-shrink-0 transition-colors"
                title="Download all channels as JSON"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => importChannelsInputRef.current?.click()}
                className="px-2 py-1 text-xs text-zinc-600 hover:text-zinc-300 flex-shrink-0 transition-colors"
                title="Replace channels from a JSON file"
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => setChannelsDialog({ kind: 'reset' })}
                className="px-2 py-1 text-xs text-zinc-600 hover:text-red-400 flex-shrink-0 transition-colors"
                title="Delete all channels and saved settings; start with one empty channel"
              >
                Reset all
              </button>
            </>
          )}
        </div>
      )}

      {spotifyStatusMessage && (
        <div
          role="status"
          aria-live="polite"
          data-guide="status-banner"
          className="px-6 py-2.5 bg-yellow-900 text-yellow-50 text-sm flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-b border-yellow-800/40"
        >
          <span className="text-center">{spotifyStatusMessage}</span>
          <span className="flex items-center gap-3 text-xs">
            <button
              type="button"
              disabled={spotifyPingInFlight}
              className="underline text-yellow-200 hover:text-yellow-50 disabled:opacity-60 disabled:cursor-wait"
              onClick={source === 'youtube' ? handleYoutubePingRetry : handleSpotifyPingRetry}
            >
              {spotifyPingInFlight ? 'Checking…' : 'Try now'}
            </button>
            <span className="text-yellow-700" aria-hidden>
              ·
            </span>
            <Link href="/status" className="underline text-yellow-200 hover:text-yellow-50 font-medium">
              Stats
            </Link>
          </span>
        </div>
      )}
      {channelsNotice && (
        <div
          role="alert"
          className="px-6 py-2.5 bg-red-950/90 border-b border-red-900/50 text-red-100 text-sm flex flex-wrap items-center justify-between gap-3"
        >
          <span className="min-w-0">{channelsNotice}</span>
          <button
            type="button"
            className="shrink-0 text-red-300 hover:text-white underline text-xs"
            onClick={() => setChannelsNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {playResponse && (
        <div className="px-6 py-3 border-b border-zinc-900">
          <p className="text-xs text-zinc-400 truncate">{playResponse}</p>
        </div>
      )}
      {youtubeResolveTestActive && (
        <div
          role="status"
          className="px-6 py-2 bg-emerald-950/90 border-b border-emerald-800/60 text-emerald-100 text-xs text-center leading-relaxed"
        >
          YouTube resolve test mode: <strong>no LLM</strong>, one fixture suggestion, resolves via{' '}
          <strong>/api/youtube-resolve-test</strong> (no YouTube search quota). Restart{' '}
          <code className="text-emerald-300/90">next dev</code> after editing{' '}
          <code className="text-emerald-300/90">.env.local</code>.
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col sm:flex-row gap-4 p-2 sm:p-4 sm:items-start overflow-y-auto flex-1">

        {/* Player panel — full-bleed album art or YouTube player */}
        <div
          data-guide="album-panel"
          className="relative rounded-2xl overflow-hidden flex-shrink-0 w-full sm:w-[340px] h-64 sm:h-[580px] bg-zinc-900"
          style={{ cursor: currentCard && (currentCard.track.source as string) !== 'youtube' ? 'pointer' : 'default' }}
          onClick={currentCard && (currentCard.track.source as string) !== 'youtube' ? togglePlayback : undefined}
        >
          {/* YouTube player */}
          {currentCard && (currentCard.track.source as string) === 'youtube' && (
            <YoutubePlayer
              key={`${currentCard.track.id}-${playGeneration}`}
              ref={youtubePlayerRef}
              videoId={currentCard.track.id}
              onEnded={() => advanceRef.current?.(true)}
              onPlayerError={code => {
                const isEmbed = code === 101 || code === 150 || code === 153
                setError(
                  isEmbed
                    ? 'This video cannot play in the embedded player here (embedding/autoplay limits). Use the player unmute control, or open on YouTube.'
                    : `YouTube player error (code ${code}).`
                )
              }}
            />
          )}

          {/* Album art background (Spotify only) */}
          {currentCard?.track.albumArt && (currentCard.track.source as string) !== 'youtube' && (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${currentCard.track.albumArt})`,
                backgroundSize: 'auto 100%',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                animation: playbackState?.paused ? 'none' : 'albumPan 60s ease-in-out infinite alternate',
              }}
            />
          )}

          {/* Play/pause hover overlay (Spotify only — YouTube uses the iframe controls) */}
          {currentCard && (currentCard.track.source as string) !== 'youtube' && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200 bg-black/30 z-10 pointer-events-none">
              <span className="text-white text-2xl font-semibold tracking-wide select-none">
                {playbackState?.paused ? 'play' : 'pause'}
              </span>
            </div>
          )}

          {/* Persistent play/pause indicator (Spotify SDK state only) */}
          {currentCard && (currentCard.track.source as string) !== 'youtube' && (
            <div className="absolute top-3 right-3 z-20 pointer-events-none">
              <span className="text-white text-xl select-none drop-shadow-lg">
                {playbackState?.paused ? '⏸' : '▶'}
              </span>
            </div>
          )}

          {/* Decorative gradient — must not block iframe pointer events (YouTube) */}
          <div className="absolute inset-0 z-[5] bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" />

          {/* Loading — connecting to Spotify, or actively fetching the next track; otherwise blank (e.g. new channel before DJ settings) */}
          {!currentCard && !error && (!deviceId || loadingQueue) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-zinc-400">
              <div className="w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
              <p className="text-sm">{deviceId ? 'Finding your next song…' : 'Connecting to Spotify…'}</p>
            </div>
          )}

          {/* Error */}
          {error && !currentCard && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
              <p className="text-red-400 text-sm text-center">{error}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {!youtubeOnly && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      try {
                        sessionStorage.removeItem(SPOTIFY_AUTH_REDIRECT_ONCE_KEY)
                      } catch {}
                      window.location.href = '/api/auth/login'
                    }}
                    className="text-sm bg-green-700 px-4 py-2 rounded-full hover:bg-green-600 text-white"
                  >
                    Sign in with Spotify
                  </button>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    handleRetry()
                  }}
                  className="text-sm bg-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-700"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {currentCard && (
            <>
              {/*
                YouTube iframe is z-[6]; these controls are z-10. Without pointer-events-none on the
                bottom panel, the large pt-16 hit area blocks all clicks to the video (play, unmute).
              */}
              {/* Vertical grade slider — right side, aligned with Next button */}
              <div
                data-guide="grade-slider"
                className="absolute right-4 bottom-5 flex flex-col items-center gap-2 z-10 pointer-events-auto"
                onClick={e => e.stopPropagation()}
              >
                <span className="text-white text-xs font-bold tabular-nums bg-black/40 px-1 rounded">
                  {Math.round(gradePercent)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={gradePercent}
                  style={{
                    writingMode: 'vertical-lr' as const,
                    direction: 'rtl' as const,
                    height: 'clamp(80px, 30vh, 180px)',
                    accentColor: '#ff5f5f',
                    cursor: 'pointer',
                  }}
                  onMouseDown={() => setGradeTracking(false)}
                  onTouchStart={() => setGradeTracking(false)}
                  onChange={e => {
                    const v = Number(e.currentTarget.value)
                    setGradePercent(v)
                    gradeRef.current = v
                  }}
                  onMouseUp={e => handleGradeSubmit(Number(e.currentTarget.value))}
                  onTouchEnd={e => handleGradeSubmit(Number(e.currentTarget.value))}
                />
                <span className={`text-[10px] ${hasRated ? 'text-green-400' : 'text-zinc-400'}`}>
                  {hasRated ? 'rated' : 'rate'}
                </span>
              </div>

              {/* Bottom controls */}
              <div
                data-guide="track-info"
                className={`absolute bottom-0 left-0 right-14 px-3 sm:px-5 pb-3 sm:pb-5 pt-8 sm:pt-16 z-10 bg-gradient-to-t from-black via-black/90 to-transparent ${
                  (currentCard.track.source as string) === 'youtube' ? 'pointer-events-none' : ''
                }`}
                onClick={e => e.stopPropagation()}
              >
                <div
                  className={
                    (currentCard.track.source as string) === 'youtube' ? 'pointer-events-auto' : undefined
                  }
                >
                {/* Track info */}
                <a
                  href={(currentCard.track.source as string) === 'youtube'
                    ? `https://www.youtube.com/watch?v=${currentCard.track.id}`
                    : `https://open.spotify.com/track/${currentCard.track.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={(currentCard.track.source as string) === 'youtube' ? 'Open on YouTube' : 'Open in Spotify'}
                  onClick={() => { openedSpotifyRef.current = true }}
                  className="text-white font-bold text-lg truncate leading-tight hover:text-green-400 transition-colors block"
                >
                  {currentCard.track.name}
                </a>
                <p className="text-zinc-300 text-sm truncate">
                  {currentCard.track.artist}
                  {(currentCard.composed ?? currentCard.track.releaseYear) && (
                    <span className="text-zinc-500 ml-2">{currentCard.composed ?? currentCard.track.releaseYear}</span>
                  )}
                </p>
                {currentCard.performer && (
                  <p className="text-zinc-400 text-xs truncate mt-0.5">
                    <span className="text-zinc-600">perf. </span>{currentCard.performer}
                  </p>
                )}
                <p className="hidden sm:block text-zinc-400 text-xs italic mt-1 leading-relaxed" title={currentCard.reason}>
                  {currentCard.reason}
                </p>

                {/* Play time slider */}
                <div className="flex items-center gap-2 mt-1 sm:mt-3">
                  <span className="text-zinc-400 text-xs w-8 text-right tabular-nums">
                    {formatMs(sliderPosition)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={(currentCard.track.source as string) === 'youtube' ? (youtubeDuration || 1) : (duration || 1)}
                    value={sliderPosition}
                    onMouseDown={() => { if ((currentCard.track.source as string) !== 'youtube') isSeekingRef.current = true }}
                    onTouchStart={() => { if ((currentCard.track.source as string) !== 'youtube') isSeekingRef.current = true }}
                    onChange={e => {
                      if ((currentCard.track.source as string) === 'youtube') return
                      const v = Number(e.currentTarget.value)
                      setSliderPosition(v)
                      sliderRef.current = v
                    }}
                    onMouseUp={e => {
                      const v = Number(e.currentTarget.value)
                      isSeekingRef.current = false
                      if ((currentCard.track.source as string) === 'youtube') return
                      if (duration > 0 && v >= duration * 0.98) {
                        advanceWithFade()
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    onTouchEnd={e => {
                      const v = Number(e.currentTarget.value)
                      isSeekingRef.current = false
                      if ((currentCard.track.source as string) === 'youtube') return
                      if (duration > 0 && v >= duration * 0.98) {
                        advanceWithFade()
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    className={`flex-1 cursor-pointer ${(currentCard.track.source as string) === 'youtube' ? 'accent-red-400' : 'accent-[#1DB954]'}`}
                    style={(currentCard.track.source as string) === 'youtube' ? { pointerEvents: 'none' } : {}}
                  />
                  <span className="text-zinc-400 text-xs w-8 tabular-nums">
                    {formatMs((currentCard.track.source as string) === 'youtube' ? youtubeDuration : duration)}
                  </span>
                </div>

                {/* Next button */}
                <div className="flex items-center gap-4 mt-2 sm:mt-4">
                  <button
                    onClick={() => advanceWithFade()}
                    className="flex-1 py-2 sm:py-4 text-xl font-bold bg-white/20 hover:bg-white/30 active:bg-white/40 text-white rounded-2xl transition-colors"
                  >
                    Next
                  </button>
                  {loadingQueue && (
                    <div className="flex items-center gap-2 text-white/70">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-xs">Asking the DJ…</span>
                    </div>
                  )}
                </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right column: session panel */}
        <div className="w-full sm:flex-1 flex flex-col gap-4 min-w-0">
          <div data-guide="sidebar" className="flex-1 min-w-0 px-4 py-4 border border-zinc-800 rounded-2xl bg-zinc-950">
          <SessionPanel
            history={cardHistory}
            queue={queue}
            loadingNext={loadingQueue}
            profile={profile}
            onProfileChange={v => {
              setProfile(v)
              setPriorProfile(v)
              priorProfileRef.current = v
            }}
            notes={notes}
            onNotesChange={setNotes}
            genres={genres}
            onGenresChange={setGenres}
            genreText={genreText}
            onGenreTextChange={setGenreText}
            timePeriod={timePeriod}
            onTimePeriodChange={setTimePeriod}
            regions={regions}
            onRegionsChange={setRegions}
            llmSuggestedArtists={llmSuggestedArtists}
            artists={artists}
            onArtistsChange={setArtists}
            artistText={artistText}
            onArtistTextChange={setArtistText}
            popularity={popularity}
            onPopularityChange={setPopularity}
            discovery={discovery}
            onDiscoveryChange={setDiscovery}
            settingsDirty={settingsDirty}
            committedSettings={committedSettings}
            onRemoveMultiple={handleRemoveMultiple}
            onRateHistoryItem={handleRateHistoryItem}
            submittedUris={submittedUris}
            pendingSuggestions={suggestionBuffer}
            promotingDjPending={promotingDjPending}
            onRemoveQueueItem={(index) => {
              const q = queueRef.current
              if (index < 0 || index >= q.length) return
              const remaining = q.filter((_, i) => i !== index)
              setQueue(remaining)
              queueRef.current = remaining
            }}
            onPlayQueueItem={(index) => {
              const q = queueRef.current
              if (index < 0 || index >= q.length) return
              const picked = q[index]
              const remaining = q.filter((_, i) => i !== index)

              currentCardRef.current = picked
              setCurrentCard(picked)
              setQueue(remaining)
              queueRef.current = remaining
              setHasRated(false)
              hasRatedRef.current = false
            }}
            onPlayHistoryItem={handlePlayHistoryItem}
            source={source}
            onSourceChange={(s: PlaybackSource) => {
              sourceRef.current = s
              setSource(s)
            }}
            ytSearchesRemaining={ytSearchesRemaining}
            youtubeOnly={youtubeOnly}
            musicMap={
              <MusicMap
                history={cardHistory}
                embedded
                width={280}
                height={200}
                currentPlaying={
                  currentCard
                    ? {
                        uri: currentCard.track.uri,
                        track: currentCard.track.name,
                        artist: currentCard.track.artist,
                        coords: currentCard.coords,
                        category: currentCard.category,
                      }
                    : null
                }
                hasRatedCurrent={hasRated}
              />
            }
          />
          </div>
        </div>
      </div>

      {channelsDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
          role="presentation"
          onClick={e => {
            if (e.target === e.currentTarget) setChannelsDialog(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="channels-dialog-title"
            className="bg-zinc-900 border border-zinc-600 rounded-xl p-6 max-w-md w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {channelsDialog.kind === 'import' && (
              <>
                <h2 id="channels-dialog-title" className="text-lg font-semibold text-white mb-2">
                  Replace all channels?
                </h2>
                <p className="text-sm text-zinc-300 mb-6">
                  Replace all {channels.length} channel(s) with {channelsDialog.data.channels.length} imported
                  channel(s)? Your current channels will be overwritten.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    className="px-4 py-2 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                    onClick={() => setChannelsDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm rounded-lg bg-amber-700 hover:bg-amber-600 text-white"
                    onClick={() => applyImportedChannels(channelsDialog.data)}
                  >
                    Replace channels
                  </button>
                </div>
              </>
            )}
            {channelsDialog.kind === 'reset' && (
              <>
                <h2 id="channels-dialog-title" className="text-lg font-semibold text-white mb-2">
                  Reset all channels?
                </h2>
                <p className="text-sm text-zinc-300 mb-6">
                  Delete all channels and start over? This removes every channel, listen history, and saved DJ
                  settings from this browser. You cannot undo this.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    className="px-4 py-2 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                    onClick={() => setChannelsDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm rounded-lg bg-red-800 hover:bg-red-700 text-white"
                    onClick={() => void performResetAllChannels()}
                  >
                    Delete all
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
