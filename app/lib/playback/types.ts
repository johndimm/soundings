/**
 * Pluggable playback source abstraction.
 *
 * Phase 1: types only — Spotify is the sole implementation.
 * Phase 2: YouTube adapter is added without touching existing Spotify code.
 */

export type PlaybackSource = 'spotify' | 'youtube'

export const PLAYBACK_SOURCE_LABELS: Record<PlaybackSource, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube',
}

export const DEFAULT_PLAYBACK_SOURCE: PlaybackSource = 'spotify'

// ── Generic track (source-agnostic) ──────────────────────────────────────────

/**
 * A playable track, regardless of source.
 *
 * Spotify-specific fields (uri) are optional so YouTube tracks can omit them,
 * and vice-versa for videoId.
 */
export interface Track {
  /** Source-scoped unique ID (Spotify track ID or YouTube video ID). */
  id: string
  name: string
  artist: string
  /** All credited artists when known (e.g. Spotify multi-artist tracks). */
  artists?: string[]
  album: string
  albumArt: string | null
  durationMs: number
  releaseYear?: number
  source: PlaybackSource

  // Spotify-specific
  /** spotify:track:<id>  — present only when source === 'spotify' */
  uri?: string

  // YouTube-specific
  /** YouTube video ID — present only when source === 'youtube' */
  videoId?: string
}

// ── Playback state ────────────────────────────────────────────────────────────

export interface PlayerAdapterState {
  paused: boolean
  positionMs: number
  durationMs: number
  /** Source-scoped track ID of the currently loaded track, or null if idle. */
  trackId: string | null
}

// ── Player adapter interface ──────────────────────────────────────────────────

/**
 * Each source (Spotify, YouTube, …) implements this interface.
 * PlayerClient depends only on this contract — not on Spotify SDK types.
 */
export interface IPlayerAdapter {
  readonly source: PlaybackSource

  /** One-time setup: load SDK, register listeners. */
  initialize(callbacks: PlayerAdapterCallbacks): void

  /** Connect / activate the player (e.g. call p.connect() for Spotify). */
  connect(): void

  /** Graceful shutdown. */
  disconnect(): void

  /** Start playing a track, optionally resuming at positionMs. */
  play(track: Track, positionMs?: number): Promise<void>

  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
}

export interface PlayerAdapterCallbacks {
  /** Fired when the player is ready with its device/player ID. */
  onReady: (deviceId: string) => void
  /** Fired whenever playback state changes. null = player disconnected. */
  onStateChange: (state: PlayerAdapterState | null) => void
  /** Non-fatal error (shown in UI). */
  onError: (message: string) => void
  /** Auth failure — app should redirect to login. */
  onAuthError: (reason: string) => void
}

// ── Card state ───────────────────────────────────────────────────────────────

export interface CardState {
  track: Track
  reason: string
  category?: string
  coords?: { x: number; y: number }
  composed?: number
  performer?: string
}
