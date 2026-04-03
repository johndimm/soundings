'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { SpotifyTrack } from '@/app/lib/spotify'
import { ListenEvent, LLMProvider, SongSuggestion } from '@/app/lib/llm'
import SessionPanel, { HistoryEntry } from './SessionPanel'
import { recordFetch, readStats } from '@/app/lib/callTracker'
import { getGuideDemoState } from '@/app/lib/guideDemo'

const HISTORY_STORAGE_KEY = 'earprint-history'
const SETTINGS_STORAGE_KEY = 'earprint-settings'
const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'

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

interface SavedSettings {
  genres?: string[]
  genreText?: string
  timePeriod?: string
  notes?: string
  regions?: string[]
  popularity?: number
  provider?: LLMProvider
  discovery?: number
}

function loadSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as SavedSettings
  } catch {}
  return {}
}
const RATE_LIMIT_DEFAULT_WAIT_MS = 30_000

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
}

/** Next card that would play (matches loadChannelIntoState queue shift). */
function peekNextCard(ch: Channel): CardState | null {
  if (ch.currentCard) return ch.currentCard
  if (ch.queue?.length) return ch.queue[0] ?? null
  return null
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function buildCombinedNotes(genres: string[], genreText: string, timePeriod: string, notes: string, popularity: number, regions: string[]): string {
  const parts: string[] = []
  if (genres.length > 0) parts.push(`Genres: ${genres.join(', ')}`)
  if (regions.length > 0) parts.push(`World region: ${regions.join(', ')}`)
  if (genreText.trim()) parts.push(`Style: ${genreText.trim()}`)
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

export default function PlayerClient({
  accessToken: initialAccessToken,
  guideDemo,
}: {
  accessToken: string
  guideDemo?: string | null
}) {
  const isGuideDemo = Boolean(guideDemo)
  // ── React state ──────────────────────────────────────────────────────────
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [currentCard, setCurrentCard] = useState<CardState | null>(null)
  const [queue, setQueue] = useState<CardState[]>([])
  const [, setSessionHistory] = useState<ListenEvent[]>([])
  const [cardHistory, setCardHistory] = useState<HistoryEntry[]>([])
  const [, setPriorProfile] = useState('')
  const [profile, setProfile] = useState('')
  const [llmBuffer, setLlmBuffer] = useState<CardState[]>([])
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backoffUntil, setBackoffUntil] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem('spotifyRateLimitUntil')
      if (stored) {
        const until = Number(stored)
        if (until > Date.now()) return until
      }
    } catch {}
    return null
  })
  const [spotifyUser, setSpotifyUser] = useState<{ id: string; display_name?: string; product?: string } | null>(null)
  const [playResponse, setPlayResponse] = useState<string | null>(null)
  const [notes, setNotes] = useState(() => loadSettings().notes ?? '')
  const [genres, setGenres] = useState<string[]>(() => loadSettings().genres ?? [])
  const [genreText, setGenreText] = useState(() => loadSettings().genreText ?? '')
  const [regions, setRegions] = useState<string[]>(() => loadSettings().regions ?? [])
  const [timePeriod, setTimePeriod] = useState(() => loadSettings().timePeriod ?? '')
  const [popularity, setPopularity] = useState(() => loadSettings().popularity ?? 50)
  const [discovery, setDiscovery] = useState(() => loadSettings().discovery ?? 50)
  const [provider, setProvider] = useState<LLMProvider>(() => loadSettings().provider ?? 'deepseek')
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null)
  const [sliderPosition, setSliderPosition] = useState(0)
  const [gradePercent, setGradePercent] = useState(50)
  const [hasRated, setHasRated] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const [pendingSuggestions, setPendingSuggestions] = useState<{ search: string; reason: string }[]>([])
  const [submittedUris, setSubmittedUris] = useState<Set<string>>(new Set())
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string>('')
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingChannelName, setEditingChannelName] = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const settingsInitRef = useRef(false)
  const [cooldownTick, setCooldownTick] = useState(0)
  const cooldownRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [spotifyPingInFlight, setSpotifyPingInFlight] = useState(false)

  const dedupeHistory = useCallback((entries: HistoryEntry[]) => {
    const map = new Map<string, HistoryEntry>()
    entries.forEach(entry => map.set(`${entry.track}|${entry.artist}`, entry))
    return Array.from(map.values())
  }, [])

  // ── Refs ─────────────────────────────────────────────────────────────────
  const accessTokenRef = useRef(initialAccessToken)
  const playerRef = useRef<SpotifyPlayer | null>(null)
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
  const timePeriodRef = useRef('')
  const popularityRef = useRef(50)
  const providerRef = useRef<LLMProvider>('deepseek')
  const sliderRef = useRef(0)
  const durationRef = useRef(0)
  const isPausedRef = useRef(true)
  const advanceRef = useRef<((playedToEnd?: boolean) => void) | null>(null)
  const pendingFadeInRef = useRef(false)
  const channelSwitchingRef = useRef(false)
  const deviceIdRef = useRef<string | null>(null)
  const lastPlayedUriRef = useRef<string | null>(null)
  const playedUrisRef = useRef<Set<string>>(new Set())
  const llmBufferRef = useRef<CardState[]>([])
  const fetchGenRef = useRef(0)
  const fetchingRef = useRef(false)
  const exploreModeRef = useRef<number>(50)
  const gradeRef = useRef(50)
  const hasRatedRef = useRef(false)
  const cardHistoryRef = useRef<HistoryEntry[]>([])
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSuggestionsRef = useRef<{ search: string; reason: string }[]>([])
  const resolvingRef = useRef(false)
  const profileGenRef = useRef(0)
  const channelsRef = useRef<Channel[]>([])
  const activeChannelIdRef = useRef<string>('')
  const lastFetchAtRef = useRef<number>(0)
  const FETCH_COOLDOWN_MS = 15_000
  const pendingPlaybackPositionMsRef = useRef<number | undefined>(undefined)

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
    setLlmBuffer([])
    llmBufferRef.current = []
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
    setHasRated(demo.hasRated)
    hasRatedRef.current = demo.hasRated
    setHistoryReady(true)
    setPendingSuggestions(demo.pendingSuggestions)
    pendingSuggestionsRef.current = demo.pendingSuggestions
    setSubmittedUris(new Set(demo.submittedUris))
    setChannels(demo.channels)
    channelsRef.current = demo.channels
    setActiveChannelId(demo.activeChannelId)
    activeChannelIdRef.current = demo.activeChannelId
    lastPlayedUriRef.current = demo.currentCard.track.uri
    playedUrisRef.current = new Set(demo.cardHistory.map(entry => entry.uri ?? '').filter(Boolean))
    settingsInitRef.current = true
    setSettingsDirty(demo.settingsDirty)
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
        ...ch, name,
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
    setLlmBuffer([]); llmBufferRef.current = []
    setPendingSuggestions([]); pendingSuggestionsRef.current = []
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
    const pop = ch.popularity ?? 50; setPopularity(pop); popularityRef.current = pop
    const disc = ch.discovery ?? 50; setDiscovery(disc); exploreModeRef.current = disc

    setActiveChannelId(ch.id); activeChannelIdRef.current = ch.id
    localStorage.setItem(ACTIVE_CHANNEL_KEY, ch.id)
  }, [dedupeHistory])

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
        if (!isGuideDemo && playerRef.current && hadCurrent) {
          if (willPlay) pendingFadeInRef.current = true
          await fadeVolume(playerRef.current, 1, 0)
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
    [snapshotCurrentChannel, loadChannelIntoState, isGuideDemo]
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
      if (!isGuideDemo && playerRef.current && hadCurrent) {
        await fadeVolume(playerRef.current, 1, 0)
      }
      const saved = snapshotCurrentChannel()
      const updated = [...saved, fresh]
      setChannels(updated)
      channelsRef.current = updated
      saveChannels(updated)
      loadChannelIntoState(fresh)
      if (!isGuideDemo && playerRef.current && hadCurrent && !willPlay) {
        pendingFadeInRef.current = false
        await playerRef.current.setVolume(1)
      }
    } finally {
      channelSwitchingRef.current = false
    }
  }, [snapshotCurrentChannel, loadChannelIntoState, isGuideDemo])

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
        if (!isGuideDemo && playerRef.current && hadCurrent) {
          if (willPlay) pendingFadeInRef.current = true
          await fadeVolume(playerRef.current, 1, 0)
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
    [loadChannelIntoState, isGuideDemo]
  )

  const renameChannel = useCallback((id: string, name: string) => {
    setChannels(prev => {
      const updated = prev.map(ch => ch.id === id ? { ...ch, name: name.trim() || ch.name, isAutoNamed: false } : ch)
      channelsRef.current = updated
      saveChannels(updated)
      return updated
    })
  }, [])

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
    genresRef.current = genres
  }, [genres])

  useEffect(() => {
    regionsRef.current = regions
  }, [regions])

  useEffect(() => {
    genreTextRef.current = genreText
  }, [genreText])

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
    try {
      const s: SavedSettings = { genres, genreText, timePeriod, notes, regions, popularity, provider, discovery }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s))
    } catch {}
  }, [genres, genreText, timePeriod, notes, regions, popularity, provider, discovery, isGuideDemo])

  // Mark settings dirty after initial load
  useEffect(() => {
    if (!settingsInitRef.current) { settingsInitRef.current = true; return }
    setSettingsDirty(true)
  }, [notes, genreText, timePeriod, genres, regions, popularity, discovery])

  // Fetch Spotify user info once on mount
  useEffect(() => {
    if (isGuideDemo) return
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

    // Migrate legacy earprint-history into a default channel
    if (chs.length === 0) {
      let legacyHistory: HistoryEntry[] = []
      try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
        if (raw) legacyHistory = JSON.parse(raw)
      } catch {}
      const id = genChannelId()
      const name = deriveChannelName(legacyHistory, '') || 'My Music'
      const events = legacyHistory.map(({ track, artist, percentListened, reaction, coords }) => ({ track, artist, percentListened, reaction, coords }))
      const ch: Channel = { id, name, isAutoNamed: true, cardHistory: legacyHistory, sessionHistory: events, profile: '', currentCard: null, queue: [], createdAt: Date.now() }
      chs = [ch]
      saveChannels(chs)
      activeId = id
      localStorage.setItem(ACTIVE_CHANNEL_KEY, id)
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

  // ── Persist active channel data on change ─────────────────────────────────
  useEffect(() => {
    if (isGuideDemo) return
    if (!activeChannelId || typeof window === 'undefined') return
    setChannels(prev => {
      const updated = prev.map(ch => {
        if (ch.id !== activeChannelId) return ch
        const autoName = deriveChannelName(cardHistory, profile)
        const name = ch.isAutoNamed && autoName ? autoName : ch.name
        const oldUri = ch.currentCard?.track.uri
        const newUri = currentCard?.track.uri
        const clearPlayback = oldUri !== newUri
        return {
          ...ch,
          name,
          cardHistory,
          profile,
          currentCard,
          queue,
          ...(clearPlayback ? { playbackTrackUri: undefined, playbackPositionMs: undefined } : {}),
        }
      })
      channelsRef.current = updated
      saveChannels(updated)
      return updated
    })
  }, [cardHistory, profile, activeChannelId, currentCard, queue, isGuideDemo])

  // ── Spotify SDK ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (isGuideDemo) return
    if (sdkReadyRef.current) return
    sdkReadyRef.current = true

    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: 'Earprint',
        getOAuthToken: cb => {
          fetch('/api/spotify/token')
            .then(r => r.json())
            .then(d => {
              if (d.accessToken) {
                accessTokenRef.current = d.accessToken
                cb(d.accessToken)
              } else {
                // No valid token — redirect to login rather than passing a stale token
                window.location.href = '/api/auth/login'
              }
            })
            .catch(() => {
              window.location.href = '/api/auth/login'
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
        if (s) setPlaybackState(s as SpotifyPlaybackState)
      })
      p.addListener('initialization_error', () => {
        console.error('Spotify SDK: initialization_error')
        setError('Spotify player failed to initialize.')
      })
      p.addListener('authentication_error', () => {
        console.error('Spotify SDK: authentication_error — redirecting to login')
        playerRef.current?.disconnect()
        window.location.href = '/api/auth/login'
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

  // ── Local progress animation (no Spotify API calls) ──────────────────────
  const autoAdvanceRef = useRef(false)
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
    durationRef.current = playbackState.duration
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
      if (!dId) return
      // If user clicked the Spotify track link, force reclaim regardless of throttle/pause state
      const forceReclaim = openedSpotifyRef.current
      openedSpotifyRef.current = false
      if (!wasPlayingRef.current && !forceReclaim) return
      const now = Date.now()
      if (!forceReclaim && now - lastReclaimRef.current < 10_000) return
      setTimeout(() => {
        if (!isPausedRef.current && !forceReclaim) return
        lastReclaimRef.current = Date.now()
        console.info('visibilitychange: reclaiming device', dId, { forceReclaim })
        fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessTokenRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [dId], play: true }),
        }).catch(() => {})
      }, 800)
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
    if (!res.ok) {
      console.warn('playTrack failed', res.status, uri)
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
    if (currentCard.track.uri === lastPlayedUriRef.current) return
    lastPlayedUriRef.current = currentCard.track.uri
    playedUrisRef.current.add(currentCard.track.uri)
    const resumeMs = pendingPlaybackPositionMsRef.current
    pendingPlaybackPositionMsRef.current = undefined
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
    doPlay()
  }, [currentCard?.track.uri, deviceId, isGuideDemo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset grade slider and rated flag when song changes
  useEffect(() => {
    setGradePercent(50)
    gradeRef.current = 50
    setHasRated(false)
    hasRatedRef.current = false
  }, [currentCard?.track.uri])

  // ── Fetch 3 cards from API ────────────────────────────────────────────────
  const fetchCards = useCallback(
    async (
      sessionHist: ListenEvent[],
      profile: string,
      artistConstraint?: string,
      forceTextSearch?: boolean
    ): Promise<{ cards: CardState[]; profile?: string }> => {
      const alreadyHeard = [
        ...cardHistoryRef.current.map(e => `${e.track} by ${e.artist}`),
        ...queueRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
        ...llmBufferRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
      ]
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
          regionsRef.current
        ),
        alreadyHeard: alreadyHeard.length > 0 ? alreadyHeard : undefined,
        mode: exploreModeRef.current,
      }
      if (forceTextSearch) {
        payload.forceTextSearch = true
      }

      const res = await fetch('/api/next-song', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, accessToken: accessTokenRef.current }),
      })

      if (res.status === 429) {
        const payload = await res.json().catch(() => null)
        const payloadRetry =
          payload && typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : undefined
        recordFetch(3) // pessimistic: assume all 3 Spotify searches fired
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
      const cards: CardState[] = (data.songs ?? []).map(
        (s: { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number }; composed?: number }) => ({
          track: s.track,
          reason: s.reason,
          category: s.category,
          coords: s.coords,
          composed: s.composed,
        })
      )
      recordFetch(cards.length || 1)
      console.info('fetchCards returned N songs', cards.length, cards.map(c => c.track.name))
      console.info('fetchCards profile field:', data.profile ? data.profile.slice(0, 80) + '…' : '(none)')
      return { cards, profile: data.profile }
    },
    []
  )

  // ── Profile-only fetch: LLM call without Spotify lookup ──────────────────
  // Used on each rating: updates profile + populates pendingSuggestions.
  // Spotify resolution happens lazily in resolvePending when songs are needed.
  const fetchProfileOnly = useCallback(() => {
    const gen = ++profileGenRef.current
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
        regionsRef.current
      ),
      alreadyHeard: [
        ...cardHistoryRef.current.map(e => `${e.track} by ${e.artist}`),
        ...queueRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
        ...llmBufferRef.current.map(c => `${c.track.name} by ${c.track.artist}`),
        ...pendingSuggestionsRef.current.map(s => s.search),
      ],
      mode: exploreModeRef.current,
      profileOnly: true,
      accessToken: accessTokenRef.current,
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
          const suggestions = (data.songs as SongSuggestion[]).map(s => ({ search: s.search, reason: s.reason }))
          setPendingSuggestions(suggestions)
          pendingSuggestionsRef.current = suggestions
        }
        setSubmittedUris(new Set(cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean)))
      })
      .catch(() => {})
  }, [])

  // ── Resolve pending suggestions → Spotify lookup → add to buffer ──────────
  const resolvePending = useCallback(() => {
    if (resolvingRef.current) return
    const suggestions = pendingSuggestionsRef.current
    if (suggestions.length === 0) return
    resolvingRef.current = true
    const payload = {
      songsToResolve: suggestions,
      sessionHistory: sessionHistoryRef.current,
      accessToken: accessTokenRef.current,
    }
    fetch('/api/next-song', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        // Clear pending regardless of outcome
        setPendingSuggestions([])
        pendingSuggestionsRef.current = []
        if (!data?.songs) return
        const newCards: CardState[] = (data.songs as { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number }; composed?: number }[])
          .map(s => ({ track: s.track, reason: s.reason, category: s.category, coords: s.coords, composed: s.composed }))
        const excludeUris = new Set<string>([
          ...playedUrisRef.current,
          ...(currentCardRef.current ? [currentCardRef.current.track.uri] : []),
          ...queueRef.current.map(c => c.track.uri),
          ...llmBufferRef.current.map(c => c.track.uri),
        ])
        const fresh = newCards.filter(c => !excludeUris.has(c.track.uri))
        if (fresh.length > 0) {
          const newBuffer = [...llmBufferRef.current, ...fresh]
          setLlmBuffer(newBuffer)
          llmBufferRef.current = newBuffer
        }
      })
      .catch(() => {
        setPendingSuggestions([])
        pendingSuggestionsRef.current = []
      })
      .finally(() => { resolvingRef.current = false })
  }, [])

  // ── Fetch from LLM → append to buffer (last-write-wins via generation counter) ──
  const fetchToBuffer = useCallback(
    (
      artistConstraint?: string,
      forceTextSearch?: boolean,
      onCards?: (cards: CardState[]) => void,
      force = false,
      replaceBuffer = false
    ) => {
    // Synchronous guard: prevent concurrent fetches unless explicitly forced
    // (force is used for constraint changes, retry, and start-fresh)
    if (!force && (fetchingRef.current || resolvingRef.current)) {
      console.info('fetchToBuffer: skipping, fetch or resolve already in flight')
      return
    }

    // Minimum cooldown between fetches to avoid triggering Spotify rate limits.
    // Bypass if the queue is critically empty (nothing playing and nothing queued).
    const queueTotal = (currentCardRef.current ? 1 : 0) + queueRef.current.length
    if (!force && queueTotal >= 2) {
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

    // Client-side pre-flight rate limit check: each fetch costs ~3 Spotify calls.
    // Background fetches skip at 60/30s (2/3 of limit).
    // Forced fetches (constraint changes, retries) skip at 75/30s (5/6 of limit).
    {
      const { log } = readStats()
      const now = Date.now()
      const recent = log.filter(e => e.t >= now - 30_000).reduce((s, e) => s + e.n, 0)
      const threshold = force ? 20 : 15
      if (recent >= threshold) {
        console.info('fetchToBuffer: skipping, approaching Spotify rate limit', recent, '/30s', force ? '(forced)' : '')
        return
      }
    }
    fetchingRef.current = true
    lastFetchAtRef.current = Date.now()
    setSettingsDirty(false)
    const gen = ++fetchGenRef.current
    console.info('fetchToBuffer: firing', { force, gen, queueLen: queueRef.current.length, bufferLen: llmBufferRef.current.length })
    const sentHistory = [...sessionHistoryRef.current]
    const sentProfile = priorProfileRef.current
    setLoadingQueue(true)
    fetchCards(sentHistory, sentProfile, artistConstraint, forceTextSearch)
      .then(({ cards, profile: newProfile }) => {
        // Update profile from every completed fetch — not gated by gen,
        // since a newer fetch superseding song cards still produces a valid profile.
        console.info('fetchToBuffer profile update:', newProfile ? 'YES len=' + newProfile.length : 'NO (undefined/empty)')
        if (newProfile) {
          setPriorProfile(newProfile)
          priorProfileRef.current = newProfile
          setProfile(newProfile)
        }
        setSubmittedUris(new Set(cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean)))

        if (gen !== fetchGenRef.current) return

        // Exclude already-played, current card, queued, and already-buffered URIs
        const excludeUris = new Set<string>([
          ...playedUrisRef.current,
          ...(currentCardRef.current ? [currentCardRef.current.track.uri] : []),
          ...queueRef.current.map(c => c.track.uri),
          ...llmBufferRef.current.map(c => c.track.uri),
        ])
        const seen = new Set<string>()
        const fresh = cards.filter(c => {
          if (seen.has(c.track.uri) || excludeUris.has(c.track.uri)) return false
          seen.add(c.track.uri)
          return true
        })

        if (onCards && fresh.length > 0) {
          onCards(fresh)
        }

        // Replace or append buffer depending on caller intent
        const newBuffer = replaceBuffer ? fresh : [...llmBufferRef.current, ...fresh]
        console.info('fetchToBuffer', replaceBuffer ? 'replaced' : 'appended', fresh.length, 'new cards; buffer length now', newBuffer.length)
        setLlmBuffer(newBuffer)
        llmBufferRef.current = newBuffer

        // Clear only the entries that were sent
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
          setError(`Spotify is rate limiting requests. Blocked until ${formatRetryTime(waitMs)}.`)
          return
        }

        if (err instanceof AuthError) {
          setError('Authentication error (401). Access token may be invalid or missing.')
          const far = Date.now() + 300_000
          setBackoffUntil(far)
          return
        }

        if (gen === fetchGenRef.current && !currentCardRef.current && llmBufferRef.current.length === 0) {
          setError('Could not load songs — LLM may be unavailable. Will retry.')
        }
        // Back off on generic errors (e.g. LLM down) without touching backoffUntil.
        // Re-acquire the fetch lock so finally() doesn't release it, then release after delay.
        fetchingRef.current = true
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current)
        backoffTimerRef.current = setTimeout(() => {
          fetchingRef.current = false
          setLoadingQueue(false)
          setError(null)
        }, RATE_LIMIT_DEFAULT_WAIT_MS)
      })
      .finally(() => {
        // Only the winning generation releases the lock.
        // Non-winning fetches (superseded by a constraint change) must NOT reset
        // fetchingRef — doing so would allow a new fetch to slip past the guard
        // before loadingQueue state has propagated to the next render.
        if (gen === fetchGenRef.current) {
          fetchingRef.current = false
          setLoadingQueue(false)
        }
      })
  }, [fetchCards])

  // ── Pull from buffer to top up queue to 3 ────────────────────────────────
  const fillQueueFromBuffer = useCallback(() => {
    const buf = llmBufferRef.current
    const q = queueRef.current
    const needed = 3 - q.length
    if (needed <= 0 || buf.length === 0) return
    const toAdd = buf.slice(0, needed)
    const remaining = buf.slice(needed)
    const seen = new Set<string>([
      ...playedUrisRef.current,
      ...cardHistoryRef.current.map(e => e.uri ?? '').filter(Boolean),
    ])
    if (currentCardRef.current) {
      seen.add(currentCardRef.current.track.uri)
    }
    q.forEach(card => seen.add(card.track.uri))

    const uniqueToAdd = toAdd.filter(card => {
      if (seen.has(card.track.uri)) return false
      seen.add(card.track.uri)
      return true
    })

    const newQueue = [...q, ...uniqueToAdd]
    console.info(
      'fillQueueFromBuffer adding',
      uniqueToAdd.length,
      'cards from buffer; queue length before',
      q.length,
      'after',
      newQueue.length
    )

    setQueue(newQueue)
    queueRef.current = newQueue
    setLlmBuffer(remaining)
    llmBufferRef.current = remaining
  }, [])

  // ── Auto-fill: start playing, fill queue from buffer, fetch when buffer empty ──
  useEffect(() => {
    if (isGuideDemo) return
    if (!deviceId || !historyReady) return

    if (backoffUntil && backoffUntil > Date.now()) {
      return
    }

    // Nothing playing but buffer has songs → start immediately
    if (!currentCard && llmBuffer.length > 0) {
      const [first, ...rest] = llmBufferRef.current
      currentCardRef.current = first
      setCurrentCard(first)
      setLlmBuffer(rest)
      llmBufferRef.current = rest
      return
    }

    // Queue needs filling and buffer has songs → pull from buffer
    if (queue.length < 3 && llmBuffer.length > 0) {
      fillQueueFromBuffer()
      return
    }

    // Buffer empty and queue needs filling → resolve pending or fetch fresh
    if (!loadingQueue && llmBuffer.length === 0 && (!currentCard || queue.length < 3)) {
      if (pendingSuggestions.length > 0 && !resolvingRef.current) {
        resolvePending()
      } else if (pendingSuggestions.length === 0) {
        fetchToBuffer()
      }
    }
  }, [
    currentCard,
    queue.length,
    llmBuffer.length,
    loadingQueue,
    deviceId,
    historyReady,
    fetchToBuffer,
    fillQueueFromBuffer,
    backoffUntil,
    pendingSuggestions.length,
    resolvePending,
    cooldownTick,
    isGuideDemo,
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
      fetchToBuffer()
    }

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
    setLlmBuffer([])
    llmBufferRef.current = []
    fetchToBuffer(undefined, undefined, undefined, true)
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
    setLlmBuffer([])
    llmBufferRef.current = []
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

  useEffect(() => {
    if (isGuideDemo) return
    if (!constraintInitRef.current) {
      constraintInitRef.current = true
      return
    }
    // Debounce: sliders and text fields fire on every tick/keystroke.
    // Wait 600ms of silence before actually fetching.
    if (constraintDebounceRef.current) clearTimeout(constraintDebounceRef.current)
    constraintDebounceRef.current = setTimeout(() => {
      constraintDebounceRef.current = null
      if (!deviceIdRef.current) return
      setLoadingQueue(true)
      fetchToBuffer(undefined, undefined, cards => {
        handleConstraintResults(cards)
        setLoadingQueue(false)
      }, true)
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genres, genreText, timePeriod, notes, popularity, regions, isGuideDemo])

  // ── Grade handler — log rating, start LLM, but stay on current song ──────
  const handleGradeSubmit = useCallback((value: number) => {
    recordRating(value)
  }, [recordRating])

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    if (isGuideDemo) return
    setError(null)
    fetchToBuffer(undefined, true, undefined, true)
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

  const playUri = useCallback(async (uri: string | null, label: string) => {
    if (isGuideDemo) {
      setPlayResponse(`Guide demo mode: playback disabled for ${label}.`)
      return
    }
    if (!deviceIdRef.current) {
      setPlayResponse('No Spotify device registered yet.')
      return
    }
    if (!uri) {
      setPlayResponse(`No URI available for ${label}.`)
      return
    }

    setPlayResponse(`Requesting playback for ${label}…`)

    try {
      const res = await fetch('/api/play-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uri,
          deviceId: deviceIdRef.current,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPlayResponse(`Playback failed: ${data.error} ${data.status ?? ''}`)
        return
      }
      setPlayResponse('Playback request accepted.')
    } catch (err) {
      setPlayResponse(`Playback error: ${(err as Error).message}`)
    }
  }, [isGuideDemo])

  const handlePlayHistoryItem = useCallback(
    (uri: string | null) => playUri(uri, 'history entry'),
    [playUri]
  )
  const duration = playbackState?.duration ?? 0

  const spotifyStatusMessage =
    backoffUntil && backoffUntil > Date.now()
      ? `Spotify rate-limited until ${new Date(backoffUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null

  return (
    <div data-guide="full-player" className="min-h-screen min-w-[900px] bg-black text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900">
        <h1 className="text-xl font-bold">Earprint</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">LLM</label>
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
          <div className="text-xs text-zinc-400">
            Logged in as {spotifyUser.display_name ?? spotifyUser.id}
            {spotifyUser.product ? ` (${spotifyUser.product})` : ''}
          </div>
        )}
        <div className="flex gap-3 items-center">
          <Link href="/map" target="earprint-map" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Map ↗</Link>
          <a href="/status" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Status</a>
          <a href="/guide.html" target="_blank" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Guide</a>
          <a href="/diary.html" target="_blank" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Diary</a>
<Link href="/api/auth/logout" className="text-xs text-zinc-500 hover:text-white">Logout</Link>
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
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
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
            className="px-2 py-1 text-xs text-zinc-600 hover:text-zinc-300 flex-shrink-0 transition-colors"
          >+ New</button>
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
              onClick={handleSpotifyPingRetry}
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

      {/* Body */}
      <div className="flex flex-row gap-4 p-4 items-start overflow-y-auto flex-1">

        {/* Player panel — full-bleed album art */}
        <div
          data-guide="album-panel"
          className="relative rounded-2xl overflow-hidden flex-shrink-0 w-[340px] bg-zinc-900"
          style={{ height: 580, cursor: currentCard ? 'pointer' : 'default' }}
          onClick={currentCard ? togglePlayback : undefined}
        >
          {/* Album art background */}
          {currentCard?.track.albumArt && (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${currentCard.track.albumArt})`,
                backgroundSize: 'auto 100%',
                backgroundRepeat: 'no-repeat',
                animation: 'albumPan 60s ease-in-out infinite alternate',
              }}
            />
          )}

          {/* Play/pause hover overlay */}
          {currentCard && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200 bg-black/30 z-10 pointer-events-none">
              <span className="text-white text-2xl font-semibold tracking-wide select-none">
                {playbackState?.paused ? 'play' : 'pause'}
              </span>
            </div>
          )}

          {/* Persistent play/pause indicator */}
          {currentCard && (
            <div className="absolute top-3 right-3 z-20 pointer-events-none">
              <span className="text-white text-xl select-none drop-shadow-lg">
                {playbackState?.paused ? '⏸' : '▶'}
              </span>
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />

          {/* Loading — show whenever there's no card and no error */}
          {!currentCard && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-zinc-400">
              <div className="w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
              <p className="text-sm">{deviceId ? 'Finding your next song…' : 'Connecting to Spotify…'}</p>
            </div>
          )}

          {/* Error */}
          {error && !currentCard && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <p className="text-red-400 text-sm text-center px-6">{error}</p>
              <button
                onClick={e => { e.stopPropagation(); handleRetry() }}
                className="text-sm bg-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-700"
              >
                Try again
              </button>
            </div>
          )}

          {currentCard && (
            <>
              {/* Vertical grade slider — right side, aligned with Next button */}
              <div
                data-guide="grade-slider"
                className="absolute right-4 bottom-5 flex flex-col items-center gap-2 z-10"
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
                    height: 180,
                    accentColor: '#ff5f5f',
                    cursor: 'pointer',
                  }}
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
                className="absolute bottom-0 left-0 right-14 px-5 pb-5 pt-8 z-10"
                onClick={e => e.stopPropagation()}
              >
                {/* Track info */}
                <a
                  href={`https://open.spotify.com/track/${currentCard.track.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Spotify"
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
                <p className="text-zinc-400 text-xs italic mt-1 leading-relaxed" title={currentCard.reason}>
                  {currentCard.reason}
                </p>

                {/* Play time slider */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-zinc-400 text-xs w-8 text-right tabular-nums">
                    {formatMs(sliderPosition)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={duration}
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
                      if (duration > 0 && v >= duration * 0.98) {
                        advanceWithFade()
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    onTouchEnd={e => {
                      const v = Number(e.currentTarget.value)
                      isSeekingRef.current = false
                      if (duration > 0 && v >= duration * 0.98) {
                        advanceWithFade()
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    className="flex-1 accent-[#1DB954] cursor-pointer"
                  />
                  <span className="text-zinc-400 text-xs w-8 tabular-nums">
                    {formatMs(duration)}
                  </span>
                </div>

                {/* Next button */}
                <div className="flex items-center gap-4 mt-4">
                  <button
                    onClick={() => advanceWithFade()}
                    className="flex-1 py-4 text-xl font-bold bg-white/20 hover:bg-white/30 active:bg-white/40 text-white rounded-2xl transition-colors"
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
            </>
          )}
        </div>

        {/* Right column: session panel */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">

          {/* Session panel */}
          <div data-guide="sidebar" className="flex-1 px-4 py-4 border border-zinc-800 rounded-2xl bg-zinc-950 min-w-0">
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
            popularity={popularity}
            onPopularityChange={setPopularity}
            discovery={discovery}
            onDiscoveryChange={setDiscovery}
            settingsDirty={settingsDirty}
            onRemoveMultiple={handleRemoveMultiple}
            onRateHistoryItem={handleRateHistoryItem}
            submittedUris={submittedUris}
            pendingSuggestions={pendingSuggestions}
            onRemoveQueueItem={(index) => {
              const q = queueRef.current
              if (index < 0 || index >= q.length) return
              const remaining = q.filter((_, i) => i !== index)
              setQueue(remaining)
              queueRef.current = remaining
            }}
            onPlayQueueItem={(index) => {
              const cur = currentCardRef.current
              const q = queueRef.current
              if (index < 0 || index >= q.length) return
              const picked = q[index]
              const remaining = q.filter((_, i) => i !== index)

              // Log current song as move-on if not yet rated
              if (cur && !hasRatedRef.current) {
                const pct = durationRef.current > 0 ? (sliderRef.current / durationRef.current) * 100 : 0
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
                fetchToBuffer()
              }

              currentCardRef.current = picked
              setCurrentCard(picked)
              setQueue(remaining)
              queueRef.current = remaining
              setHasRated(false)
              hasRatedRef.current = false
            }}
            onPlayHistoryItem={(uri) => handlePlayHistoryItem(uri)}
          />
          </div>
        </div>
      </div>
    </div>
  )
}
