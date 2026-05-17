'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { SpotifyTrack } from '@/app/lib/spotify'
import { parseShareId } from '@/app/lib/shareId'
import { ListenEvent, LLMProvider, SongSuggestion } from '@/app/lib/llm'
import SessionPanel, { HistoryEntry } from './SessionPanel'
import { writeNowPlayingSnapshot } from '@/app/lib/nowPlayingBridge'
import PlayerConstellationsEmbed from './PlayerConstellationsEmbed'
import AppHeader from '@/app/components/AppHeader'
import { recordFetch, readStats } from '@/app/lib/callTracker'
import { getGuideDemoState } from '@/app/lib/guideDemo'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import { isYoutubeResolveTestClientEnabled } from '@/app/lib/youtubeResolveTestClient'
import { getYoutubeResolveTestFixtureSuggestion } from '@/app/lib/youtubeResolveTestDefaults'
import YoutubePlayer, { type YoutubePlayerHandle } from './YoutubePlayer'
import {
  ALL_CHANNEL_DISCOVERY_DEFAULT,
  CHANNEL_DISCOVERY_DEFAULT,
} from '@/app/lib/channelsImportExport'
import { BUILT_IN_FACTORY_CHANNELS_IMPORT, getMostPopularCard } from '@/app/lib/demoChannel'
import {
  DEV_FACTORY_OVERRIDE_STORAGE_KEY,
  isDevFactorySnapshotEnabled,
} from '@/app/lib/devFactoryOverride'
import { type PlaybackSource, DEFAULT_PLAYBACK_SOURCE, type CardState } from '@/app/lib/playback/types'
import { applyFreshLoginIfNeeded } from '@/app/lib/freshLogin'

const HISTORY_STORAGE_KEY = 'earprint-history'
const SETTINGS_STORAGE_KEY = 'earprint-settings'
function readSettingsSource(): PlaybackSource {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.source === 'youtube' || parsed.source === 'spotify') return parsed.source
    }
  } catch {}
  return DEFAULT_PLAYBACK_SOURCE
}

function readSettingsGlobalNotes(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.globalNotes === 'string') return parsed.globalNotes.trim()
    }
  } catch {}
  return ''
}
const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const CHANNELS_EXPORT_VERSION = 1

/** Must match `new Spotify.Player({ name })` — used to resolve a fresh `device_id` after play 404. */
const SPOTIFY_WEB_PLAYER_DEVICE_NAME = 'Soundings'

async function fetchWebPlaybackDeviceIdFromSpotifyApi(token: string): Promise<string | null> {
  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const data = (await r.json()) as {
      devices?: { id?: string; name?: string; is_restricted?: boolean }[]
    }
    const devices = (data.devices ?? []).filter(d => typeof d.id === 'string' && d.id.length > 0)
    const match = devices.find(d => d.name === SPOTIFY_WEB_PLAYER_DEVICE_NAME && !d.is_restricted)
    return match?.id ?? devices.find(d => d.name === SPOTIFY_WEB_PLAYER_DEVICE_NAME)?.id ?? null
  } catch {
    return null
  }
}

interface CareerWork {
  title: string
  year: number
  search: string
  reason?: string
  isCurrent?: boolean
}

interface CareerMode {
  artistName: string
  works: CareerWork[]
  currentIndex: number
}

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
  timePeriods?: string[]
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
  /**
   * True when the user explicitly created this channel (in-app "+" or equivalent).
   * False = factory bundle, share row, or starter import. Omitted on legacy persisted data.
   */
  userCreated?: boolean
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

const ALL_CHANNEL_ID = 'earprint-all'

/**
 * When the All channel merges every channel's history for the LLM, cap what
 * each non-All channel contributes so the payload stays small and diverse.
 * Picks: most-recent + highest-rated + lowest-rated (duplicates removed by the
 * Map-based dedup in getDjContextHistories). Active-channel (All's own) refs
 * are never sampled — we send All's full history for current-direction fidelity.
 */
const PER_CHANNEL_SAMPLE_RECENT = 15
const PER_CHANNEL_SAMPLE_TOP = 10
const PER_CHANNEL_SAMPLE_BOTTOM = 5
const PER_CHANNEL_SAMPLE_TOTAL =
  PER_CHANNEL_SAMPLE_RECENT + PER_CHANNEL_SAMPLE_TOP + PER_CHANNEL_SAMPLE_BOTTOM

function sampleForAllChannel<T extends { stars?: number | null }>(entries: T[]): T[] {
  if (entries.length <= PER_CHANNEL_SAMPLE_TOTAL) return entries
  const n = entries.length
  const recent = entries.slice(n - PER_CHANNEL_SAMPLE_RECENT)
  const rated = entries.filter(e => typeof e.stars === 'number' && e.stars !== null)
  const top = [...rated]
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
    .slice(0, PER_CHANNEL_SAMPLE_TOP)
  const bottom = [...rated]
    .sort((a, b) => (a.stars ?? 0) - (b.stars ?? 0))
    .slice(0, PER_CHANNEL_SAMPLE_BOTTOM)
  return [...recent, ...top, ...bottom]
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
    timePeriod: '',
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

function channelCountsAsUserCreated(c: Channel): boolean {
  if (c.id === ALL_CHANNEL_ID) return false
  if (c.userCreated === true) return true
  if (c.userCreated === false) return false
  const hasHistory = (c.cardHistory?.length ?? 0) > 0 || (c.sessionHistory?.length ?? 0) > 0
  const hasProfile = (c.profile?.trim().length ?? 0) > 0
  const hasDj =
    (c.genres?.length ?? 0) > 0 ||
    (c.genreText?.trim().length ?? 0) > 0 ||
    (c.notes?.trim().length ?? 0) > 0 ||
    (c.regions?.length ?? 0) > 0 ||
    (c.artists?.length ?? 0) > 0 ||
    (c.artistText?.trim().length ?? 0) > 0
  return hasHistory || hasProfile || hasDj || !!c.currentCard || (c.queue?.length ?? 0) > 0
}

function hasUserCreatedChannel(channels: Channel[]): boolean {
  return channels.some(channelCountsAsUserCreated)
}

/** Multiple factory-only tabs: hide the pill so "Load starter channels" does not replace a full default set. */
function shouldHideStarterPillForFactoryOnlyList(channels: Channel[]): boolean {
  const nonAll = channels.filter(c => c.id !== ALL_CHANNEL_ID)
  if (nonAll.length < 2) return false
  return nonAll.every(c => c.userCreated === false)
}

function tagNonAllAsNotUserCreated(channels: Channel[]): Channel[] {
  return channels.map(c => (c.id === ALL_CHANNEL_ID ? c : { ...c, userCreated: false as const }))
}

/** Fixed discovery: bounded channels use balanced map mode; All uses full exploration (no slider). */
function withFixedDiscovery(c: Channel): Channel {
  return {
    ...c,
    discovery: c.id === ALL_CHANNEL_ID ? ALL_CHANNEL_DISCOVERY_DEFAULT : CHANNEL_DISCOVERY_DEFAULT,
  }
}

function loadChannels(): Channel[] {
  try {
    const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return ensureAllChannel([])
      const mapped = parsed
        .map(item => normalizeImportedChannel(item))
        .filter((c): c is Channel => c !== null)
        .map(withFixedDiscovery)
      return ensureAllChannel(mapped)
    }
  } catch {}
  /** No stored list yet (first visit). System reset stores a single empty All row instead. */
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
    timePeriods: Array.isArray(o.timePeriods) ? o.timePeriods as string[]
      : typeof o.timePeriod === 'string' && o.timePeriod ? [o.timePeriod]
      : [],
    notes: typeof o.notes === 'string' ? o.notes : undefined,
    regions: Array.isArray(o.regions) ? (o.regions as string[]) : undefined,
    popularity: typeof o.popularity === 'number' ? o.popularity : undefined,
    discovery: typeof o.discovery === 'number' ? o.discovery : undefined,
    playbackPositionMs: typeof o.playbackPositionMs === 'number' ? o.playbackPositionMs : undefined,
    playbackTrackUri: typeof o.playbackTrackUri === 'string' ? o.playbackTrackUri : undefined,
    artists: Array.isArray(o.artists) ? (o.artists as string[]) : undefined,
    artistText: typeof o.artistText === 'string' ? o.artistText : undefined,
    ...(typeof o.userCreated === 'boolean' && { userCreated: o.userCreated }),
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
    if (ch) channels.push(withFixedDiscovery(ch))
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

function peekNextCard(ch: Channel): CardState | null {
  if (ch.currentCard) return ch.currentCard
  if (ch.queue?.length) return ch.queue[0] ?? null
  return null
}

function heardRateLimitReason(src: 'spotify' | 'youtube' | undefined): string {
  const label = src === 'youtube' ? 'YouTube' : 'Spotify'
  return `Replay from your Heard (while ${label} rate limits are active)`
}
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

/** Liked territory — same idea as green dots on the map. */
function isPositiveHeard(entry: HistoryEntry): boolean {
  return (entry.stars ?? 0) >= 3.5
}

/**
 * Stars persisted when leaving a track: explicit star row choice wins; otherwise inferred from
 * listen progress (half-star steps). Implicit scores are capped at 4.5 so a full listen does not
 * record 5★ unless the user taps five stars — use explicit rating for a top score.
 */
function computeRecordedListenStars(
  userStars: number | null,
  durationMs: number,
  positionMs: number,
): number {
  if (userStars != null) return userStars
  if (!(durationMs > 0)) return 0
  const p = Math.min(1, Math.max(0, positionMs) / durationMs)
  const raw = p * 5
  const capped = Math.min(4.5, raw)
  return Math.round(capped * 2) / 2
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

// ── Star rating component ────────────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  size = 'md',
  progress,
}: {
  value: number | null
  onChange: (v: number | null) => void
  size?: 'sm' | 'md' | 'lg'
  /** 0–1: fills stars as the song plays when user hasn't rated yet */
  progress?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const isProgressMode = value === null && hovered === null
  const progressStars = (progress ?? 0) * 5
  const display = hovered ?? value ?? (isProgressMode ? progressStars : 0)
  const fontSize = size === 'lg' ? '2.2rem' : size === 'sm' ? '1.1rem' : '1.6rem'

  return (
    <div
      className="flex"
      onMouseLeave={() => setHovered(null)}
      style={{ gap: '0.15rem' }}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const filled = display >= star ? 1 : display > star - 1 ? display - (star - 1) : 0
        const clipPct = Math.round(filled * 100)
        return (
          <div
            key={star}
            className="relative select-none cursor-pointer"
            style={{ fontSize, lineHeight: 1 }}
          >
            <span className="text-zinc-700">★</span>
            {clipPct > 0 && (
              <span
                className={`absolute inset-0 overflow-hidden ${isProgressMode ? 'text-zinc-400' : 'text-amber-400'}`}
                style={{ clipPath: `inset(0 ${100 - clipPct}% 0 0)` }}
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

const PlayerChannelsToolbar = memo(function PlayerChannelsToolbar({
  channels,
  activeChannelId,
  activeTabRef,
  editingChannelId,
  editingChannelName,
  onEditingChannelNameChange,
  onRenameChannel,
  onFinishRename,
  onCancelRename,
  onSelectChannel,
  onStartRename,
  onDeleteChannel,
  showLoadStarterChannelsPill,
  loadingStartupChannels,
  onLoadStartupChannels,
  starterChannelsTitle,
}: {
  channels: Channel[]
  activeChannelId: string
  activeTabRef: RefObject<HTMLDivElement | null>
  editingChannelId: string | null
  editingChannelName: string
  onEditingChannelNameChange: (name: string) => void
  onRenameChannel: (id: string, name: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
  onSelectChannel: (id: string) => void
  onStartRename: (id: string, name: string) => void
  onDeleteChannel: (id: string) => void
  showLoadStarterChannelsPill: boolean
  loadingStartupChannels: boolean
  onLoadStartupChannels: () => void
  starterChannelsTitle: string
}) {
  return (
    <div
      data-guide="channels"
      className="flex flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-color:rgba(63,63,70,0.65)_transparent] [scrollbar-width:thin] lg:flex-col lg:items-stretch lg:overflow-y-auto lg:overflow-x-visible lg:pb-0 lg:[scrollbar-width:auto] lg:max-h-[min(72vh,560px)]"
      role="toolbar"
      aria-label="Channels"
    >
      {showLoadStarterChannelsPill && (
        <button
          type="button"
          onClick={onLoadStartupChannels}
          disabled={loadingStartupChannels}
          title={starterChannelsTitle}
          className="shrink-0 rounded-full border border-indigo-400/70 bg-indigo-950/60 px-4 py-2 text-sm font-semibold text-indigo-100 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-900/70 disabled:cursor-wait disabled:opacity-60 lg:w-full lg:rounded-xl lg:py-2.5 lg:text-left"
        >
          {loadingStartupChannels ? 'Loading…' : 'Load starter channels'}
        </button>
      )}
      {channels.map(ch => {
        const isActive = ch.id === activeChannelId
        const deletable = channels.length > 1
        return (
          <div
            key={ch.id}
            ref={isActive ? activeTabRef : undefined}
            className="group relative shrink-0 lg:w-full lg:min-w-0"
          >
            {editingChannelId === ch.id ? (
              <input
                className="w-full max-w-[240px] rounded-full border border-zinc-600 bg-zinc-900 px-3.5 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/50 lg:max-w-none lg:rounded-xl lg:py-2"
                value={editingChannelName}
                onChange={e => onEditingChannelNameChange(e.target.value)}
                onBlur={() => {
                  onRenameChannel(ch.id, editingChannelName)
                  onFinishRename()
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onRenameChannel(ch.id, editingChannelName)
                    onFinishRename()
                  }
                  if (e.key === 'Escape') onCancelRename()
                }}
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isActive) onStartRename(ch.id, ch.name)
                  else onSelectChannel(ch.id)
                }}
                aria-pressed={isActive}
                aria-current={isActive ? 'true' : undefined}
                className={`max-w-[240px] rounded-full py-1.5 pl-3.5 text-left text-sm font-semibold transition-colors lg:flex lg:max-w-none lg:w-full lg:items-center lg:rounded-xl lg:py-2 lg:pl-3 ${
                  deletable ? 'pr-9' : 'pr-3.5'
                } ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400/90 ring-offset-2 ring-offset-black lg:ring-offset-zinc-950'
                    : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800'
                }`}
              >
                <span className="block truncate">{ch.name}</span>
              </button>
            )}
            {deletable && (
              <button
                type="button"
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDeleteChannel(ch.id)
                }}
                className={`absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-sm leading-none opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 lg:pointer-events-auto lg:opacity-100 ${
                  isActive
                    ? 'text-zinc-300 hover:bg-white/10 hover:text-red-300'
                    : 'text-zinc-500 hover:bg-red-900/30 hover:text-red-400'
                }`}
                aria-label={`Delete channel ${ch.name}`}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <Link
        href="/channels?new=1"
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-700 bg-zinc-900 text-lg font-light leading-none text-zinc-400 transition-colors hover:border-indigo-500 hover:bg-indigo-950 hover:text-indigo-400 lg:size-9 lg:shrink-0 lg:self-center"
        title="Create a new channel"
        aria-label="Create a new channel"
      >
        +
      </Link>
    </div>
  )
})

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
  /**
   * Per-source cooldowns. Splitting prevents a YouTube quota reset at midnight PT from freezing
   * Spotify (and vice versa); earlier the single `backoffUntil` + `spotifyRateLimitUntil` key
   * conflated the two and silently blocked the non-limited source.
   */
  const [spotifyBackoffUntil, setSpotifyBackoffUntil] = useState<number | null>(null)
  const [youtubeBackoffUntil, setYoutubeBackoffUntil] = useState<number | null>(null)
  const spotifyBackoffUntilRef = useRef<number | null>(null)
  const youtubeBackoffUntilRef = useRef<number | null>(null)
  useEffect(() => {
    spotifyBackoffUntilRef.current = spotifyBackoffUntil
  }, [spotifyBackoffUntil])
  useEffect(() => {
    youtubeBackoffUntilRef.current = youtubeBackoffUntil
  }, [youtubeBackoffUntil])

  const BACKOFF_STORAGE_KEY: Record<'spotify' | 'youtube', string> = {
    spotify: 'spotifyRateLimitUntil',
    youtube: 'youtubeRateLimitUntil',
  }
  /** Current-source (or given source) cooldown expiry, or null if none. */
  const getBackoffUntil = (src?: 'spotify' | 'youtube'): number | null => {
    const s = src ?? sourceRef.current
    return s === 'youtube' ? youtubeBackoffUntilRef.current : spotifyBackoffUntilRef.current
  }
  /** True while the given source (or current source) should not issue new resolve / search calls. */
  const isBackoffActive = (src?: 'spotify' | 'youtube'): boolean => {
    const u = getBackoffUntil(src)
    return Boolean(u && u > Date.now())
  }
  /** Set or clear one source's cooldown in state + localStorage in one step. */
  const setBackoffFor = (src: 'spotify' | 'youtube', until: number | null) => {
    if (src === 'youtube') setYoutubeBackoffUntil(until)
    else setSpotifyBackoffUntil(until)
    try {
      const key = BACKOFF_STORAGE_KEY[src]
      if (until && until > Date.now()) localStorage.setItem(key, String(until))
      else localStorage.removeItem(key)
    } catch {}
  }

  const [spotifyUser, setSpotifyUser] = useState<{ id: string; display_name?: string; product?: string } | null>(null)
  const [playResponse, setPlayResponse] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [genreText, setGenreText] = useState('')
  const [regions, setRegions] = useState<string[]>([])
  const [artists, setArtists] = useState<string[]>([])
  const [artistText, setArtistText] = useState('')
  const [timePeriod, setTimePeriod] = useState('')
  const [popularity, setPopularity] = useState(50)
  const [discovery, setDiscovery] = useState(50)
  const [provider, setProvider] = useState<LLMProvider>('deepseek')
  const [source, setSource] = useState<PlaybackSource>(youtubeOnly ? 'youtube' : DEFAULT_PLAYBACK_SOURCE)
  const [ytSearchesRemaining, setYtSearchesRemaining] = useState<number | null>(null)
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null)
  const [sliderPosition, setSliderPosition] = useState(0)
  const [youtubeDuration, setYoutubeDuration] = useState(0)
  const [currentStars, setCurrentStars] = useState<number | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  /** False until loadSettings runs — prevents persist effects from overwriting localStorage with empty defaults on first paint. */
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  /** Dependency for share recipient: re-run on client navigations to a new `?share=`. */
  const shareQueryKey = searchParams.get('share') ?? ''
  /** Bumps when navigating onto /player (e.g. from /channels) so persist runs without putting `pathname` in persist deps. */
  const [playerRouteGeneration, setPlayerRouteGeneration] = useState(0)
  /** Bumps when user presses Next (etc.) so the play effect re-runs even if the next track has the same URI as before. */
  const [playGeneration, setPlayGeneration] = useState(0)
  /** LLM suggestions not yet looked up on Spotify — resolved one-at-a-time when filling Up Next or starting playback. */
  const [suggestionBuffer, setSuggestionBuffer] = useState<SongSuggestion[]>([])
  const [submittedUris, setSubmittedUris] = useState<Set<string>>(new Set())
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string>('')
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingChannelName, setEditingChannelName] = useState('')
  const [channelSearchText, setChannelSearchText] = useState('')
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  const [careerMode, setCareerMode] = useState<CareerMode | null>(null)
  const careerModeRef = useRef<CareerMode | null>(null)
  const [careerLoading, setCareerLoading] = useState(false)
  const [careerLoadingArtist, setCareerLoadingArtist] = useState<string | null>(null)
  const resolveOneSuggestionRef = useRef<((s: SongSuggestion) => Promise<CardState | null>) | null>(null)
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
  /** Album panel for `auto 100%` width vs intrinsic — skip `albumPan` when the art already fits horizontally. */
  const albumPanelRef = useRef<HTMLDivElement | null>(null)
  /** Bumps on `fullscreenchange` so in-panel career controls stay in sync with element fullscreen. */
  const [careerPanelFsRepaint, setCareerPanelFsRepaint] = useState(0)
  const albumArtIntrinsicRef = useRef<{ w: number; h: number } | null>(null)
  const [albumArtNeedsPan, setAlbumArtNeedsPan] = useState(true)
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
  /** When true, Spotify/YouTube may advance when the track reaches the end. Default off — user clicks Next. */
  const [autoNextAtEnd, setAutoNextAtEnd] = useState(false)
  const autoNextAtEndRef = useRef(false)

  useEffect(() => {
    try {
      const v = localStorage.getItem('earprint-auto-next-at-end')
      if (v === '1') {
        setAutoNextAtEnd(true)
        autoNextAtEndRef.current = true
      }
    } catch {}
  }, [])
  const pendingFadeInRef = useRef(false)
  const channelSwitchingRef = useRef(false)
  const deviceIdRef = useRef<string | null>(null)
  const lastPlayedUriRef = useRef<string | null>(null)
  const trackPlayStartAtRef = useRef<number>(0)
  const expectedTrackEndAtRef = useRef<number>(0)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const playedUrisRef = useRef<Set<string>>(new Set())
  const fetchGenRef = useRef(0)
  const fetchingRef = useRef(false)
  const exploreModeRef = useRef<number>(50)
  const currentStarsRef = useRef<number | null>(null)
  const cardHistoryRef = useRef<HistoryEntry[]>([])
  /** Tracks the user left via Next / queue pick — Prev walks back through this stack. */
  const navBackStackRef = useRef<CardState[]>([])
  const suppressNavPushRef = useRef(false)
  const [navBackDepth, setNavBackDepth] = useState(0)
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
  /** Set by `earprint:enqueue` so returning to /player does not restore stale currentCard from storage. */
  const skipChannelReloadOnPlayerEnterRef = useRef(false)
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

  const recomputeAlbumArtPan = useCallback(() => {
    const el = albumPanelRef.current
    const intr = albumArtIntrinsicRef.current
    if (!el || !intr || intr.w <= 0 || intr.h <= 0) {
      setAlbumArtNeedsPan(true)
      return
    }
    const W = el.clientWidth
    const H = el.clientHeight
    if (W <= 0 || H <= 0) return
    const renderedW = (intr.w / intr.h) * H
    setAlbumArtNeedsPan(renderedW > W + 0.5)
  }, [])

  useEffect(() => {
    const url = currentCard?.track.albumArt
    const isYt = (currentCard?.track.source as string) === 'youtube'
    if (!url || isYt) {
      albumArtIntrinsicRef.current = null
      setAlbumArtNeedsPan(true)
      return
    }
    albumArtIntrinsicRef.current = null
    setAlbumArtNeedsPan(true)
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      albumArtIntrinsicRef.current = { w: img.naturalWidth, h: img.naturalHeight }
      recomputeAlbumArtPan()
    }
    img.onerror = () => {
      if (cancelled) return
      albumArtIntrinsicRef.current = null
      setAlbumArtNeedsPan(true)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [currentCard?.track.albumArt, currentCard?.track.source, recomputeAlbumArtPan])

  useEffect(() => {
    const el = albumPanelRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      recomputeAlbumArtPan()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [recomputeAlbumArtPan])

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
    setSpotifyBackoffUntil(demo.backoffUntil)
    setYoutubeBackoffUntil(null)
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
    setCurrentStars(demo.currentStars)
    currentStarsRef.current = demo.currentStars
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
        timePeriods: timePeriodRef.current ? timePeriodRef.current.split(' and ').filter(Boolean) : [],
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

    navBackStackRef.current = []
    setNavBackDepth(0)
    // Stop playback and clear transient state
    setCurrentCard(nextCurrent); currentCardRef.current = nextCurrent
    setQueue(restoredQueue); queueRef.current = restoredQueue
    setSuggestionBuffer([]); suggestionBufferRef.current = []
    fetchingRef.current = false
    resolvingRef.current = false   // discard any in-flight resolve from the previous channel
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
    const tp = ch.timePeriods?.length ? ch.timePeriods.join(' and ') : (ch.timePeriod ?? ''); setTimePeriod(tp); timePeriodRef.current = tp
    const n = ch.notes ?? ''; setNotes(n); notesRef.current = n;
    const r = ch.regions ?? []; setRegions(r); regionsRef.current = r
    const ar = ch.artists ?? []; setArtists(ar); artistsRef.current = ar
    const at = ch.artistText ?? ''; setArtistText(at); artistTextRef.current = at
    const pop = ch.popularity ?? 50; setPopularity(pop); popularityRef.current = pop
    const disc =
      ch.id === ALL_CHANNEL_ID ? ALL_CHANNEL_DISCOVERY_DEFAULT : CHANNEL_DISCOVERY_DEFAULT
    setDiscovery(disc); exploreModeRef.current = disc

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

    const nextSource = youtubeOnly ? 'youtube' : (ch.source ?? readSettingsSource())
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
      userCreated: true,
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
            userCreated: true,
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

  const updateCurrentChannelNotes = useCallback((newNotes: string) => {
    setNotes(newNotes)
    notesRef.current = newNotes
    setChannels(prev => {
      const id = activeChannelIdRef.current
      const updated = prev.map(ch => ch.id === id ? { ...ch, notes: newNotes } : ch)
      channelsRef.current = updated
      saveChannels(updated)
      return updated
    })
  }, [])

  const createChannelWithNotes = useCallback(async (notes: string) => {
    if (channelSwitchingRef.current) return
    const trimmed = notes.trim()
    const words = trimmed.split(/\s+/).filter(Boolean)
    const name = words.length === 0 ? 'New Channel' : words.slice(0, 4).join(' ').replace(/[,;:]+$/, '')
    const fresh: Channel = {
      id: genChannelId(),
      name,
      isAutoNamed: false,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      currentCard: null,
      queue: [],
      createdAt: Date.now(),
      userCreated: true,
      notes,
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
      if (!isGuideDemo && playerRef.current && hadCurrent && !willPlay) {
        pendingFadeInRef.current = true
      }
    } finally {
      channelSwitchingRef.current = false
    }
  }, [snapshotCurrentChannel, loadChannelIntoState, isGuideDemo, fadeOutCurrentPlayback])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeChannelId])

  const enterCareerMode = useCallback(async (artistName: string) => {
    // Show the artist name immediately while the LLM fetches
    setCareerLoadingArtist(artistName)
    setCareerLoading(true)
    try {
      const cur = currentCardRef.current
      const trackTitle = cur?.track.name ?? ''
      const albumTitle = cur?.track.album ?? ''
      const params = new URLSearchParams({
        artist: artistName,
        source: sourceRef.current ?? 'spotify',
        ...(trackTitle && { track: trackTitle }),
        ...(albumTitle && { album: albumTitle }),
      })
      const res = await fetch(`/api/career-discography?${params}`, { credentials: 'same-origin' })
      const data = (await res.json().catch(() => ({}))) as {
        works?: CareerWork[]
        error?: string
        message?: string
      }
      if (!res.ok) {
        const msg = [data.error, data.message].filter(Boolean).join(' — ') || `HTTP ${res.status}`
        throw new Error(msg)
      }
      const works: CareerWork[] = data.works ?? []
      if (works.length === 0) return

      console.info('[career] works', works.map((w, i) => `${i}: ${w.year} ${w.title}${w.isCurrent ? ' ← CURRENT' : ''}`))
      console.info('[career] track:', trackTitle, '| album:', albumTitle)

      // Pass 0: LLM-marked match (most reliable — works even for YouTube where album='' )
      let currentIndex = works.findIndex(w => w.isCurrent === true)

      if (currentIndex === -1) {
        // Fallback client-side matching for cases where LLM didn't mark isCurrent
        const normalize = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
        const stripEdition = (s: string) =>
          s.replace(/\s*[\(\[].*?[\)\]]/g, '').trim()

        if (cur) {
          const album = normalize(stripEdition(albumTitle))
          const year = cur.track.releaseYear

          let idx = album ? works.findIndex(w => normalize(w.title) === album) : -1

          if (idx === -1 && album.length >= 6) {
            idx = works.findIndex(w => {
              const title = normalize(w.title)
              return title.length >= 6 && (album.includes(title) || title.includes(album))
            })
          }

          if (idx === -1 && year) {
            const yearIdxs = works.reduce<number[]>((acc, w, i) => {
              if (w.year === year) acc.push(i)
              return acc
            }, [])
            if (yearIdxs.length === 1) idx = yearIdxs[0]
          }

          if (idx !== -1) currentIndex = idx
        }
      }

      if (currentIndex === -1) currentIndex = 0

      const cm: CareerMode = { artistName, works, currentIndex }
      navBackStackRef.current = []
      setNavBackDepth(0)
      setCareerMode(cm)
      careerModeRef.current = cm

      // Suspend regular DJ flow
      if (suggestionBufferRef.current.length > 0) {
        setSuggestionBuffer([])
        suggestionBufferRef.current = []
      }
      if (queueRef.current.length > 0) {
        setQueue([])
        queueRef.current = []
      }
    } catch (e) {
      console.error('[career] enterCareerMode error', e)
    } finally {
      setCareerLoading(false)
      setCareerLoadingArtist(null)
    }
  }, [])

  const exitCareerMode = useCallback(() => {
    setCareerMode(null)
    careerModeRef.current = null
  }, [])

  const pushNavBack = useCallback((leaving: CardState | null) => {
    if (suppressNavPushRef.current || !leaving || careerModeRef.current) return
    const stack = navBackStackRef.current
    const key = trackPlayKey(leaving.track)
    if (stack.length > 0 && trackPlayKey(stack[stack.length - 1]!.track) === key) return
    navBackStackRef.current = [...stack, leaving]
    setNavBackDepth(navBackStackRef.current.length)
  }, [])

  const careerGo = useCallback(async (delta: number) => {
    const cm = careerModeRef.current
    if (!cm || delta === 0) return
    const newIndex = cm.currentIndex + delta
    if (newIndex < 0 || newIndex >= cm.works.length) return

    // Record current track in history
    const cur = currentCardRef.current
    if (cur) {
      const userStars = currentStarsRef.current
      const stars = computeRecordedListenStars(userStars, durationRef.current, sliderRef.current)
      const event: ListenEvent = { track: cur.track.name, artist: cur.track.artist, stars, coords: cur.coords }
      const historyEntry: HistoryEntry = {
        ...event,
        albumArt: cur.track.albumArt,
        uri: cur.track.uri ?? null,
        category: cur.category,
        coords: cur.coords,
        source: cur.track.source as PlaybackSource | undefined,
      }
      const base = cardHistoryRef.current
      const existingIdx = base.findIndex(e => e.track === cur.track.name && e.artist === cur.track.artist)
      const newHistory = existingIdx !== -1
        ? base.map((e, i) => i === existingIdx ? historyEntry : e)
        : dedupeHistory([...base, historyEntry])
      setCardHistory(newHistory)
      cardHistoryRef.current = newHistory
      const newSession = existingIdx !== -1
        ? sessionHistoryRef.current.map(e => e.track === cur.track.name && e.artist === cur.track.artist ? event : e)
        : [...sessionHistoryRef.current, event]
      setSessionHistory(newSession)
      sessionHistoryRef.current = newSession
    }

    const newCm = { ...cm, currentIndex: newIndex }
    setCareerMode(newCm)
    careerModeRef.current = newCm

    if (!isGuideDemo) {
      pendingFadeInRef.current = true
      await fadeOutCurrentPlayback()
    }

    const work = cm.works[newIndex]
    const suggestion: SongSuggestion = {
      search: work.search,
      reason: `${cm.artistName} — ${work.title} (${work.year})`,
    }

    setCareerLoading(true)
    setCurrentCard(null)
    currentCardRef.current = null

    try {
      const card = await resolveOneSuggestionRef.current?.(suggestion) ?? null
      if (card) {
        setCurrentCard(card)
        currentCardRef.current = card
        setPlayGeneration(g => g + 1)
        lastPlayedUriRef.current = null
        currentStarsRef.current = null
        setCurrentStars(null)
      }
    } finally {
      setCareerLoading(false)
    }
  }, [dedupeHistory, isGuideDemo, fadeOutCurrentPlayback])

  const goToPreviousCard = useCallback(async () => {
    if (careerModeRef.current) {
      await careerGo(-1)
      return
    }
    const stack = navBackStackRef.current
    if (stack.length === 0) return
    const prev = stack[stack.length - 1]!
    navBackStackRef.current = stack.slice(0, -1)
    setNavBackDepth(navBackStackRef.current.length)
    const cur = currentCardRef.current
    if (cur) {
      queueRef.current = [cur, ...queueRef.current]
      setQueue([...queueRef.current])
    }
    suppressNavPushRef.current = true
    if (!isGuideDemo) {
      pendingFadeInRef.current = true
      await fadeOutCurrentPlayback()
    }
    currentCardRef.current = prev
    setCurrentCard(prev)
    setPlayGeneration(g => g + 1)
    lastPlayedUriRef.current = null
    setCurrentStars(null)
    currentStarsRef.current = null
    suppressNavPushRef.current = false
  }, [careerGo, fadeOutCurrentPlayback, isGuideDemo])

  const prevDisabled = careerMode
    ? careerLoading || careerMode.currentIndex === 0
    : navBackDepth === 0

  useEffect(() => {
    const onFs = () => setCareerPanelFsRepaint(n => n + 1)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleAlbumPanelFullscreen = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const el = albumPanelRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen()
    } else {
      const r = el.requestFullscreen?.bind(el)
      if (r) void r()
      else (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.call(el)
    }
  }, [])

  /**
   * Load startup channels from the server-side factory files the user curated:
   *   - YouTube  → data/factory-channels-youtube.json
   *   - Spotify  → data/factory-channels.json
   *
   * Exposed via the "Load startup channels" button that appears on the player
   * when the only channel is the empty All row (typically after System Reset).
   */
  const [loadingStartupChannels, setLoadingStartupChannels] = useState(false)
  const [startupChannelsError, setStartupChannelsError] = useState<string | null>(null)
  /** Share button state (inline feedback next to the Next button). */
  const [sharingInFlight, setSharingInFlight] = useState(false)
  const [shareStatus, setShareStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const shareToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current)
  }, [])
  const handleLoadStartupChannels = useCallback(async () => {
    if (loadingStartupChannels) return
    setStartupChannelsError(null)
    setLoadingStartupChannels(true)
    const src: PlaybackSource = youtubeOnly ? 'youtube' : sourceRef.current
    try {
      const r = await fetch(`/api/startup-channels?source=${src}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = r.ok ? await r.json() : null
      if (!data?.ok || !Array.isArray(data.channels) || data.channels.length === 0) {
        const reason = data?.reason ?? 'unknown'
        setStartupChannelsError(`No startup channels available (${reason}).`)
        console.warn('[startup-channels] load failed', { reason, source: src })
        return
      }
      const parsed = parseChannelsImport({
        channels: data.channels,
        activeChannelId:
          typeof data.activeChannelId === 'string' ? data.activeChannelId : undefined,
      })
      if (!parsed) {
        setStartupChannelsError('Startup channel file had an unexpected shape.')
        return
      }
      const merged = tagNonAllAsNotUserCreated(ensureAllChannel(parsed.channels.map(withFixedDiscovery)))
      saveChannels(merged)
      setChannels(merged)
      channelsRef.current = merged
      const preferredActive =
        parsed.activeChannelId && merged.some(c => c.id === parsed.activeChannelId)
          ? parsed.activeChannelId
          : merged.find(c => c.id !== ALL_CHANNEL_ID)?.id ?? merged[0].id
      const activeCh = merged.find(c => c.id === preferredActive)
      if (activeCh) {
        loadChannelIntoState(activeCh)
      } else {
        setActiveChannelId(preferredActive)
        activeChannelIdRef.current = preferredActive
        try {
          localStorage.setItem(ACTIVE_CHANNEL_KEY, preferredActive)
        } catch {}
      }
      console.info('[startup-channels] loaded', {
        source: src,
        file: data.file,
        channels: merged.length,
        active: preferredActive,
      })
    } catch (e) {
      console.warn('[startup-channels] error', e)
      setStartupChannelsError('Failed to load startup channels.')
    } finally {
      setLoadingStartupChannels(false)
    }
  }, [loadingStartupChannels, youtubeOnly, loadChannelIntoState])

  /**
   * Build a URL the current user can send to others.
   *
   * POSTs the active channel's settings + the current track to /api/share (Redis REST store),
   * then either invokes the native share sheet or copies the URL to the clipboard.
   * History and queue are intentionally NOT sent — see app/api/share/route.ts.
   */
  const showShareToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setShareStatus({ kind, text })
    if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current)
    shareToastTimerRef.current = setTimeout(() => setShareStatus(null), 3500)
  }, [])
  const showShareToastRef = useRef(showShareToast)
  showShareToastRef.current = showShareToast

  const handleShare = useCallback(async () => {
    if (sharingInFlight) return
    const cur = currentCardRef.current
    if (!cur) {
      showShareToast('err', 'Nothing playing to share.')
      return
    }
    const activeId = activeChannelIdRef.current
    const activeCh = channelsRef.current.find(c => c.id === activeId)
    if (!activeCh) {
      showShareToast('err', 'No active channel.')
      return
    }
    const srcForShare: PlaybackSource =
      (cur.track.source as PlaybackSource | undefined) ??
      activeCh.source ??
      sourceRef.current ??
      DEFAULT_PLAYBACK_SOURCE

    setSharingInFlight(true)
    setShareStatus(null)
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          channel: {
            id: activeCh.id,
            name: activeCh.name,
            isAutoNamed: activeCh.isAutoNamed,
            profile: activeCh.profile,
            createdAt: activeCh.createdAt,
            genres: activeCh.genres,
            genreText: activeCh.genreText,
            timePeriods: activeCh.timePeriods,
            timePeriod: activeCh.timePeriod,
            notes: activeCh.notes,
            regions: activeCh.regions,
            artists: activeCh.artists,
            artistText: activeCh.artistText,
            popularity: activeCh.popularity,
            discovery: activeCh.discovery,
            source: activeCh.source ?? srcForShare,
          },
          track: cur,
          source: srcForShare,
        }),
      })
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string; hint?: string }
      if (!r.ok || !data.ok || !data.id) {
        const reason = data.error ?? `http_${r.status}`
        console.warn('[share] create failed', reason, data.hint ?? '')
        showShareToast('err', 'Share failed. Please try again.')
        return
      }
      const url = `${window.location.origin}/player?share=${encodeURIComponent(data.id)}`
      let didNativeShare = false
      // navigator.share only works on HTTPS / localhost and requires a user gesture —
      // we're inside an onClick so that's fine. Fall back to clipboard otherwise.
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: `${cur.track.name} — ${cur.track.artist}`,
            text: `Listen on ${activeCh.name}`,
            url,
          })
          didNativeShare = true
          showShareToast('ok', 'Shared.')
        } catch (e) {
          // AbortError when the user cancels; fall through to clipboard for other errors.
          if ((e as { name?: string })?.name === 'AbortError') {
            setShareStatus(null)
            return
          }
        }
      }
      if (!didNativeShare) {
        try {
          await navigator.clipboard.writeText(url)
          showShareToast('ok', 'Link copied.')
        } catch (e) {
          console.warn('[share] clipboard failed', e)
          showShareToast('err', `Copy failed. URL: ${url}`)
        }
      }
    } catch (e) {
      console.warn('[share] threw', e)
      showShareToast('err', 'Share failed. Please try again.')
    } finally {
      setSharingInFlight(false)
    }
  }, [sharingInFlight, showShareToast])

  /**
   * Consume a shared link: ?share=<id> on /player.
   *
   * Fetches the payload from /api/share (Redis REST); if the user has no channels yet (only the empty
   * All row), seeds the factory bundle for the shared payload's source first — that way
   * a recipient who never signed in before doesn't land on a blank player. Then it
   * upserts the shared channel (creates it if missing, preserves existing history/queue
   * if the user already has the same channel id) and sets the shared track as the now-
   * playing card so playback starts immediately.
   *
   * After `historyReady`, when `shareQueryKey` or `pathname` changes (incl. client-side
   * navigations), or when only sessionStorage has a pending id (OAuth strip). No one-shot
   * ref latch — that broke React Strict Mode and blocked a second share in the same tab.
   * Async completions are tagged with `shareReceiveEpochRef` so stale responses cannot toast.
   */
  const shareReceiveEpochRef = useRef(0)
  useEffect(() => {
    if (isGuideDemo) return
    if (!historyReady) return
    if (typeof window === 'undefined') return
    // Persistent player stays mounted off-/player; only consume shares on the player route.
    if (!pathname.startsWith('/player')) return

    const toast = showShareToastRef.current

    // 1. URL query takes precedence (user is already signed in).
    // 2. Fall back to sessionStorage, which PersistentPlayerHost writes on mount so the
    //    share survives Spotify's OAuth round-trip (it returns to /player?spotify_login=1,
    //    which strips our param).
    // `parseShareId` strips any junk a share target may have pasted after the id
    // (e.g. iMessage concatenates the navigator.share `text` onto the URL, so
    // `?share=abcdef1234Listen on Foo` becomes the raw query value).
    let shareId = parseShareId(shareQueryKey.length ? shareQueryKey : null)
    let fromSession = false
    if (!shareId) {
      try {
        const raw = sessionStorage.getItem('earprint-pending-share')
        if (raw) {
          const parsed = JSON.parse(raw) as { id?: string; at?: number }
          const sessionId = parseShareId(parsed?.id)
          // 15-minute sanity window — don't apply stale pending shares next week.
          if (
            sessionId &&
            typeof parsed.at === 'number' &&
            Date.now() - parsed.at < 15 * 60 * 1000
          ) {
            shareId = sessionId
            fromSession = true
          }
        }
      } catch {}
    }
    if (!shareId) return

    const epoch = ++shareReceiveEpochRef.current
    console.info('[share] recipient effect start', { shareId, fromSession, epoch })

    const clearPendingShare = () => {
      try {
        sessionStorage.removeItem('earprint-pending-share')
      } catch {}
    }

    let cancelled = false

    const stripShareParam = () => {
      clearPendingShare()
      if (fromSession) return
      try {
        const u = new URL(window.location.href)
        u.searchParams.delete('share')
        window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash)
      } catch {}
    }

    const isStale = () => cancelled || shareReceiveEpochRef.current !== epoch

    type SharePayload = {
      channel: Record<string, unknown>
      track: CardState
      source: PlaybackSource
    }

    void (async () => {
      let payload: SharePayload | null = null
      try {
        const r = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean
          payload?: SharePayload
          error?: string
        }
        if (isStale()) return
        if (!r.ok || !data.ok || !data.payload) {
          console.warn('[share] fetch failed', { status: r.status, error: data.error })
          toast(
            'err',
            data.error === 'not_found'
              ? 'This share link has expired or is invalid.'
              : 'Could not load the shared track.'
          )
          stripShareParam()
          return
        }
        payload = data.payload
        console.info('[share] fetched payload', {
          source: payload.source,
          channelId: (payload.channel as { id?: string })?.id,
          channelName: (payload.channel as { name?: string })?.name,
          trackSource: payload.track?.track?.source,
          trackName: payload.track?.track?.name,
          trackId: payload.track?.track?.id,
        })
      } catch (e) {
        if (isStale()) return
        console.warn('[share] fetch threw', e)
        toast('err', 'Could not load the shared track.')
        stripShareParam()
        return
      }
      if (isStale() || !payload) return

      const sharedSource: PlaybackSource = payload.source === 'youtube' ? 'youtube' : 'spotify'
      const sharedTrack = payload.track
      const sharedChannelRaw = payload.channel

      // New-user onboarding: if the recipient has only the empty All row, seed the factory
      // bundle matching the shared payload's source first. That way they have real neighbours
      // in the channel list, not just the shared one.
      let baseChannels = channelsRef.current
      const hasOnlyAll =
        baseChannels.length === 0 ||
        (baseChannels.length === 1 &&
          baseChannels[0].id === ALL_CHANNEL_ID &&
          (baseChannels[0].cardHistory?.length ?? 0) === 0 &&
          !baseChannels[0].currentCard &&
          (baseChannels[0].queue?.length ?? 0) === 0)
      if (hasOnlyAll) {
        try {
          const r = await fetch(`/api/startup-channels?source=${sharedSource}`, {
            credentials: 'same-origin',
            cache: 'no-store',
          })
          const data = r.ok ? await r.json() : null
          if (data?.ok && Array.isArray(data.channels) && data.channels.length > 0) {
            const parsed = parseChannelsImport({
              channels: data.channels,
              activeChannelId:
                typeof data.activeChannelId === 'string' ? data.activeChannelId : undefined,
            })
            if (parsed) {
              baseChannels = tagNonAllAsNotUserCreated(ensureAllChannel(parsed.channels.map(withFixedDiscovery)))
              saveChannels(baseChannels)
            }
          }
        } catch (e) {
          console.warn('[share] startup-channels seed failed', e)
        }
      }
      if (isStale()) return

      // Upsert the shared channel. If it already exists, keep the user's history/queue —
      // otherwise fresh channel with empty history/queue so the shared track plays cleanly.
      const sharedCh = parseChannelsImport({ channels: [sharedChannelRaw] })?.channels?.[0]
      if (!sharedCh) {
        if (isStale()) return
        console.warn('[share] shared channel had unexpected shape')
        toast('err', 'Shared channel was invalid.')
        stripShareParam()
        return
      }
      // parseChannelsImport forces `discovery` to the bounded default; carry source through.
      if (!sharedCh.source) sharedCh.source = sharedSource

      const existing = baseChannels.find(c => c.id === sharedCh.id)
      let mergedChannels: Channel[]
      if (existing) {
        mergedChannels = baseChannels.map(c => (c.id === sharedCh.id ? c : c))
      } else {
        // Insert after All so it shows up near the start of the tabs list.
        const all = baseChannels.find(c => c.id === ALL_CHANNEL_ID)
        const others = baseChannels.filter(c => c.id !== ALL_CHANNEL_ID)
        const fresh: Channel = {
          id: sharedCh.id,
          name: sharedCh.name,
          isAutoNamed: sharedCh.isAutoNamed ?? false,
          cardHistory: [],
          sessionHistory: [],
          profile: sharedCh.profile ?? '',
          createdAt: typeof sharedCh.createdAt === 'number' ? sharedCh.createdAt : Date.now(),
          genres: sharedCh.genres,
          genreText: sharedCh.genreText,
          timePeriods: sharedCh.timePeriods,
          notes: sharedCh.notes,
          regions: sharedCh.regions,
          artists: sharedCh.artists,
          artistText: sharedCh.artistText,
          popularity: sharedCh.popularity,
          discovery: CHANNEL_DISCOVERY_DEFAULT,
          source: sharedCh.source ?? sharedSource,
          userCreated: false,
        }
        mergedChannels = all ? [all, fresh, ...others] : [fresh, ...others]
      }
      mergedChannels = ensureAllChannel(mergedChannels)
      saveChannels(mergedChannels)
      setChannels(mergedChannels)
      channelsRef.current = mergedChannels

      const targetCh = mergedChannels.find(c => c.id === sharedCh.id)
      if (!targetCh) {
        stripShareParam()
        return
      }

      // Feed the shared track straight to loadChannelIntoState via the channel's currentCard
      // slot. That way the single setCurrentCard happens inside loadChannelIntoState itself —
      // no risk of an intermediate render flashing a stale track, and the play effect fires
      // exactly once with the shared track as the source of truth.
      const cleanForLoad: Channel = {
        ...targetCh,
        currentCard: sharedTrack,
        queue: [],
        playbackPositionMs: undefined,
        playbackTrackUri: undefined,
        // Make sure the channel's audio source matches the shared track's source —
        // otherwise the play effect can't render the YouTube iframe for a YouTube
        // track when the recipient's saved channel has `source: 'spotify'`.
        source: (sharedTrack.track.source as PlaybackSource | undefined) ?? sharedSource,
      }
      console.info('[share] loading into state', {
        channelId: cleanForLoad.id,
        channelSource: cleanForLoad.source,
        currentCardTrackSource: cleanForLoad.currentCard?.track.source,
      })
      loadChannelIntoState(cleanForLoad)
      // Bump playGeneration so the YouTube iframe's `key` changes even when the recipient
      // was already on this channel with a different video: forces a fresh mount instead of
      // leaving the prior iframe paused with stale state.
      setPlayGeneration(g => g + 1)
      lastPlayedUriRef.current = null

      stripShareParam()
      if (isStale()) return
      toast('ok', existing ? 'Playing shared track.' : 'Shared channel added.')
      console.info('[share] applied', {
        id: shareId,
        channel: sharedCh.id,
        track: sharedTrack.track.name,
        trackSource: sharedTrack.track.source,
        activeChannel: activeChannelIdRef.current,
        seededFactory: hasOnlyAll,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [historyReady, isGuideDemo, pathname, shareQueryKey])

  // Auto-clear each source's backoff banner when its cooldown expires (one timer per source).
  useEffect(() => {
    if (isGuideDemo) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const schedule = (src: 'spotify' | 'youtube', until: number | null) => {
      if (!until || until <= Date.now()) return
      timers.push(
        setTimeout(() => {
          if (src === 'youtube') setYoutubeBackoffUntil(null)
          else setSpotifyBackoffUntil(null)
          setError(null)
          try {
            localStorage.removeItem(BACKOFF_STORAGE_KEY[src])
          } catch {}
        }, until - Date.now())
      )
    }
    schedule('spotify', spotifyBackoffUntil)
    schedule('youtube', youtubeBackoffUntil)
    return () => {
      timers.forEach(clearTimeout)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuideDemo, spotifyBackoffUntil, youtubeBackoffUntil])

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  useEffect(() => {
    sourceRef.current = source
  }, [source])

  /**
   * When the active playback source changes (user flipped it in Settings, or a channel with a
   * different `source` was selected), silence the OTHER engine. Without this, the Spotify Web
   * Playback SDK keeps playing whatever was queued while YouTube starts on top of it (or vice
   * versa). Both calls are no-ops when the corresponding player isn't connected yet.
   */
  useEffect(() => {
    if (source === 'youtube') {
      try { playerRef.current?.pause() } catch (err) { console.warn('[source-switch] spotify pause failed', err) }
    } else {
      try { youtubePlayerRef.current?.pause() } catch (err) { console.warn('[source-switch] youtube pause failed', err) }
    }
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
    setSource(youtubeOnly ? 'youtube' : readSettingsSource())
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
      if (!youtubeOnly) {
        const spStored = localStorage.getItem('spotifyRateLimitUntil')
        if (spStored) {
          const until = Number(spStored)
          if (until > Date.now()) setSpotifyBackoffUntil(until)
        }
      }
      const ytStored = localStorage.getItem('youtubeRateLimitUntil')
      if (ytStored) {
        const until = Number(ytStored)
        if (until > Date.now()) setYoutubeBackoffUntil(until)
      }
    } catch {}
    setSettingsHydrated(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** YouTube-only mode must never show Spotify cooldown UI (prop can flip true one tick after `?youtube=1`). */
  useEffect(() => {
    if (!youtubeOnly) return
    setSpotifyBackoffUntil(null)
    setSource('youtube')
  }, [youtubeOnly])

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
    // Must run BEFORE loadChannels(): if the URL carries `?spotify_login=1` or
    // `?youtube_login=1`, this scrubs wrong-source `currentCard` / `queue` items from
    // storage so the hydration below does not boot the player with stale data. The helper
    // is idempotent (module-level flag) so it's safe to call from multiple places.
    applyFreshLoginIfNeeded()
    try {
      localStorage.removeItem('earprint-factory-channels')
    } catch {}
    let chs = loadChannels()
    let activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY) ?? ''

    const oneChannel = chs.length === 1 ? chs[0] : null
    const isEmptyChannel = (c: Channel) =>
      !c.profile &&
      !c.currentCard &&
      (c.queue?.length ?? 0) === 0 &&
      (c.cardHistory?.length ?? 0) === 0
    const isBlankSlate =
      chs.length === 0 ||
      (oneChannel &&
        ((oneChannel.id === ALL_CHANNEL_ID && isEmptyChannel(oneChannel)) ||
          (oneChannel.isAutoNamed && isEmptyChannel(oneChannel))))

    const finalizeChannelHydration = (chsArg: Channel[], activeIdArg: string, doEnsureAllPersist: boolean) => {
      let chsLocal = chsArg
      let activeIdLocal = activeIdArg
      if (doEnsureAllPersist) {
        chsLocal = ensureAllChannel(chsLocal)
        saveChannels(chsLocal)
        localStorage.setItem(ACTIVE_CHANNEL_KEY, activeIdLocal)
      }
      if (!activeIdLocal || !chsLocal.find(c => c.id === activeIdLocal)) {
        activeIdLocal = chsLocal[0].id
        localStorage.setItem(ACTIVE_CHANNEL_KEY, activeIdLocal)
      }

      const active = chsLocal.find(c => c.id === activeIdLocal)!

      if (
        chsLocal.length === 1 &&
        chsLocal[0].id === ALL_CHANNEL_ID &&
        (chsLocal[0].cardHistory?.length ?? 0) === 0 &&
        !chsLocal[0].currentCard
      ) {
        const activeSource = youtubeOnly ? 'youtube' : (active.source ?? readSettingsSource())
        active.currentCard = getMostPopularCard(activeSource)
        saveChannels(chsLocal)
      }

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
        if (active.genres) {
          setGenres(active.genres)
          genresRef.current = active.genres
        }
        if (active.genreText !== undefined) {
          setGenreText(active.genreText)
          genreTextRef.current = active.genreText
        }
        if (active.timePeriods !== undefined || active.timePeriod !== undefined) {
          const tp = active.timePeriods?.length ? active.timePeriods.join(' and ') : (active.timePeriod ?? '')
          setTimePeriod(tp)
          timePeriodRef.current = tp
        }
        if (active.notes !== undefined) {
          setNotes(active.notes)
          notesRef.current = active.notes
        }
        if (active.regions) {
          setRegions(active.regions)
          regionsRef.current = active.regions
        }
        if (active.artists) {
          setArtists(active.artists)
          artistsRef.current = active.artists
        }
        if (active.artistText !== undefined) {
          setArtistText(active.artistText)
          artistTextRef.current = active.artistText
        }
        if (active.popularity !== undefined) {
          setPopularity(active.popularity)
          popularityRef.current = active.popularity
        }
        if (active.discovery !== undefined) {
          setDiscovery(active.discovery)
          exploreModeRef.current = active.discovery
        }

        if (
          nextCurrent &&
          active.playbackTrackUri === nextCurrent.track.uri &&
          typeof active.playbackPositionMs === 'number' &&
          active.playbackPositionMs > 0
        ) {
          pendingPlaybackPositionMsRef.current = clampPlaybackOffsetMs(
            active.playbackPositionMs,
            nextCurrent.track.durationMs,
          )
        } else {
          pendingPlaybackPositionMsRef.current = undefined
        }
      } catch {}

      setChannels(chsLocal)
      channelsRef.current = chsLocal
      setActiveChannelId(activeIdLocal)
      activeChannelIdRef.current = activeIdLocal
      setHistoryReady(true)
    }

    if (chs.length === 0 || isBlankSlate) {
      let legacyHistory: HistoryEntry[] = []
      try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
        if (raw) legacyHistory = JSON.parse(raw)
      } catch {}

      if (legacyHistory.length > 0) {
        const id = genChannelId()
        const name = deriveChannelName(legacyHistory, '') || 'My Music'
        const events = legacyHistory.map(
          ({ track, artist, stars, coords }: { track: string; artist: string; stars?: number | null; coords?: { x: number; y: number } }) => ({
            track,
            artist,
            stars: stars ?? null,
            coords,
          }),
        )
        const ch: Channel = {
          id,
          name,
          isAutoNamed: true,
          cardHistory: legacyHistory,
          sessionHistory: events,
          profile: '',
          currentCard: null,
          queue: [],
          createdAt: Date.now(),
          userCreated: true,
        }
        chs = [ch]
        activeId = id
        finalizeChannelHydration(chs, activeId, true)
        return
      }

      /** System reset (and equivalent): persisted list is exactly one empty All — do not pull factory defaults. */
      let persistedChannelsRaw: string | null = null
      try {
        persistedChannelsRaw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      } catch {
        persistedChannelsRaw = null
      }
      const one = chs.length === 1 ? chs[0] : null
      const allOnlyEmptyWipe =
        persistedChannelsRaw !== null &&
        one &&
        one.id === ALL_CHANNEL_ID &&
        isEmptyChannel(one)
      if (allOnlyEmptyWipe) {
        const activeIdLocal = activeId && chs.some(c => c.id === activeId) ? activeId : chs[0].id
        finalizeChannelHydration(chs, activeIdLocal, true)
        return
      }

      let cancelled = false
      void (async () => {
        let loaded = false
        try {
          // Per-source factory file first (falls back to the shared file server-side when missing).
          const factorySrc = youtubeOnly ? 'youtube' : readSettingsSource()
          const r = await fetch(`/api/factory-defaults?source=${factorySrc}`, { credentials: 'same-origin', cache: 'no-store' })
          const data = r.ok ? await r.json() : null
          if (
            data?.ok &&
            Array.isArray(data.channels) &&
            data.channels.length > 0
          ) {
            const fr = parseChannelsImport({
              channels: data.channels,
              activeChannelId: typeof data.activeChannelId === 'string' ? data.activeChannelId : undefined,
            })
            if (fr) {
              chs = tagNonAllAsNotUserCreated(fr.channels)
              activeId = fr.activeChannelId ?? chs[0].id
              loaded = true
            }
          }
        } catch {
          /* use fallbacks */
        }
        if (cancelled) return
        if (!loaded && isDevFactorySnapshotEnabled()) {
          try {
            const devRaw = localStorage.getItem(DEV_FACTORY_OVERRIDE_STORAGE_KEY)
            if (devRaw) {
              const devResult = parseChannelsImport(JSON.parse(devRaw))
              if (devResult) {
                chs = tagNonAllAsNotUserCreated(devResult.channels)
                activeId = devResult.activeChannelId ?? chs[0].id
                loaded = true
              }
            }
          } catch {
            /* */
          }
        }
        if (!loaded) {
          const result = parseChannelsImport(BUILT_IN_FACTORY_CHANNELS_IMPORT)
          if (result) {
            chs = tagNonAllAsNotUserCreated(result.channels)
            activeId = result.activeChannelId ?? chs[0].id
          } else {
            const id = genChannelId()
            const ch: Channel = {
              id,
              name: 'My Music',
              isAutoNamed: true,
              cardHistory: [],
              sessionHistory: [],
              profile: '',
              currentCard: null,
              queue: [],
              createdAt: Date.now(),
              userCreated: false,
            }
            chs = [ch]
            activeId = id
          }
        }
        if (cancelled) return
        finalizeChannelHydration(chs, activeId, true)
      })()

      return () => {
        cancelled = true
      }
    }

    finalizeChannelHydration(chs, activeId, false)
  }, [dedupeHistory, isGuideDemo, youtubeOnly])

  // Persistent shell: returning from Channels / Settings must re-read localStorage (initial load only runs once).
  const prevPathnameRef = useRef<string | null>(null)
  useEffect(() => {
    if (isGuideDemo) return
    if (!historyReady) return

    const prev = prevPathnameRef.current
    prevPathnameRef.current = pathname

    if (pathname.startsWith('/player') && prev !== null && !prev.startsWith('/player')) {
      setPlayerRouteGeneration(g => g + 1)
    }

    if (!pathname.startsWith('/player')) return
    if (prev === null || prev.startsWith('/player')) return

    const chs = loadChannels()
    if (chs.length === 0) return
    let activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY) ?? ''
    if (!chs.some(c => c.id === activeId)) {
      activeId = chs[0].id
      try {
        localStorage.setItem(ACTIVE_CHANNEL_KEY, activeId)
      } catch {}
    }
    const active = chs.find(c => c.id === activeId)
    if (!active) return

    setChannels(chs)
    channelsRef.current = chs
    setActiveChannelId(activeId)
    activeChannelIdRef.current = activeId
    if (skipChannelReloadOnPlayerEnterRef.current) {
      skipChannelReloadOnPlayerEnterRef.current = false
      return
    }
    loadChannelIntoState(active)
  }, [pathname, historyReady, isGuideDemo, loadChannelIntoState])

  // ── Persist active channel data on change (same snapshot as channel switch — includes DJ settings) ──
  // Only while on /player: the shell keeps this component mounted on /channels / /settings. Playback
  // (e.g. auto-advance) still updates refs there — persisting would write stale non-active channels and
  // overwrite edits the user just saved on the Channels page.
  useEffect(() => {
    if (isGuideDemo) return
    if (!pathname.startsWith('/player')) return
    if (!activeChannelId || typeof window === 'undefined') return
    if (!settingsHydrated || !historyReady) return
    const updated = snapshotCurrentChannel()
    channelsRef.current = updated
    saveChannels(updated)
    setChannels(updated)
  }, [
    playerRouteGeneration,
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
    if (youtubeOnly) {
      console.info('[spotify-sdk] skipping init — youtubeOnly=true')
      return
    }
    if (sdkReadyRef.current) return
    sdkReadyRef.current = true
    console.info('[spotify-sdk] initializing', { source })

    let cancelled = false
    const previousOnReady = window.onSpotifyWebPlaybackSDKReady

    const initSpotifyPlayer = () => {
      if (cancelled) return
      const p = new window.Spotify.Player({
        name: 'Soundings',
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
            autoNextAtEndRef.current &&
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

      if (cancelled) {
        try {
          p.disconnect()
        } catch {
          /* ignore */
        }
        playerRef.current = null
        return
      }
      p.connect()
    }

    const onSdkReady = () => {
      previousOnReady?.()
      initSpotifyPlayer()
    }

    if (window.Spotify?.Player) {
      // SDK already loaded from a previous page visit — call setup directly.
      initSpotifyPlayer()
    } else {
      window.onSpotifyWebPlaybackSDKReady = onSdkReady
      if (!document.getElementById('spotify-sdk')) {
        const script = document.createElement('script')
        script.id = 'spotify-sdk'
        script.src = 'https://sdk.scdn.co/spotify-player.js'
        document.body.appendChild(script)
      }
    }

    return () => {
      cancelled = true
      sdkReadyRef.current = false
      if (window.onSpotifyWebPlaybackSDKReady === onSdkReady) {
        window.onSpotifyWebPlaybackSDKReady = previousOnReady ?? (() => {})
      }
      try {
        playerRef.current?.disconnect()
      } catch {
        /* ignore */
      }
      playerRef.current = null
      deviceIdRef.current = null
      setDeviceId(null)
    }
  }, [isGuideDemo, youtubeOnly])

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
      const endThreshold = Math.max(1000, durationRef.current - 1500)
      if (
        autoNextAtEndRef.current &&
        durationRef.current > 0 &&
        sliderRef.current >= endThreshold
      ) {
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
      // YouTube has its own progress poll — don't fight it with the Spotify animation.
      if ((currentCardRef.current.track.source as string) === 'youtube') return
      const next = Math.min(sliderRef.current + TICK, durationRef.current)
      sliderRef.current = next
      setSliderPosition(next)
      const endThreshold = Math.max(1000, durationRef.current - 1500)
      if (autoNextAtEndRef.current && next >= endThreshold) {
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

      // Wall-clock check: if enough time has passed for the track to have ended while
      // backgrounded (JS timer was frozen), advance now rather than reclaiming the old track.
      if (
        autoNextAtEndRef.current &&
        !autoAdvanceRef.current &&
        expectedTrackEndAtRef.current > 0 &&
        Date.now() >= expectedTrackEndAtRef.current
      ) {
        console.info('visibilitychange: track ended while backgrounded (wall-clock), advancing')
        autoAdvanceRef.current = true
        advanceRef.current?.(true)
        return
      }

      // Track hasn't ended — use SDK getCurrentState() (local, no quota) to sync state
      // and reclaim the device if needed.
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

  // Screen Wake Lock — prevent the device from sleeping while a track is playing.
  // The lock is automatically released when the tab is hidden; re-acquire on return.
  const isPausedForWakeLock = playbackState?.paused ?? true
  useEffect(() => {
    if (isGuideDemo) return
    if (!('wakeLock' in navigator)) return

    const acquire = async () => {
      if (wakeLockRef.current) return
      try {
        const lock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen')
        wakeLockRef.current = lock
        lock.addEventListener('release', () => { wakeLockRef.current = null })
      } catch {
        // Permission denied or not supported — silently ignore
      }
    }

    const release = () => {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }

    if (!isPausedForWakeLock) {
      acquire()
    } else {
      release()
    }

    // Re-acquire after tab returns to foreground (browser releases the lock on hide)
    const onVisible = () => { if (!document.hidden && !isPausedForWakeLock) acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      release()
    }
  }, [isGuideDemo, isPausedForWakeLock])

  /**
   * Cross-page queue handoff. Other pages (notably /ratings) dispatch a window
   * CustomEvent `earprint:enqueue` with an ordered array of CardStates when the
   * user asks to play a History selection. PlayerClient is kept mounted by the
   * persistent host, so it can consume the event live — replacing the current
   * card + queue so the selection plays in order, uninterrupted.
   *
   * The DJ's own queue-topoff only fires when the queue drains, so the entire
   * handed-off list plays through before the LLM gets back in the mix.
   */
  useEffect(() => {
    if (isGuideDemo) return
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ cards: CardState[] }>).detail
      const cards = Array.isArray(detail?.cards) ? detail.cards.filter(Boolean) : []
      if (cards.length === 0) return
      const [first, ...rest] = cards
      // Returning from /ratings (etc.) runs loadChannelIntoState and would restore the old currentCard.
      skipChannelReloadOnPlayerEnterRef.current =
        typeof window !== 'undefined' && !window.location.pathname.startsWith('/player')
      pendingPlaybackPositionMsRef.current = undefined
      // Force the play-on-currentCard effect even when re-selecting the same track.
      lastPlayedUriRef.current = ''
      currentCardRef.current = first
      setCurrentCard(first)
      queueRef.current = rest
      setQueue(rest)
      setCurrentStars(null)
      currentStarsRef.current = null
      console.info('[enqueue] external handoff replaced current + queue', {
        count: cards.length,
        first: `${first.track.name} — ${first.track.artist}`,
      })
    }
    window.addEventListener('earprint:enqueue', handler as EventListener)
    return () => window.removeEventListener('earprint:enqueue', handler as EventListener)
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
    let dId = deviceIdRef.current
    if (!dId) return
    const body =
      typeof positionMs === 'number' && positionMs > 0
        ? { uris: [uri], position_ms: Math.floor(positionMs) }
        : { uris: [uri] }
    const doPlay = async (token: string, device: string) =>
      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const transferToDevice = async (token: string, device: string) => {
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: [device], play: false }),
      }).catch(() => {})
    }

    let res = await doPlay(accessTokenRef.current, dId)
    if (res.status === 401) {
      // Token stale — refresh and retry once
      const data = await fetch('/api/spotify/token').then(r => r.json()).catch(() => ({}))
      if (data.accessToken) {
        accessTokenRef.current = data.accessToken
        res = await doPlay(data.accessToken, dId)
      }
    }
    if (res.status === 404) {
      // Device not yet registered — brief wait (common right after Web Playback `ready`)
      console.warn('playTrack: device not found (404), retrying in 1s…')
      await new Promise(r => setTimeout(r, 1000))
      res = await doPlay(accessTokenRef.current, dId)
    }
    if (res.status === 404) {
      // Stale device_id in memory — resolve current Web Playback device from Spotify API
      const fresh = await fetchWebPlaybackDeviceIdFromSpotifyApi(accessTokenRef.current)
      if (fresh) {
        dId = fresh
        deviceIdRef.current = fresh
        setDeviceId(fresh)
        console.info('playTrack: refreshed device id from GET /me/player/devices, transferring…')
        await transferToDevice(accessTokenRef.current, fresh)
        await new Promise(r => setTimeout(r, 400))
        res = await doPlay(accessTokenRef.current, dId)
      }
    }
    if (res.status === 404) {
      console.warn('playTrack: still 404 after device refresh, one more delay…')
      await new Promise(r => setTimeout(r, 1500))
      res = await doPlay(accessTokenRef.current, dId)
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
        expectedTrackEndAtRef.current = Date.now() + (durationRef.current - sliderRef.current)
      }
    }
  }, [isGuideDemo])

  const togglePlayback = useCallback(() => {
    const ytTrack = (currentCardRef.current?.track.source as string) === 'youtube'
    console.info('[play] togglePlayback', {
      isGuideDemo,
      youtubeTrack: ytTrack,
      paused: playbackState?.paused,
    })
    if (isGuideDemo) {
      setPlaybackState(prev => {
        if (!prev) return prev
        const paused = !prev.paused
        isPausedRef.current = paused
        return { ...prev, paused }
      })
      return
    }
    // YouTube tracks are controlled by the iframe; route directly to the YouTube handle.
    if (ytTrack) {
      const yt = youtubePlayerRef.current
      if (!yt) {
        console.warn('[play] togglePlayback: youtubePlayerRef not ready')
        return
      }
      if (isPausedRef.current) yt.play()
      else yt.pause()
      return
    }
    if (playbackState?.paused) playerRef.current?.resume()
    else playerRef.current?.pause()
  }, [isGuideDemo, playbackState])

  // Play when currentCard changes
  useEffect(() => {
    if (isGuideDemo) return
    if (!currentCard) return
    const isYoutube = (currentCard.track.source as string) === 'youtube'
    // YouTube does not use the Spotify Web Playback SDK, so the deviceId gate must not block it.
    if (!isYoutube && !deviceId) return
    const key = trackPlayKey(currentCard.track)
    if (key === lastPlayedUriRef.current) return
    lastPlayedUriRef.current = key
    playedUrisRef.current.add(key)
    const resumeMs = pendingPlaybackPositionMsRef.current
    pendingPlaybackPositionMsRef.current = undefined
    // YouTube playback handled by the YouTube iframe — reset slider and skip Spotify playTrack.
    // We still explicitly call play() because the iframe's `autoplay=1` is unreliable for fresh
    // cross-origin mounts (Chrome's autoplay policy frequently blocks autoplay-with-sound for
    // new iframes even after a user gesture). The YoutubePlayer handle falls back to postMessage
    // when the JS API isn't attached yet, and latches via pendingPlayRef so onReady can play.
    if (isYoutube) {
      console.info('[play] currentCard → YouTube', { id: currentCard.track.id, name: currentCard.track.name })
      sliderRef.current = 0
      setSliderPosition(0)
      durationRef.current = 0
      setYoutubeDuration(0)
      autoAdvanceRef.current = false
      try {
        youtubePlayerRef.current?.play()
      } catch (err) {
        console.warn('[play] youtube play() threw', err)
      }
      return
    }
    const doPlay = async () => {
      const spotifyUri = currentCard.track.uri
      if (!spotifyUri) {
        console.error('[play] Spotify track missing uri', currentCard.track.id)
        return
      }
      const player = playerRef.current
      if (pendingFadeInRef.current && player) {
        pendingFadeInRef.current = false
        await player.setVolume(0)
        await player.pause()
        await playTrack(spotifyUri, resumeMs)
        await fadeVolume(player, 0, 1)
      } else {
        await playTrack(spotifyUri, resumeMs)
      }
    }
    doPlay().catch(err => {
      console.error('[play] doPlay failed, retrying once', err)
      pendingFadeInRef.current = false
      const spotifyUri = currentCard.track.uri
      if (spotifyUri) {
        playTrack(spotifyUri, resumeMs).catch(e =>
          console.error('[play] retry also failed', e)
        )
      }
    })
  }, [
    currentCard?.track.uri ?? currentCard?.track.id,
    deviceId,
    isGuideDemo,
    playGeneration,
  ])

  // Reset star rating when song changes
  useEffect(() => {
    setCurrentStars(null)
    currentStarsRef.current = null
    autoAdvanceRef.current = false
    expectedTrackEndAtRef.current = 0
  }, [currentCard?.track.uri ?? currentCard?.track.id])

  // Publish now-playing for Constellations graph auto-search
  useEffect(() => {
    if (!currentCard) { writeNowPlayingSnapshot(null); return }
    const stripBrackets = (s: string) => s.replace(/\s*[\[(][^\])\[]*[\])]$/g, '').trim()
    const stripEditionSuffix = (s: string) =>
      s.replace(/\s*[-–—]\s*(remaster(?:ed)?(?:\s*\d{4})?|deluxe(?: edition)?|expanded(?: edition)?|special edition)\b.*$/i, '').trim()
    const cleanTitle = (s: string) => stripEditionSuffix(stripBrackets(s))
    writeNowPlayingSnapshot({
      artist: currentCard.track.artist,
      track: cleanTitle(currentCard.track.name),
      album: currentCard.track.album?.trim() ? cleanTitle(currentCard.track.album.trim()) : undefined,
    })
  }, [currentCard?.track.uri ?? currentCard?.track.id])

  // Seed duration from Spotify track metadata before the Web Playback SDK reports duration (often 0).
  useEffect(() => {
    if (!currentCard) return
    if ((currentCard.track.source as string) === 'youtube') return
    const dm = currentCard.track.durationMs
    if (Number.isFinite(dm) && dm > 0) {
      durationRef.current = dm
    }
  }, [currentCard?.track.uri ?? currentCard?.track.id])

  // ── All-channel merged histories ─────────────────────────────────────────
  // The All channel has no config; instead it learns from every channel's
  // history. When active is ALL, merge sessionHistory / cardHistory from all
  // channels (All's own refs take precedence as freshest). Otherwise return
  // the active channel's live refs unchanged.
  const getDjContextHistories = useCallback((): {
    sessionHistory: ListenEvent[]
    cardHistory: HistoryEntry[]
  } => {
    if (activeChannelIdRef.current !== ALL_CHANNEL_ID) {
      return {
        sessionHistory: sessionHistoryRef.current,
        cardHistory: cardHistoryRef.current,
      }
    }
    const sessionMap = new Map<string, ListenEvent>()
    const cardMap = new Map<string, HistoryEntry>()
    for (const ev of sessionHistoryRef.current) {
      sessionMap.set(`${ev.track}|${ev.artist}`, ev)
    }
    for (const entry of cardHistoryRef.current) {
      cardMap.set(`${entry.track}|${entry.artist}`, entry)
    }
    const perChannelCounts: { id: string; session: number; card: number }[] = []
    for (const ch of channelsRef.current) {
      if (ch.id === ALL_CHANNEL_ID) continue
      const sampledSession = sampleForAllChannel(ch.sessionHistory ?? [])
      const sampledCards = sampleForAllChannel(ch.cardHistory ?? [])
      perChannelCounts.push({
        id: ch.id,
        session: sampledSession.length,
        card: sampledCards.length,
      })
      for (const ev of sampledSession) {
        const key = `${ev.track}|${ev.artist}`
        if (!sessionMap.has(key)) sessionMap.set(key, ev)
      }
      for (const entry of sampledCards) {
        const key = `${entry.track}|${entry.artist}`
        if (!cardMap.has(key)) cardMap.set(key, entry)
      }
    }
    const merged = {
      sessionHistory: Array.from(sessionMap.values()),
      cardHistory: dedupeHistory(Array.from(cardMap.values())),
    }
    console.info(DJQ, 'All channel: merged histories from all channels', {
      channels: channelsRef.current.length,
      sessionEvents: merged.sessionHistory.length,
      cardEntries: merged.cardHistory.length,
      perChannelSample: `recent=${PER_CHANNEL_SAMPLE_RECENT} top=${PER_CHANNEL_SAMPLE_TOP} bottom=${PER_CHANNEL_SAMPLE_BOTTOM}`,
      contributions: perChannelCounts,
    })
    return merged
  }, [dedupeHistory])

  // ── LLM batch: suggestions only (no Spotify) ─────────────────────────────
  const fetchSuggestions = useCallback(
    async (
      sessionHist: ListenEvent[],
      profile: string,
      artistConstraint?: string,
      forceTextSearch?: boolean,
      numSongs?: number
    ): Promise<{ suggestions: SongSuggestion[]; profile?: string; suggestedArtists: string[] }> => {
      // Test-mode fixture is YouTube-only — if source is Spotify, never inject the fixture
      // (it has no Spotify uri, so the resolve step would loop forever trying to play it).
      const testModeForSource =
        youtubeResolveTestActive && sourceRef.current === 'youtube'
      if (testModeForSource) {
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
      const djCardHistory = getDjContextHistories().cardHistory
      const alreadyHeard = [
        ...(cur ? [`${cur.track.name} by ${cur.track.artist}`] : []),
        ...djCardHistory.map(e => `${e.track} by ${e.artist}`),
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
        globalNotes: readSettingsGlobalNotes() || undefined,
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
          // Match testModeForSource above: never advertise YouTube test mode on Spotify
          // requests, or the server will echo a YouTube fixture that breaks playback.
          youtubeResolveTest: testModeForSource,
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
    [youtubeResolveTestActive, getDjContextHistories]
  )

  /** Single Spotify search when a suggestion is promoted to Up Next / now playing. */
  const resolveOneSuggestion = useCallback(async (s: SongSuggestion): Promise<CardState | null> => {
    // Do not preflight on client backoff — stale localStorage spotifyRateLimitUntil can block all
    // resolves while LLM (profileOnly) still works. Rely on HTTP 429 to set backoff.
    //
    // Test-mode gate MUST check `sourceRef.current === 'youtube'` exclusively. Using
    // `|| isYoutubeResolveTestFixtureSuggestion(s)` here caused an infinite flicker on
    // Spotify login: the server echoed a fixture back for profile-only calls whenever
    // `youtubeResolveTest: true` crossed the wire, we'd then hit /api/youtube-resolve-test,
    // get a YouTube-typed track that Spotify can't play, fail, and retry forever.
    const ytResolveTest = youtubeResolveTestActive && sourceRef.current === 'youtube'
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
        // Only advertise test mode to the server when we're actually on YouTube.
        // Otherwise the server's profile-only branch returns a YouTube fixture that
        // breaks Spotify playback. See comment on `ytResolveTest` above.
        youtubeResolveTest: ytResolveTest,
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
  resolveOneSuggestionRef.current = resolveOneSuggestion

  /** Resolve up to `max` suggestions in order (constraint / replace flows). Skips failed lookups. */
  const resolveSuggestionsToCards = useCallback(
    async (list: SongSuggestion[], max: number): Promise<CardState[]> => {
      const out: CardState[] = []
      const seenUris = new Set<string>()
      const excludeUris = new Set<string>([
        ...playedUrisRef.current,
        ...(currentCardRef.current ? [trackPlayKey(currentCardRef.current.track)] : []),
        ...queueRef.current.map(c => trackPlayKey(c.track)),
      ])
      for (const s of list) {
        if (out.length >= max) break
        try {
          const card = await resolveOneSuggestion(s)
          if (!card) continue
          const u = trackPlayKey(card.track)
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
      .sort((a, b) => (b.entry.stars ?? 0) - (a.entry.stars ?? 0))

    const seen = new Set<string>([
      ...playedUrisRef.current,
      ...(currentCardRef.current ? [trackPlayKey(currentCardRef.current.track)] : []),
      ...queueRef.current.map(c => trackPlayKey(c.track)),
    ])

    const candidates = ranked.filter(({ track }) => !seen.has(trackPlayKey(track)))

    if (!currentCardRef.current && candidates.length > 0) {
      const { entry, track } = candidates[0]
      const card: CardState = {
        track,
        reason: heardRateLimitReason(sourceRef.current),
        category: entry.category,
        coords: entry.coords,
      }
      lastPlayedUriRef.current = null
      currentCardRef.current = card
      setCurrentCard(card)
      seen.add(trackPlayKey(track))
      candidates.shift()
    }

    const newQ = [...queueRef.current]
    for (const { entry, track } of candidates) {
      if (newQ.length >= 3) break
      const tk = trackPlayKey(track)
      if (seen.has(tk)) continue
      seen.add(tk)
      newQ.push({
        track,
        reason: heardRateLimitReason(sourceRef.current),
        category: entry.category,
        coords: entry.coords,
      })
    }

    if (
      newQ.length !== queueRef.current.length ||
      newQ.some((c, i) => trackPlayKey(c.track) !== trackPlayKey(queueRef.current[i]!.track))
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
    const { sessionHistory: djSessionHistory, cardHistory: djCardHistory } = getDjContextHistories()
    const payload: Record<string, unknown> = {
      sessionHistory: djSessionHistory,
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
          ...djCardHistory.map(e => `${e.track} by ${e.artist}`),
          ...queueRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
          ...suggestionBufferRef.current.map(s => s.search),
        ]
        return [...new Set(list.map(s => s.trim()).filter(Boolean))]
      })(),
      mode: exploreModeRef.current,
      profileOnly: true,
      accessToken: accessTokenRef.current,
      source: sourceRef.current ?? DEFAULT_PLAYBACK_SOURCE,
      // YouTube test fixture is Spotify-incompatible — gate by source to avoid
      // the profile-only flicker loop on Spotify logins.
      youtubeResolveTest:
        youtubeResolveTestActive && sourceRef.current === 'youtube',
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
  }, [youtubeResolveTestActive, playerConfigDj, youtubeResolveTestFromServer, getDjContextHistories])

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
    if (careerModeRef.current) {
      console.info('fetchToBuffer: skipping — career mode active')
      return
    }
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
    // Constraint path resolves LLM suggestions to tracks on the active source — skip only that source's backoff.
    if (onCards && isBackoffActive()) {
      console.info('fetchToBuffer: skipping constraint path,', sourceRef.current, 'backoff (needs resolve)')
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
    const sentHistory = [...getDjContextHistories().sessionHistory]
    const sentProfile = priorProfileRef.current
    setLoadingQueue(true)
    fetchSuggestions(sentHistory, sentProfile, artistConstraint, forceTextSearch, numSongs)
      .then(async ({ suggestions, profile: newProfile }) => {
        console.info('fetchToBuffer profile update:', newProfile ? 'YES len=' + newProfile.length : 'NO (undefined/empty)')
        if (newProfile) {
          setPriorProfile(newProfile)
          priorProfileRef.current = newProfile
          setProfile(newProfile)
        }
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
          // Scope to the current source — the backoff-expiry effect will auto-clear it.
          setBackoffFor(sourceRef.current, until)
          setError(`${sourceRef.current === 'youtube' ? 'YouTube' : 'Spotify'} is rate limiting requests. Blocked until ${formatRetryTime(waitMs)}.`)
          fillFromHeardWhenRateLimited()
          return
        }

        if (err instanceof AuthError) {
          setError('Authentication error (401). Access token may be invalid or missing.')
          // Spotify AuthError only — YouTube path has no Spotify token; apply to Spotify source.
          setBackoffFor('spotify', Date.now() + 300_000)
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
    getDjContextHistories,
  ])

  /** Pop suggestions and resolve on Spotify one-by-one until we have a track for now playing. */
  const startPlaybackFromSuggestions = useCallback(async () => {
    const resolveChannelId = activeChannelIdRef.current
    while (!currentCardRef.current && suggestionBufferRef.current.length > 0) {
      if (activeChannelIdRef.current !== resolveChannelId) {
        console.info(DJQ, 'startPlaybackFromSuggestions: channel switched mid-resolve, discarding')
        return
      }
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
          setBackoffFor(sourceRef.current, Date.now() + waitMs)
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
    const resolveChannelId = activeChannelIdRef.current
    while (queueRef.current.length < 3 && suggestionBufferRef.current.length > 0) {
      if (activeChannelIdRef.current !== resolveChannelId) {
        console.info(DJQ, 'topUpQueueFromSuggestions: channel switched mid-resolve, discarding')
        return
      }
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
          setBackoffFor(sourceRef.current, Date.now() + waitMs)
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
    const resolveChannelId = activeChannelIdRef.current
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
        // promoteDjPendingByIdOnly returns early for YouTube source, so the message is
        // always about Spotify here.
        setBackoffFor('spotify', Date.now() + waitMs)
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
        ...(currentCardRef.current ? [trackPlayKey(currentCardRef.current.track)] : []),
        ...queueRef.current.map(c => trackPlayKey(c.track)),
      ])

      const cards: CardState[] = []
      for (const t of songs) {
        const u = trackPlayKey(t.track)
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

      if (activeChannelIdRef.current !== resolveChannelId) {
        console.info(DJQ, 'promoteDjPendingByIdOnly: channel switched mid-resolve, discarding results')
        return 'noop'
      }
      console.info(DJQ, 'promoteDjPendingByIdOnly: applying', cards.length, 'cards to player')
      let restCards = cards
      if (!currentCardRef.current) {
        const [first, ...afterFirst] = restCards
        currentCardRef.current = first
        setCurrentCard(first)
        lastPlayedUriRef.current = null
        setCurrentStars(null)
        currentStarsRef.current = null
        seen.add(trackPlayKey(first.track))
        restCards = afterFirst.slice(0, 3)
      }

      const q = [...queueRef.current]
      for (const c of restCards) {
        if (q.length >= 3) break
        const ck = trackPlayKey(c.track)
        if (seen.has(ck)) continue
        seen.add(ck)
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

      // Skip only when the CURRENT source's cooldown is active — YouTube quota must not block Spotify.
      if (isBackoffActive()) {
        console.info(DJQ, 'consume: skipped (', sourceRef.current, 'backoff active)', label)
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
        clientBackoffHint: isBackoffActive(),
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
          isBackoffActive() &&
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
    // Backoff active for the current source: fill from Heard. For YouTube-only (no Spotify token at all) stop here;
    // for Spotify, the LLM profileOnly path must still run to refill the buffer — do NOT return.
    const activeBackoffUntil = source === 'youtube' ? youtubeBackoffUntil : spotifyBackoffUntil
    if (activeBackoffUntil && activeBackoffUntil > Date.now()) {
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
        if (isBackoffActive()) {
          const u = getBackoffUntil()
          console.info(DJQ, 'auto-fill effect: skip consume (', sourceRef.current, 'backoff); scheduling retry', {
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
          clientBackoffHint: isBackoffActive(),
        })
        try {
          await consumeDjSuggestionBuffer({ userInitiated: false })
          console.info(DJQ, 'auto-fill effect: consume done')
        } catch (e) {
          console.warn(DJQ, 'auto-fill effect: consume threw', e)
        }
        return
      }
      // Call LLM when queue or suggestion buffer is running low (≤1 remaining).
      // djInventoryFull + FETCH_COOLDOWN_MS prevent over-requesting.
      if (!loadingQueue && (suggestionBuffer.length <= 1 || queue.length <= 1)) {
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
    spotifyBackoffUntil,
    youtubeBackoffUntil,
    source,
    cooldownTick,
    isGuideDemo,
    consumeDjSuggestionBuffer,
    fillFromHeardWhenRateLimited,
  ])

  // ── Advance to next song: record stars, then move on ──
  const advance = useCallback((playedToEnd = false) => {
    const cur = currentCardRef.current
    if (!cur) return

    pushNavBack(cur)

    const userStars = currentStarsRef.current
    const stars = computeRecordedListenStars(userStars, durationRef.current, sliderRef.current)
    const event: ListenEvent = {
      track: cur.track.name,
      artist: cur.track.artist,
      stars,
      coords: cur.coords,
    }
    const historyEntry: HistoryEntry = {
      ...event,
      albumArt: cur.track.albumArt,
      uri: cur.track.uri ?? null,
      category: cur.category,
      coords: cur.coords,
      source: cur.track.source as PlaybackSource | undefined,
    }
    const base = cardHistoryRef.current
    const existingIdx = base.findIndex(e => e.track === cur.track.name && e.artist === cur.track.artist)
    const newCardHistory = existingIdx !== -1
      ? base.map((e, i) => (i === existingIdx ? historyEntry : e))
      : dedupeHistory([...base, historyEntry])
    setCardHistory(newCardHistory)
    cardHistoryRef.current = newCardHistory
    const newSession = existingIdx !== -1
      ? sessionHistoryRef.current.map(e => e.track === cur.track.name && e.artist === cur.track.artist ? event : e)
      : [...sessionHistoryRef.current, event]
    setSessionHistory(newSession)
    sessionHistoryRef.current = newSession
    if (suggestionBufferRef.current.length === 0) fetchToBuffer()

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
  }, [dedupeHistory, fetchToBuffer, pushNavBack])
  const advanceWithFade = useCallback(async (playedToEnd = false) => {
    const player = playerRef.current
    const isYt = (currentCardRef.current?.track.source as string | undefined) === 'youtube'
    // Only attempt Spotify fade when the SDK is actually connected (deviceId set).
    if (player && !isYt && deviceIdRef.current) {
      pendingFadeInRef.current = true
      // On natural track end the audio will stop on its own — skip the fade-out so
      // we don't cut off the last seconds. Only fade out on manual Next.
      if (!playedToEnd) {
        try {
          await fadeVolume(player, 1, 0)
        } catch {
          // fade failed — proceed to advance anyway
        }
      }
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
    const newSession = newCardHistory.map(({ track, artist, stars, coords }) => ({
      track, artist, stars, coords,
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

  const handleRateHistoryItem = useCallback((index: number, stars: number | null) => {
    const newCardHistory = cardHistoryRef.current.map((e, i) =>
      i === index ? { ...e, stars } : e
    )
    setCardHistory(newCardHistory)
    cardHistoryRef.current = newCardHistory
    sessionHistoryRef.current = newCardHistory.map(({ track, artist, stars, coords }) => ({
      track, artist, stars, coords,
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
      setCurrentStars(null)
      currentStarsRef.current = null
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
        setBackoffFor('spotify', null)
        setError(null)
      } else if (res?.retryAfterMs) {
        const until = Date.now() + res.retryAfterMs + 5_000
        setBackoffFor('spotify', until)
      }
    } finally {
      setSpotifyPingInFlight(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleYoutubePingRetry = useCallback(async () => {
    setSpotifyPingInFlight(true)
    try {
      const res = await fetch('/api/youtube/ping').then(r => r.json()).catch(() => null)
      if (res?.ok) {
        setBackoffFor('youtube', null)
        setError(null)
      } else if (res?.retryAfterMs) {
        const until = Date.now() + res.retryAfterMs + 5_000
        setBackoffFor('youtube', until)
      }
    } finally {
      setSpotifyPingInFlight(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // History-replay currently only supports Spotify tracks (the builder normalizes to
      // `spotify:track:…` URIs). In YouTube mode we bail with a neutral message rather than
      // dangle a Spotify-specific error in front of the user.
      if (sourceRef.current === 'youtube') {
        setPlayResponse('Replaying from Heard is not supported in YouTube mode yet.')
        return
      }
      const track = historyEntryToTrack(entry)
      if (!track) {
        setPlayResponse('Cannot replay: this entry has no valid track id.')
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
      setCurrentStars(null)
      currentStarsRef.current = null
    },
    [playUri]
  )
  const duration = playbackState?.duration ?? 0

  // Banner reflects ONLY the active playback source's cooldown. Use `youtubeOnly` too:
  // `youtubeLocked` flips true in an effect after `?youtube=1`, so the first paint can
  // still have `source === 'spotify'` while Spotify backoff was hydrated from localStorage.
  const rateLimitBannerIsYoutube = youtubeOnly || source === 'youtube'
  const activeBackoffUntilForBanner = rateLimitBannerIsYoutube ? youtubeBackoffUntil : spotifyBackoffUntil
  const spotifyStatusMessage =
    activeBackoffUntilForBanner && activeBackoffUntilForBanner > Date.now()
      ? `${rateLimitBannerIsYoutube ? 'YouTube' : 'Spotify'} rate-limited until ${new Date(activeBackoffUntilForBanner).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null

  const showLoadStarterChannelsPill =
    channels.length > 0 &&
    !hasUserCreatedChannel(channels) &&
    !shouldHideStarterPillForFactoryOnlyList(channels)

  return (
    <div data-guide="full-player" className="min-h-screen min-w-[min(100%,900px)] bg-black text-white flex flex-col overflow-x-hidden">
      {/* Global nav header */}
      <AppHeader />
      <div className="flex flex-1 flex-col min-h-0 px-3 py-3 sm:px-4 sm:py-4 lg:px-8 lg:py-6">
        <div className="mx-auto flex w-full max-w-[min(100%,90rem)] flex-1 flex-col gap-4 min-h-0 lg:grid lg:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)] lg:items-start lg:gap-x-4 lg:gap-y-0 xl:grid-cols-[minmax(13rem,20rem)_minmax(0,1fr)] xl:gap-x-5">
          {channels.length > 0 && (
            <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-11 lg:z-10 lg:max-h-[calc(100dvh-3.5rem)] lg:self-start lg:pr-1">
              <p className="hidden text-[11px] font-semibold uppercase tracking-wide text-zinc-500 lg:block">
                Channels
              </p>
              <div className="shrink-0 rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-2.5 sm:p-3">
                <label htmlFor="channel-notes-prompt" className="mb-1.5 block text-xs font-medium text-zinc-400">
                  New channel
                </label>
                <div className="flex flex-col gap-2">
                  <div className="relative w-full min-w-0">
                    <textarea
                      id="channel-notes-prompt"
                      value={channelSearchText}
                      onChange={e => setChannelSearchText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' || e.shiftKey) return
                        e.preventDefault()
                        if (!channelSearchText.trim()) return
                        void createChannelWithNotes(channelSearchText)
                        setChannelSearchText('')
                      }}
                      placeholder="Genres, artists, era, mood…"
                      rows={1}
                      className="min-h-9 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 pr-8 text-sm leading-snug text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    {channelSearchText.length > 0 && (
                      <button
                        type="button"
                        onPointerDown={e => e.preventDefault()}
                        onClick={() => setChannelSearchText('')}
                        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded text-base leading-none text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        title="Clear"
                        aria-label="Clear"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { void createChannelWithNotes(channelSearchText); setChannelSearchText('') }}
                    disabled={!channelSearchText.trim()}
                    title="Create a new channel with this text"
                    className="h-10 w-full shrink-0 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Create channel
                  </button>
                </div>
              </div>
              <PlayerChannelsToolbar
                channels={channels}
                activeChannelId={activeChannelId}
                activeTabRef={activeTabRef}
                editingChannelId={editingChannelId}
                editingChannelName={editingChannelName}
                onEditingChannelNameChange={setEditingChannelName}
                onRenameChannel={renameChannel}
                onFinishRename={() => setEditingChannelId(null)}
                onCancelRename={() => setEditingChannelId(null)}
                onSelectChannel={id => {
                  exitCareerMode()
                  switchChannel(id)
                }}
                onStartRename={(id, name) => {
                  setEditingChannelId(id)
                  setEditingChannelName(name)
                }}
                onDeleteChannel={deleteChannel}
                showLoadStarterChannelsPill={showLoadStarterChannelsPill}
                loadingStartupChannels={loadingStartupChannels}
                onLoadStartupChannels={handleLoadStartupChannels}
                starterChannelsTitle={`Load starter channels for ${(youtubeOnly || source === 'youtube') ? 'YouTube' : 'Spotify'}`}
              />
            </aside>
          )}
          <div className="flex min-w-0 flex-col flex-1 min-h-0">

      {(careerMode || careerLoadingArtist) && (
        <div className="border-b border-indigo-800/60 bg-indigo-950/70 px-4 py-2 flex w-full max-w-[800px] items-center gap-3">
          <span className="text-xl font-bold text-indigo-200 shrink-0">
            {careerMode?.artistName ?? careerLoadingArtist}
          </span>
          {careerMode && (
            <span className="text-xs text-indigo-500 shrink-0">
              {careerMode.currentIndex + 1} / {careerMode.works.length}
            </span>
          )}
          {careerLoading && <span className="text-xs text-indigo-400 animate-pulse">Loading…</span>}
          <button
            type="button"
            onClick={exitCareerMode}
            className="ml-auto text-xs text-indigo-500 hover:text-indigo-300 transition-colors shrink-0"
          >
            Exit career mode
          </button>
        </div>
      )}
      {startupChannelsError && showLoadStarterChannelsPill && (
        <div className="px-6 py-2 text-xs text-red-400 text-center border-b border-zinc-900">
          {startupChannelsError}
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
              onClick={rateLimitBannerIsYoutube ? handleYoutubePingRetry : handleSpotifyPingRetry}
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
      <div className="flex flex-1 flex-col items-stretch gap-3 overflow-y-auto p-4">

        {/* Single column — player panel + stars/next + session panel */}
        <div className="flex w-full max-w-[800px] flex-col gap-3">

        {/* Player panel — full-bleed album art or YouTube player */}
        <div
          ref={albumPanelRef}
          data-guide="album-panel"
          className="relative rounded-2xl overflow-hidden w-full aspect-[4/3] bg-zinc-900"
          style={{ cursor: currentCard && (currentCard.track.source as string) !== 'youtube' ? 'pointer' : 'default' }}
          onClick={currentCard && (currentCard.track.source as string) !== 'youtube' ? togglePlayback : undefined}
        >
          {/* YouTube player */}
          {currentCard && (currentCard.track.source as string) === 'youtube' && (
            <YoutubePlayer
              key={`${currentCard.track.id}-${playGeneration}`}
              ref={youtubePlayerRef}
              videoId={currentCard.track.id}
              onEnded={() => {
                if (autoNextAtEndRef.current) advanceRef.current?.(true)
              }}
              onPlayerError={code => {
                // Error 5 (HTML5/autoplay) is handled in YoutubePlayer itself (shows tap-to-play overlay).
                // Other errors (2, 100, 101, 150) mean unembeddable — log only; filtering happens at search time.
                console.warn('[player] YouTube unplayable error (not skipping):', code)
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
                animation:
                  playbackState?.paused || !albumArtNeedsPan
                    ? 'none'
                    : 'albumPan 60s ease-in-out infinite alternate',
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
          <div className="absolute inset-0 z-[5] bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

          {/* Loading — connecting to Spotify, or actively fetching the next track; otherwise blank (e.g. new channel before DJ settings) */}
          {/* YouTube mode has no Spotify device to wait on, so we only show the spinner while a queue fetch is in flight. */}
          {!currentCard && !error && (source === 'youtube' ? loadingQueue : (!deviceId || loadingQueue)) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-zinc-400">
              <div className="w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
              <p className="text-sm">{source === 'youtube' || deviceId ? 'Finding your next song…' : 'Connecting to Spotify…'}</p>
            </div>
          )}

          {/* Queue ready but nothing playing yet — show ▶ so the user can start */}
          {!currentCard && !error && !loadingQueue && queue.length > 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <button
                type="button"
                onClick={() => {
                  const [next, ...rest] = queueRef.current
                  if (!next) return
                  currentCardRef.current = next
                  setCurrentCard(next)
                  setQueue(rest)
                  queueRef.current = rest
                }}
                className="text-5xl leading-none text-white/80 hover:text-white transition-colors"
              >
                ▶
              </button>
              <p className="text-sm">{queue.length} track{queue.length !== 1 ? 's' : ''} ready</p>
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
              {/* Bottom controls */}
              <div
                data-guide="track-info"
                className={`absolute bottom-0 left-0 right-0 px-3 sm:px-5 pb-3 sm:pb-5 pt-8 sm:pt-16 z-10 bg-gradient-to-t from-black via-black/90 to-transparent ${
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
                <p className={`truncate transition-all ${careerMode ? 'text-indigo-300 text-xl font-semibold mt-0.5' : 'text-zinc-300 text-sm'}`}>
                  {(currentCard.track.artists && currentCard.track.artists.length > 1)
                    ? currentCard.track.artists.map((a, i) => (
                        <span key={a}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            onClick={() => void enterCareerMode(a)}
                            className={careerMode ? 'hover:text-indigo-100 transition-colors' : 'hover:text-indigo-300 transition-colors'}
                            title={`Follow ${a}'s career`}
                          >{a}</button>
                        </span>
                      ))
                    : <button
                        type="button"
                        onClick={() => void enterCareerMode(currentCard.track.artist)}
                        className={careerMode ? 'hover:text-indigo-100 transition-colors' : 'hover:text-indigo-300 transition-colors'}
                        title={`Follow ${currentCard.track.artist}'s career`}
                      >{currentCard.track.artist}</button>
                  }
                  {(() => {
                    const ry = currentCard.track.releaseYear
                    // Trust Spotify's release year for anything post-1990; only show composition year for classical / pre-1970 jazz standards.
                    const year = (ry && ry > 1990) ? ry : (currentCard.composed ?? ry)
                    return year ? <span className={`ml-2 ${careerMode ? 'text-indigo-500 text-sm font-normal' : 'text-zinc-500'}`}>{year}</span> : null
                  })()}
                </p>
                {currentCard.performer && (
                  <p className="text-zinc-400 text-xs truncate mt-0.5">
                    <span className="text-zinc-600">perf. </span>{currentCard.performer}
                  </p>
                )}
                <p className="text-zinc-400 text-xs italic mt-1 leading-relaxed" title={currentCard.reason}>
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
                    onMouseDown={() => { isSeekingRef.current = true }}
                    onTouchStart={() => { isSeekingRef.current = true }}
                    onChange={e => {
                      const v = Number(e.currentTarget.value)
                      setSliderPosition(v)
                      sliderRef.current = v
                    }}
                    onMouseUp={e => {
                      const v = Number(e.currentTarget.value)
                      isSeekingRef.current = false
                      if ((currentCard.track.source as string) === 'youtube') {
                        youtubePlayerRef.current?.seek(v)
                      } else if (duration > 0 && v >= duration - 1500) {
                        if (autoNextAtEndRef.current) advanceWithFade()
                        else playerRef.current?.seek(v)
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    onTouchEnd={e => {
                      const v = Number(e.currentTarget.value)
                      isSeekingRef.current = false
                      if ((currentCard.track.source as string) === 'youtube') {
                        youtubePlayerRef.current?.seek(v)
                      } else if (duration > 0 && v >= duration - 1500) {
                        if (autoNextAtEndRef.current) advanceWithFade()
                        else playerRef.current?.seek(v)
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    className={`flex-1 cursor-pointer ${(currentCard.track.source as string) === 'youtube' ? 'accent-red-400' : 'accent-[#1DB954]'}`}
                  />
                  <span className="text-zinc-400 text-xs w-8 tabular-nums">
                    {formatMs((currentCard.track.source as string) === 'youtube' ? youtubeDuration : duration)}
                  </span>
                </div>

                </div>
              </div>
            </>
          )}

          {careerMode && (() => {
            if (typeof document === 'undefined') return null
            // Re-read on careerPanelFsRepaint so in-video chrome follows panel / document fullscreen
            const fsEl = document.fullscreenElement
            const panel = albumPanelRef.current
            const inPanelFs = panel != null && fsEl === panel
            const inPageFs = fsEl === document.documentElement
            const inAnyFs = inPanelFs || inPageFs
            const isYouTube = currentCard && (currentCard.track.source as string) === 'youtube'

            if (!inAnyFs) {
              if (currentCard) {
                return (
                  <div
                    className="absolute top-0 right-0 z-[35] p-2 sm:p-3 pointer-events-auto"
                    data-career-panel-fs-tick={careerPanelFsRepaint}
                  >
                    <button
                      type="button"
                      onClick={toggleAlbumPanelFullscreen}
                      className="rounded-lg border border-zinc-600/80 bg-zinc-900/90 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-zinc-200 shadow-sm hover:bg-zinc-800 transition-colors"
                      title={
                        isYouTube
                          ? 'Use this full screen (not YouTube’s) to keep career Back, ←, and Next on top of the video'
                          : 'Full screen the album area so career Back, ←, and Next stay on screen'
                      }
                    >
                      Full screen
                    </button>
                  </div>
                )
              }
              return null
            }

            return (
            <div
              className="absolute inset-0 z-[35] flex flex-col justify-between pointer-events-none"
              data-career-panel-fs-tick={careerPanelFsRepaint}
            >
              <div className="flex items-start justify-between gap-2 p-2 sm:p-3 bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-auto">
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    exitCareerMode()
                  }}
                  className="shrink-0 rounded-lg border border-zinc-600/80 bg-zinc-900/90 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 transition-colors"
                >
                  ← Back
                </button>
                {inPanelFs && currentCard && (
                  <button
                    type="button"
                    onClick={toggleAlbumPanelFullscreen}
                    className="shrink-0 rounded-lg border border-zinc-600/80 bg-zinc-900/90 px-2.5 py-1.5 text-sm font-medium text-zinc-200 shadow-sm hover:bg-zinc-800 transition-colors"
                    title="Exit full screen (panel)"
                    aria-label="Exit full screen for the album and video area"
                  >
                    Exit full
                  </button>
                )}
                {inPageFs && !inPanelFs && currentCard && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      void document.exitFullscreen()
                    }}
                    className="shrink-0 rounded-lg border border-zinc-600/80 bg-zinc-900/90 px-2.5 py-1.5 text-sm font-medium text-zinc-200 shadow-sm hover:bg-zinc-800 transition-colors"
                    title="Leave browser full screen (Esc also works)"
                  >
                    Exit full
                  </button>
                )}
              </div>
              {currentCard && (
                <div className="flex justify-center gap-2 p-2 pb-28 sm:pb-36 pointer-events-auto">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      void goToPreviousCard()
                    }}
                    disabled={prevDisabled}
                    className="flex min-w-[2.75rem] items-center justify-center rounded-full border border-indigo-500/50 bg-indigo-900/95 px-3 py-2.5 text-xl font-bold text-white shadow-lg hover:bg-indigo-800 active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous work in career"
                    title="Previous in career"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      void careerGo(1)
                    }}
                    disabled={careerLoading || careerMode.currentIndex >= careerMode.works.length - 1}
                    className="min-w-[4.5rem] rounded-full bg-white/95 px-4 py-2.5 text-sm font-bold text-black shadow-lg hover:bg-zinc-200 active:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next work in career"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
            )
          })()}
        </div>

        {/* Stars + Next below the panel */}
        {currentCard && (
          <div className="flex flex-col gap-2 px-1 w-full max-w-[800px]">
            <div className="flex items-center gap-3">
            <StarRating
              value={currentStars}
              onChange={v => { setCurrentStars(v); currentStarsRef.current = v }}
              size="lg"
              progress={(() => {
                const dur = (currentCard.track.source as string) === 'youtube' ? youtubeDuration : duration
                return dur > 0 ? Math.min(1, sliderPosition / dur) : 0
              })()}
            />
            <button
              type="button"
              onClick={() => void goToPreviousCard()}
              disabled={prevDisabled}
              className="flex-1 py-3 text-xl font-bold bg-indigo-900 text-white rounded-2xl hover:bg-indigo-800 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => careerMode ? void careerGo(1) : advanceWithFade()}
              disabled={careerLoading || (careerMode ? careerMode.currentIndex >= careerMode.works.length - 1 : false)}
              className="flex-1 py-3 text-xl font-bold bg-white text-black rounded-2xl hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {careerLoading ? '…' : 'Next'}
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={sharingInFlight}
              title="Share current channel and track"
              aria-label="Share current channel and track"
              aria-busy={sharingInFlight}
              className="flex shrink-0 items-center justify-center py-3 px-3 rounded-2xl border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 hover:bg-zinc-900 active:bg-zinc-800 disabled:opacity-60 disabled:cursor-wait transition-colors"
            >
              {sharingInFlight ? (
                <span
                  className="inline-block size-6 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin"
                  aria-hidden
                />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-6"
                  aria-hidden
                >
                  <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
                </svg>
              )}
            </button>
            {loadingQueue && (
              <div className="flex items-center gap-1 text-zinc-400">
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
              </div>
            )}
            </div>
            {shareStatus && (
              <div
                role="status"
                aria-live="polite"
                className={`text-xs pl-0.5 ${
                  shareStatus.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {shareStatus.text}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none pl-0.5">
              <input
                type="checkbox"
                className="accent-zinc-400 rounded border-zinc-600"
                checked={autoNextAtEnd}
                onChange={e => {
                  const v = e.target.checked
                  setAutoNextAtEnd(v)
                  autoNextAtEndRef.current = v
                  try {
                    localStorage.setItem('earprint-auto-next-at-end', v ? '1' : '0')
                  } catch {}
                }}
              />
              Auto-advance when a track ends
            </label>
          </div>
        )}

        {/* Session panel */}
        <div data-guide="sidebar" className="w-full px-4 py-4 border border-zinc-800 rounded-2xl bg-zinc-950">
          <SessionPanel
            queue={queue}
            loadingNext={loadingQueue}
            profile={profile}
            onProfileChange={v => {
              setProfile(v)
              setPriorProfile(v)
              priorProfileRef.current = v
            }}
            pendingSuggestions={suggestionBuffer}
            promotingDjPending={promotingDjPending}
            careerWorks={careerMode?.works}
            careerCurrentIndex={careerMode?.currentIndex}
            careerLoading={careerLoading}
            careerLoadingArtist={careerLoadingArtist}
            onCareerGo={delta => void careerGo(delta)}
            onRemoveQueueItem={(index) => {
              const q = queueRef.current
              if (index < 0 || index >= q.length) return
              const removed = q[index]
              const remaining = q.filter((_, i) => i !== index)
              setQueue(remaining)
              queueRef.current = remaining

              // Deleting from the queue is an implicit "skip this sound" —
              // record a 0.5-star rating so the DJ steers away, unless the
              // track is already in history (don't overwrite existing ratings).
              if (!removed) return
              const base = cardHistoryRef.current
              const alreadyRated = base.some(
                e => e.track === removed.track.name && e.artist === removed.track.artist,
              )
              if (alreadyRated) return
              const event: ListenEvent = {
                track: removed.track.name,
                artist: removed.track.artist,
                stars: 0.5,
                coords: removed.coords,
              }
              const historyEntry: HistoryEntry = {
                ...event,
                albumArt: removed.track.albumArt,
                uri: removed.track.uri ?? null,
                category: removed.category,
                coords: removed.coords,
                source: removed.track.source as PlaybackSource | undefined,
              }
              const newCardHistory = dedupeHistory([...base, historyEntry])
              setCardHistory(newCardHistory)
              cardHistoryRef.current = newCardHistory
              const newSession = [...sessionHistoryRef.current, event]
              setSessionHistory(newSession)
              sessionHistoryRef.current = newSession
              console.info(
                DJQ,
                'queue-remove: recorded 0.5★',
                `${removed.track.name} — ${removed.track.artist}`,
              )
            }}
            onPlayQueueItem={(index) => {
              const q = queueRef.current
              if (index < 0 || index >= q.length) return
              const picked = q[index]
              const remaining = q.filter((_, i) => i !== index)

              pushNavBack(currentCardRef.current)
              currentCardRef.current = picked
              setCurrentCard(picked)
              setQueue(remaining)
              queueRef.current = remaining
              setCurrentStars(null)
              currentStarsRef.current = null
            }}
          />
        </div>

        {/* Constellations graph — below queue/up next */}
        <PlayerConstellationsEmbed
          onNewChannelFromNode={(node) => {
            try {
              sessionStorage.setItem(
                'earprint-pending-constellations-new-channel',
                JSON.stringify({ node, at: Date.now() })
              )
            } catch { /* ignore */ }
          }}
        />

        </div>{/* end single column */}
      </div>

      {/* Footer */}
      <div className="flex w-full max-w-[800px] justify-center border-t border-zinc-900 py-3">
        <div className="flex items-center gap-3 w-full px-4">
          {activeChannelId !== ALL_CHANNEL_ID && (
            <Link
              href="/channels"
              className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors text-center"
            >
              Edit channel
            </Link>
          )}
          <Link
            href={`/ratings?channel=${activeChannelId}`}
            className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors text-center"
          >
            Channel History
          </Link>
          <a href="/status" className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors px-2">Status</a>
        </div>
      </div>

          </div>
        </div>
      </div>
    </div>
  )
}
