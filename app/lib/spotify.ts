import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

import { markSpotifyUnavailable } from '@/app/lib/spotify/status'

/** Back off Spotify calls when API is down (5xx) or unreachable; override with SPOTIFY_DOWN_BACKOFF_MS. */
const SPOTIFY_DOWN_BACKOFF_MS = Number(process.env.SPOTIFY_DOWN_BACKOFF_MS ?? 120_000)

/**
 * Spotify sometimes sends huge Retry-After (e.g. thousands of seconds). Applying that literally
 * locks the app for hours. Cap the wait we honor (still respect minimum backoff via 429).
 * Override with SPOTIFY_RETRY_AFTER_MAX_MS (e.g. 3600000 for 1h).
 */
const SPOTIFY_RETRY_AFTER_MAX_MS = Number(process.env.SPOTIFY_RETRY_AFTER_MAX_MS ?? 15 * 60 * 1000)

function spotifyServerOrGatewayError(status: number): boolean {
  return status >= 500 || status === 408
}

const CACHE_FILE = join(process.cwd(), '.spotify-cache.json')

function loadCache(): Map<string, SpotifyTrack> {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as Record<string, SpotifyTrack>
      return new Map(Object.entries(data))
    }
  } catch {}
  return new Map()
}

function persistCache(cache: Map<string, SpotifyTrack>) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)))
  } catch {}
}

// Global throttle: enforce minimum 1s between any two real Spotify API calls
let lastSpotifyCallAt = 0
async function throttledFetch(url: string, headers: Record<string, string>): Promise<Response | null> {
  const wait = 1000 - (Date.now() - lastSpotifyCallAt)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastSpotifyCallAt = Date.now()
  try {
    return await fetch(url, { headers })
  } catch (err) {
    console.error('[spotify] network error (treating as temporary outage)', err)
    markSpotifyUnavailable(SPOTIFY_DOWN_BACKOFF_MS)
    return null
  }
}

export type SpotifySearchResult =
  | { status: 'ok'; track: SpotifyTrack }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }

export type SpotifyTracksResult =
  | { status: 'ok'; tracks: Array<SpotifyTrack | null> }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }

const searchCache = loadCache()

export async function searchTrack(
  query: string,
  accessToken: string
): Promise<SpotifySearchResult> {
  const cacheKey = query.toLowerCase().trim()
  const cached = searchCache.get(cacheKey)
  if (cached) {
    console.info(`Spotify search cache hit: "${query}"`)
    return { status: 'ok', track: cached }
  }

  const params = new URLSearchParams({ q: query, type: 'track', limit: '1' })
  console.info(`searching spotify for ${query}`)
  const res = await throttledFetch(`https://api.spotify.com/v1/search?${params}`, { Authorization: `Bearer ${accessToken}` })
  if (res === null) {
    return { status: 'rate_limited', retryAfterMs: SPOTIFY_DOWN_BACKOFF_MS }
  }
  if (!res.ok) {
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After')
      const retryAfterMs = parseRetryAfterMs(res)
      console.warn(
        `Spotify rate limited (search)${retryAfterHeader ? ` Retry-After: ${retryAfterHeader}s` : ''}`
      )
      return { status: 'rate_limited', retryAfterMs }
    }

    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => '')
      console.warn(`Spotify search unauthorized: ${res.status}`, text)
      return { status: 'unauthorized', message: `Spotify search unauthorized: ${res.status}` }
    }

    if (spotifyServerOrGatewayError(res.status)) {
      const retryAfterMs = Math.max(parseRetryAfterMs(res), SPOTIFY_DOWN_BACKOFF_MS)
      console.warn(`Spotify search server/gateway error ${res.status}; backing off ${retryAfterMs}ms`)
      markSpotifyUnavailable(retryAfterMs)
      return { status: 'rate_limited', retryAfterMs }
    }

    const text = await res.text().catch(() => '')
    console.error(`Spotify search failed: ${res.status} ${res.statusText}`, text)
    return { status: 'error', message: `Spotify search failed: ${res.status}` }
  }

  const data = await res.json()
  const track = data.tracks?.items?.[0]
  if (!track) {
    return { status: 'error', message: 'no track returned' }
  }

  console.info('Spotify search response', {
    status: res.status,
    track: {
      id: track.id,
      name: track.name,
      artists: track.artists?.map((artist: { name: string }) => artist.name),
    },
  })

  const releaseYear = track.album?.release_date ? Number(track.album.release_date.slice(0, 4)) : undefined
  const result: SpotifyTrack = {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists[0]?.name ?? 'Unknown',
    artists: (track.artists as { name: string }[]).map(a => a.name).filter(Boolean),
    album: track.album.name,
    albumArt: track.album.images[0]?.url ?? null,
    durationMs: track.duration_ms,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : undefined,
    source: 'spotify',
  }
  searchCache.set(cacheKey, result)
  persistCache(searchCache)
  return { status: 'ok', track: result }
}

export async function getTracksByIds(
  ids: string[],
  accessToken: string
): Promise<SpotifyTracksResult> {
  if (ids.length === 0) {
    return { status: 'ok', tracks: [] }
  }

  console.info('Spotify batch track lookup', { ids: ids.slice(0, 50) })

  const params = new URLSearchParams({ ids: ids.slice(0, 50).join(',') })
  const res = await throttledFetch(`https://api.spotify.com/v1/tracks?${params}`, { Authorization: `Bearer ${accessToken}` })

  if (res === null) {
    return { status: 'rate_limited', retryAfterMs: SPOTIFY_DOWN_BACKOFF_MS }
  }

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After')
      const retryAfterMs = parseRetryAfterMs(res)
      console.warn(
        `Spotify rate limited (batch tracks)${retryAfterHeader ? ` Retry-After: ${retryAfterHeader}s` : ''}`
      )
      return { status: 'rate_limited', retryAfterMs }
    }

    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => '')
      console.warn('Spotify tracks unauthorized', {
        status: res.status,
        body: text,
        ids: ids.slice(0, 50),
        url: `https://api.spotify.com/v1/tracks?${params}`,
      })
      return { status: 'unauthorized', message: `Spotify tracks unauthorized: ${res.status}` }
    }

    if (spotifyServerOrGatewayError(res.status)) {
      const retryAfterMs = Math.max(parseRetryAfterMs(res), SPOTIFY_DOWN_BACKOFF_MS)
      console.warn(`Spotify tracks server/gateway error ${res.status}; backing off ${retryAfterMs}ms`)
      markSpotifyUnavailable(retryAfterMs)
      return { status: 'rate_limited', retryAfterMs }
    }

    const text = await res.text().catch(() => '')
    console.error(`Spotify tracks fetch failed: ${res.status} ${res.statusText}`, text)
    return { status: 'error', message: `Spotify tracks fetch failed: ${res.status}` }
  }

  const data = await res.json()
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.map((track: Record<string, unknown> | null) =>
        track
          ? {
              id: (track as { id: string }).id,
              uri: (track as { uri: string }).uri,
              name: (track as { name: string }).name,
              artist: ((track as { artists: { name: string }[] }).artists?.[0]?.name ?? 'Unknown') as string,
              artists: ((track as { artists: { name: string }[] }).artists ?? []).map(a => a.name).filter(Boolean),
              album: ((track as { album: { name: string } }).album?.name ?? 'Unknown') as string,
              albumArt: (track as { album: { images: { url: string }[] } }).album?.images?.[0]?.url ?? null,
              durationMs: (track as { duration_ms: number }).duration_ms,
              releaseYear: (() => { const d = (track as { album: { release_date?: string } }).album?.release_date; const y = d ? Number(d.slice(0, 4)) : NaN; return Number.isFinite(y) ? y : undefined })(),
              source: 'spotify' as const,
            }
          : null
      )
    : []

  return { status: 'ok', tracks }
}

/**
 * GET /v1/tracks sometimes returns empty `album.images` (or none). Search often has cover art.
 * Only merge art when the search top result is the same track id so we don't show wrong artwork.
 */
export async function enrichAlbumArtIfMissing(
  track: SpotifyTrack,
  accessToken: string,
  searchHint?: string
): Promise<SpotifyTrack> {
  if (track.albumArt) return track
  const q = (searchHint?.trim() || `${track.name} ${track.artist}`).trim()
  if (!q) return track
  const res = await searchTrack(q, accessToken)
  if (res.status !== 'ok' || !res.track.albumArt) return track
  if (res.track.id !== track.id) {
    console.info('enrichAlbumArtIfMissing: search top track id differs; not applying art', {
      expected: track.id,
      got: res.track.id,
      q: q.slice(0, 80),
    })
    return track
  }
  return { ...track, albumArt: res.track.albumArt }
}

function parseRetryAfterMs(res: Response): number {
  const h = res.headers.get('Retry-After')
  if (!h) return 30_000

  const asSeconds = Number(h)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    const ms = Math.max(asSeconds * 1000, 30_000)
    return Math.min(ms, SPOTIFY_RETRY_AFTER_MAX_MS)
  }

  const until = Date.parse(h)
  if (Number.isFinite(until)) {
    const ms = Math.max(0, until - Date.now())
    return Math.min(Math.max(ms, 30_000), SPOTIFY_RETRY_AFTER_MAX_MS)
  }

  return 30_000
}

export interface SpotifyTrack {
  id: string
  uri: string
  name: string
  artist: string
  /** All credited artists, e.g. ["Miles Davis", "John Coltrane"]. Falls back to [artist] when unavailable. */
  artists?: string[]
  album: string
  albumArt: string | null
  durationMs: number
  releaseYear?: number
  /** Always 'spotify'. Present so SpotifyTrack satisfies the generic Track interface. */
  source: 'spotify'
}
