import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

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
async function throttledFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const wait = 1000 - (Date.now() - lastSpotifyCallAt)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastSpotifyCallAt = Date.now()
  return fetch(url, { headers })
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
    album: track.album.name,
    albumArt: track.album.images[0]?.url ?? null,
    durationMs: track.duration_ms,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : undefined,
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
              album: ((track as { album: { name: string } }).album?.name ?? 'Unknown') as string,
              albumArt: (track as { album: { images: { url: string }[] } }).album?.images?.[0]?.url ?? null,
              durationMs: (track as { duration_ms: number }).duration_ms,
              releaseYear: (() => { const d = (track as { album: { release_date?: string } }).album?.release_date; const y = d ? Number(d.slice(0, 4)) : NaN; return Number.isFinite(y) ? y : undefined })(),
            }
          : null
      )
    : []

  return { status: 'ok', tracks }
}

function parseRetryAfterMs(res: Response): number {
  const retryAfterHeader = res.headers.get('Retry-After')
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN
  return Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 30_000
}

export interface SpotifyTrack {
  id: string
  uri: string
  name: string
  artist: string
  album: string
  albumArt: string | null
  durationMs: number
  releaseYear?: number
}
