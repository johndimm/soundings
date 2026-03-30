'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { SpotifyTrack } from '@/app/lib/spotify'
import { ListenEvent, LLMProvider } from '@/app/lib/llm'
import SessionPanel, { HistoryEntry } from './SessionPanel'

const HISTORY_STORAGE_KEY = 'earprint-history'
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
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function buildCombinedNotes(genres: string[], genreText: string, timePeriod: string, notes: string): string {
  const parts: string[] = []
  if (genres.length > 0) parts.push(`Genres: ${genres.join(', ')}`)
  if (genreText.trim()) parts.push(`Style: ${genreText.trim()}`)
  if (timePeriod.trim()) parts.push(`Time period: ${timePeriod.trim()}`)
  if (notes.trim()) parts.push(notes.trim())
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

export default function PlayerClient({ accessToken }: { accessToken: string }) {
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
  const [backoffUntil, setBackoffUntil] = useState<number | null>(null)
  const [spotifyStatus, setSpotifyStatus] = useState<{
    available: boolean
    retryAfterMs: number
    offline: boolean
  } | null>(null)
  const [spotifyUser, setSpotifyUser] = useState<{ id: string; display_name?: string; product?: string } | null>(null)
  const [playResponse, setPlayResponse] = useState<string | null>(null)
  const [statusVersion, setStatusVersion] = useState(0)
  const [notes, setNotes] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [genreText, setGenreText] = useState('')
  const [timePeriod, setTimePeriod] = useState('')
  const [provider, setProvider] = useState<LLMProvider>('deepseek')
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null)
  const [sliderPosition, setSliderPosition] = useState(0)
  const [gradePercent, setGradePercent] = useState(50)
  const [hasRated, setHasRated] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)

  const dedupeHistory = useCallback((entries: HistoryEntry[]) => {
    const map = new Map<string, HistoryEntry>()
    entries.forEach(entry => map.set(`${entry.track}|${entry.artist}`, entry))
    return Array.from(map.values())
  }, [])

  // ── Refs ─────────────────────────────────────────────────────────────────
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
  const timePeriodRef = useRef('')
  const providerRef = useRef<LLMProvider>('deepseek')
  const sliderRef = useRef(0)
  const durationRef = useRef(0)
  const deviceIdRef = useRef<string | null>(null)
  const lastPlayedUriRef = useRef<string | null>(null)
  const playedUrisRef = useRef<Set<string>>(new Set())
  const llmBufferRef = useRef<CardState[]>([])
  const fetchGenRef = useRef(0)
  const gradeRef = useRef(50)
  const hasRatedRef = useRef(false)
  const cardHistoryRef = useRef<HistoryEntry[]>([])
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  useEffect(() => {
    genresRef.current = genres
  }, [genres])

  useEffect(() => {
    genreTextRef.current = genreText
  }, [genreText])

  useEffect(() => {
    timePeriodRef.current = timePeriod
  }, [timePeriod])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  // Keep refs in sync with state
  useEffect(() => {
    let canceled = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/spotify/status')
        if (!res.ok) throw new Error(`status check failed ${res.status}`)
        const data = await res.json()
        if (!canceled) {
          setSpotifyStatus(data)
        }
      } catch (err) {
        if (!canceled) {
          console.error('failed to fetch Spotify status', err)
        }
      }
    }

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

    fetchStatus()
    fetchUser()
    const interval = setInterval(fetchStatus, 30_000)
    return () => {
      canceled = true
      clearInterval(interval)
    }
  }, [statusVersion])

  // ── Load history from localStorage ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!saved) { setHistoryReady(true); return }
    try {
      const entries: HistoryEntry[] = JSON.parse(saved)
      const deduped = dedupeHistory(entries)
      const events = deduped.map(({ track, artist, percentListened, reaction }) => ({
        track, artist, percentListened, reaction,
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
        getOAuthToken: cb => cb(accessToken),
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
      p.addListener('initialization_error', () => setError('Spotify player failed to initialize.'))
      p.addListener('authentication_error', () => setError('Spotify authentication failed.'))

      p.connect()
    }

    if (!document.getElementById('spotify-sdk')) {
      const script = document.createElement('script')
      script.id = 'spotify-sdk'
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      document.body.appendChild(script)
    }
  }, [accessToken])

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!deviceId) return
    pollRef.current = setInterval(async () => {
      const s = await playerRef.current?.getCurrentState()
      if (s) setPlaybackState(s)
    }, 1000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [deviceId])

  useEffect(() => {
    if (!playbackState || isSeekingRef.current) return
    durationRef.current = playbackState.duration
    setSliderPosition(playbackState.position)
    sliderRef.current = playbackState.position
  }, [playbackState])

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
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    })
  }, [accessToken])

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
    playTrack(currentCard.track.uri)
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
          notesRef.current
        ),
        alreadyHeard: alreadyHeard.length > 0 ? alreadyHeard : undefined,
      }
      if (forceTextSearch) {
        payload.forceTextSearch = true
      }

      const res = await fetch('/api/next-song', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.status === 429) {
        const payload = await res.json().catch(() => null)
        const payloadRetry =
          payload && typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : undefined
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
      (s: { track: SpotifyTrack; reason: string }) => ({ track: s.track, reason: s.reason })
    )
    console.info('fetchCards returned N songs', cards.length, cards.map(c => c.track.name))
      return { cards, profile: data.profile }
    },
    []
  )

  // ── Fetch from LLM → append to buffer (last-write-wins via generation counter) ──
  const fetchToBuffer = useCallback(
    (
      artistConstraint?: string,
      forceTextSearch?: boolean,
      onCards?: (cards: CardState[]) => void
    ) => {
    const gen = ++fetchGenRef.current
    const sentHistory = [...sessionHistoryRef.current]
    const sentProfile = priorProfileRef.current
    setLoadingQueue(true)
    fetchCards(sentHistory, sentProfile, artistConstraint, forceTextSearch)
      .then(({ cards, profile: newProfile }) => {
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
        // Append fresh results to the buffer
        const newBuffer = [...llmBufferRef.current, ...fresh]
        console.info('fetchToBuffer appended', fresh.length, 'new cards; buffer length now', newBuffer.length)
        setLlmBuffer(newBuffer)
        llmBufferRef.current = newBuffer

        // Clear only the entries that were sent
        setSessionHistory(prev => prev.slice(sentHistory.length))
        sessionHistoryRef.current = sessionHistoryRef.current.slice(sentHistory.length)

        if (newProfile) {
          setPriorProfile(newProfile)
          priorProfileRef.current = newProfile
          setProfile(newProfile)
        }
      })
      .catch(err => {
        if (err instanceof RateLimitError) {
          const waitMs = err.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS
          const until = Date.now() + waitMs
          setBackoffUntil(until)
          if (backoffTimerRef.current) {
            clearTimeout(backoffTimerRef.current)
          }
          backoffTimerRef.current = setTimeout(() => setBackoffUntil(null), waitMs)
          setError('Spotify is rate limiting requests. Retrying soon.')
          return
        }

        if (err instanceof AuthError) {
          // Set a long backoff so the auto-fill effect does not re-fire
          // while the page is navigating away.
          const far = Date.now() + 300_000
          setBackoffUntil(far)
          window.location.href = '/'
          return
        }

        if (gen === fetchGenRef.current && !currentCardRef.current && llmBufferRef.current.length === 0) {
          setError('Could not load songs. Try again.')
        }
        setStatusVersion(v => v + 1)

        // Back off on generic errors to prevent hammering the API
        const waitMs = RATE_LIMIT_DEFAULT_WAIT_MS
        const until = Date.now() + waitMs
        setBackoffUntil(until)
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current)
        backoffTimerRef.current = setTimeout(() => setBackoffUntil(null), waitMs)
      })
      .finally(() => {
        if (gen === fetchGenRef.current) setLoadingQueue(false)
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

    // Buffer empty and queue needs filling → fetch
    if (!loadingQueue && llmBuffer.length === 0 && (!currentCard || queue.length < 3)) {
      fetchToBuffer()
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
    }
    const historyEntry: HistoryEntry = {
      ...event,
      albumArt: cur.track.albumArt,
      uri: cur.track.uri,
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

    if (queueRef.current.length < 3) {
      fetchToBuffer()
    } else {
      console.info('recordRating deferred fetch; queue already full', queueRef.current.length)
    }
  }, [dedupeHistory, fetchToBuffer])

  // ── Advance to next song (called by Next button or play-slider-end) ───────
  const advance = useCallback(() => {
    const cur = currentCardRef.current
    if (!cur) return

    // If user never rated, log as move-on and fire LLM
    if (!hasRatedRef.current) {
      const pct = durationRef.current > 0 ? (sliderRef.current / durationRef.current) * 100 : 0
      const event: ListenEvent = {
        track: cur.track.name,
        artist: cur.track.artist,
        percentListened: pct,
        reaction: 'move-on',
      }
      const historyEntry: HistoryEntry = {
        ...event,
        albumArt: cur.track.albumArt,
        uri: cur.track.uri,
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

  const autoAdvanceRef = useRef(false)
  useEffect(() => {
    if (!playbackState || !currentCardRef.current) return
    const endThreshold = Math.max(1000, playbackState.duration * 0.98)
    const nearEnd = playbackState.position >= endThreshold
    if (nearEnd && !playbackState.paused && !isSeekingRef.current) {
      if (!autoAdvanceRef.current) {
        autoAdvanceRef.current = true
        advance()
      }
    } else if (playbackState.position < endThreshold - 1000) {
      autoAdvanceRef.current = false
    }
  }, [advance, playbackState])

  // ── Remove history entries ────────────────────────────────────────────────
  const handleRemoveMultiple = useCallback((indices: number[]) => {
    const indexSet = new Set(indices)
    const newCardHistory = cardHistoryRef.current.filter((_, i) => !indexSet.has(i))
    setCardHistory(newCardHistory)
    cardHistoryRef.current = newCardHistory

    // Rebuild session history from scratch; clear profile so LLM re-learns
    const newSession = newCardHistory.map(({ track, artist, percentListened, reaction }) => ({
      track, artist, percentListened, reaction,
    }))
    setSessionHistory(newSession)
    sessionHistoryRef.current = newSession
    setPriorProfile('')
    priorProfileRef.current = ''
    setQueue([])
    queueRef.current = []
    setLlmBuffer([])
    llmBufferRef.current = []
    fetchToBuffer()
  }, [fetchToBuffer])

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

  useEffect(() => {
    if (!constraintInitRef.current) {
      constraintInitRef.current = true
      return
    }
    setLoadingQueue(true)
    fetchToBuffer(undefined, undefined, cards => {
      handleConstraintResults(cards)
      setLoadingQueue(false)
    })
    // Only the three user-facing constraint values should trigger a queue replacement.
    // fetchToBuffer and handleConstraintResults are stable callbacks and must NOT be
    // listed here — doing so would cause spurious queue replacements on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genres, genreText, timePeriod, notes])

  // ── Grade handler — log rating, start LLM, but stay on current song ──────
  const handleGradeSubmit = useCallback((value: number) => {
    recordRating(value)
  }, [recordRating])

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setError(null)
    fetchToBuffer(undefined, true)
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

  useEffect(() => {
    let canceled = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/spotify/status')
        if (!res.ok) throw new Error(`status check failed ${res.status}`)
        const data = await res.json()
        if (!canceled) {
          setSpotifyStatus(data)
        }
      } catch (err) {
        if (!canceled) {
          console.error('failed to fetch Spotify status', err)
        }
      }
    }

    fetchStatus()
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
    const interval = setInterval(fetchStatus, 30_000)
    return () => {
      canceled = true
      clearInterval(interval)
    }
  }, [])

  const duration = playbackState?.duration ?? 0

  const spotifyStatusMessage =
    spotifyStatus && !spotifyStatus.available
      ? spotifyStatus.offline
        ? `Spotify offline until ${formatRetryTime(spotifyStatus.retryAfterMs)}`
        : `Spotify rate-limited until ${formatRetryTime(spotifyStatus.retryAfterMs)}`
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
        <div className="flex gap-2">
          <button
            onClick={handleSwitchAccount}
            className="text-xs text-zinc-300 hover:text-white transition-colors"
          >
            Switch Spotify account
          </button>
          <Link href="/api/auth/logout" className="text-xs text-zinc-500 hover:text-white">Logout</Link>
        </div>
      </div>
      {spotifyStatusMessage && (
        <div className="px-6 py-2 bg-yellow-900 text-yellow-50 text-sm text-center">
          {spotifyStatusMessage}
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentCard.track.albumArt}
              alt={currentCard.track.album}
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
            />
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
                <p className="text-white font-bold text-lg truncate leading-tight">
                  {currentCard.track.name}
                </p>
                <p className="text-zinc-300 text-sm truncate">{currentCard.track.artist}</p>
                <p className="text-zinc-400 text-xs italic mt-1 leading-relaxed line-clamp-2">
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
                        advance()
                      } else {
                        playerRef.current?.seek(v)
                      }
                    }}
                    onTouchEnd={e => {
                      const v = Number(e.currentTarget.value)
                      isSeekingRef.current = false
                      if (duration > 0 && v >= duration * 0.98) {
                        advance()
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
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={advance}
                    className="text-sm bg-white/20 hover:bg-white/30 text-white px-4 py-1.5 rounded-full transition-colors"
                  >
                    Next
                  </button>
                  {loadingQueue && (
                    <div className="w-4 h-4 border border-zinc-400 border-t-white rounded-full animate-spin" />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Session panel */}
        <div className="flex-1 px-4 py-4 border border-zinc-800 rounded-2xl bg-zinc-950 min-w-0">
          <SessionPanel
            history={cardHistory}
            queue={queue}
            loadingNext={loadingQueue}
            profile={profile}
            notes={notes}
            onNotesChange={setNotes}
            genres={genres}
            onGenresChange={setGenres}
            genreText={genreText}
            onGenreTextChange={setGenreText}
            timePeriod={timePeriod}
            onTimePeriodChange={setTimePeriod}
            onRemoveMultiple={handleRemoveMultiple}
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
                }
                const historyEntry: HistoryEntry = {
                  ...event,
                  albumArt: cur.track.albumArt,
                  uri: cur.track.uri,
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
  )
}
