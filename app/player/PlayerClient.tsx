'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { SpotifyTrack } from '@/app/lib/spotify'
import { ListenEvent, LLMProvider, SongSuggestion } from '@/app/lib/llm'
import SessionPanel, { HistoryEntry } from './SessionPanel'
import { recordFetch, readStats } from '@/app/lib/callTracker'

const HISTORY_STORAGE_KEY = 'earprint-history'
const SETTINGS_STORAGE_KEY = 'earprint-settings'

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

export default function PlayerClient({ accessToken: initialAccessToken }: { accessToken: string }) {
  // ── React state ──────────────────────────────────────────────────────────
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [currentCard, setCurrentCard] = useState<CardState | null>(null)
  const [queue, setQueue] = useState<CardState[]>([])
  const [sessionHistory, setSessionHistory] = useState<ListenEvent[]>([])
  const [cardHistory, setCardHistory] = useState<HistoryEntry[]>([])
  const [priorProfile, setPriorProfile] = useState('')
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

  // Restore backoff timer from localStorage on mount
  useEffect(() => {
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
    try {
      const s: SavedSettings = { genres, genreText, timePeriod, notes, regions, popularity, provider, discovery }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s))
    } catch {}
  }, [genres, genreText, timePeriod, notes, regions, popularity, provider, discovery])

  // Fetch Spotify user info once on mount
  useEffect(() => {
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
  }, [])

  // ── Load history from localStorage ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!saved) { setHistoryReady(true); return }
    try {
      const entries: HistoryEntry[] = JSON.parse(saved)
      const deduped = dedupeHistory(entries)
      const events = deduped.map(({ track, artist, percentListened, reaction, coords }) => ({
        track, artist, percentListened, reaction, coords,
      }))
      setCardHistory(deduped)
      cardHistoryRef.current = deduped
      // Load full history as session context for the first LLM call
      setSessionHistory(events)
      sessionHistoryRef.current = events
    } catch {
      // ignore corrupt data
    } finally {
      setHistoryReady(true)
    }
  }, [dedupeHistory])

  // ── Persist history ───────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (cardHistory.length === 0) {
      localStorage.removeItem(HISTORY_STORAGE_KEY)
      return
    }
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(cardHistory))
  }, [cardHistory])

  // ── Spotify SDK ───────────────────────────────────────────────────────────
  useEffect(() => {
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
                cb(accessTokenRef.current)
              }
            })
            .catch(() => cb(accessTokenRef.current))
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
        console.error('Spotify SDK: authentication_error — disconnecting to stop retry loop')
        playerRef.current?.disconnect()
        setError('Spotify authentication failed. Please reload the page.')
      })

      p.connect()
    }

    if (!document.getElementById('spotify-sdk')) {
      const script = document.createElement('script')
      script.id = 'spotify-sdk'
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      document.body.appendChild(script)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local progress animation (no Spotify API calls) ──────────────────────
  const autoAdvanceRef = useRef(false)
  useEffect(() => {
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
  }, [deviceId])

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
  }, [])

  useEffect(() => {
    return () => {
      if (backoffTimerRef.current) {
        clearTimeout(backoffTimerRef.current)
      }
    }
  }, [])

  // ── Play a track ──────────────────────────────────────────────────────────
  const playTrack = useCallback(async (uri: string) => {
    const dId = deviceIdRef.current
    if (!dId) return
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${dId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessTokenRef.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    })
  }, [])

  const togglePlayback = useCallback(() => {
    if (playbackState?.paused) playerRef.current?.resume()
    else playerRef.current?.pause()
  }, [playbackState])

  // Play when currentCard changes
  useEffect(() => {
    if (!currentCard) return
    if (currentCard.track.uri === lastPlayedUriRef.current) return
    lastPlayedUriRef.current = currentCard.track.uri
    playedUrisRef.current.add(currentCard.track.uri)
    const doPlay = async () => {
      const player = playerRef.current
      if (pendingFadeInRef.current && player) {
        pendingFadeInRef.current = false
        await player.setVolume(0)
        await playTrack(currentCard.track.uri)
        await fadeVolume(player, 0, 1)
      } else {
        await playTrack(currentCard.track.uri)
      }
    }
    doPlay()
  }, [currentCard?.track.uri]) // eslint-disable-line react-hooks/exhaustive-deps

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
        (s: { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number } }) => ({
          track: s.track,
          reason: s.reason,
          category: s.category,
          coords: s.coords,
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
        const newCards: CardState[] = (data.songs as { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number } }[])
          .map(s => ({ track: s.track, reason: s.reason, category: s.category, coords: s.coords }))
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
    if (!force && fetchingRef.current) {
      console.info('fetchToBuffer: skipping, fetch already in flight')
      return
    }

    // Client-side pre-flight rate limit check: each fetch costs ~3 Spotify calls.
    // Background fetches skip at 60/30s (2/3 of limit).
    // Forced fetches (constraint changes, retries) skip at 75/30s (5/6 of limit).
    {
      const { log } = readStats()
      const now = Date.now()
      const recent = log.filter(e => e.t >= now - 30_000).reduce((s, e) => s + e.n, 0)
      const threshold = force ? 75 : 60
      if (recent >= threshold) {
        console.info('fetchToBuffer: skipping, approaching Spotify rate limit', recent, '/30s', force ? '(forced)' : '')
        return
      }
    }
    fetchingRef.current = true
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
          const waitMs = err.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS
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
          setError('Could not load songs. Try again.')
        }
        // Back off on generic errors to prevent hammering the API
        const waitMs = RATE_LIMIT_DEFAULT_WAIT_MS
        const until = Date.now() + waitMs
        setBackoffUntil(until)
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current)
        backoffTimerRef.current = setTimeout(() => setBackoffUntil(null), waitMs)
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
    const seen = new Set<string>()
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [genres, genreText, timePeriod, notes, popularity, regions])

  // ── Grade handler — log rating, start LLM, but stay on current song ──────
  const handleGradeSubmit = useCallback((value: number) => {
    recordRating(value)
  }, [recordRating])

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setError(null)
    fetchToBuffer(undefined, true, undefined, true)
  }, [fetchToBuffer])

  const playUri = useCallback(async (uri: string | null, label: string) => {
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
  }, [])

  const handlePlayHistoryItem = useCallback(
    (uri: string | null) => playUri(uri, 'history entry'),
    [playUri]
  )
  const handleSwitchAccount = useCallback(async () => {
    await fetch('/api/auth/logout')
    window.location.href = '/api/auth/login'
  }, [])


  const duration = playbackState?.duration ?? 0

  const spotifyStatusMessage =
    backoffUntil && backoffUntil > Date.now()
      ? `Spotify rate-limited until ${new Date(backoffUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
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
          <button
            onClick={handleSwitchAccount}
            className="text-xs text-zinc-300 hover:text-white transition-colors"
          >
            Switch account
          </button>
          <Link href="/api/auth/logout" className="text-xs text-zinc-500 hover:text-white">Logout</Link>
        </div>
      </div>
      {spotifyStatusMessage && (
        <div className="px-6 py-2 bg-yellow-900 text-yellow-50 text-sm text-center">
          {spotifyStatusMessage} — <a href="/status" className="underline text-yellow-300 text-xs">view call stats</a>
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
                animation: 'albumPan 20s ease-in-out infinite alternate',
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
              {/* Vertical grade slider — right side */}
              <div
                className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 z-10"
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
                <p className="text-zinc-300 text-sm truncate">{currentCard.track.artist}</p>
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
          <div className="flex-1 px-4 py-4 border border-zinc-800 rounded-2xl bg-zinc-950 min-w-0">
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
