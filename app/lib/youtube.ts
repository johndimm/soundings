import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Track } from '@/app/lib/playback/types'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

// Each search call costs 100 quota units. Free tier = 10,000/day → 100 searches/day.
// Cache aggressively to disk so restarts don't re-burn quota.
const CACHE_FILE = join(process.cwd(), '.youtube-cache.json')

function loadCache(): Map<string, YouTubeTrack> {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as Record<string, YouTubeTrack>
      return new Map(Object.entries(data))
    }
  } catch {}
  return new Map()
}

function persistCache(cache: Map<string, YouTubeTrack>) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)))
  } catch {}
}

const searchCache = loadCache()

// Searches used this server session (resets on restart or when quota resets).
let searchesUsed = 0
const DAILY_QUOTA = 100

export function getYouTubeSearchesRemaining(): number {
  return Math.max(0, DAILY_QUOTA - searchesUsed)
}

// Server-side quota backoff: once quota_exceeded is hit, stop calling until reset time.
// YouTube quota resets at midnight Pacific (UTC-8). We back off until then + 30 min buffer.
let quotaExceededUntil = 0

function markQuotaExceeded() {
  const now = new Date()
  // Next midnight PT = next midnight UTC-8
  const resetUTC = new Date(now)
  resetUTC.setUTCHours(8, 30, 0, 0) // 00:30 PT = 08:30 UTC
  if (resetUTC.getTime() <= now.getTime()) {
    resetUTC.setUTCDate(resetUTC.getUTCDate() + 1)
  }
  quotaExceededUntil = resetUTC.getTime()
  console.warn(`[youtube] quota exceeded — backing off until ${resetUTC.toISOString()}`)
}

export function isYouTubeQuotaExceeded(): boolean {
  return Date.now() < quotaExceededUntil
}

export function getYouTubeQuotaWaitMs(): number {
  return Math.max(0, quotaExceededUntil - Date.now())
}

export type YouTubeTrack = Track & { source: 'youtube'; videoId: string }

export type YouTubeSearchResult =
  | { status: 'ok'; track: YouTubeTrack }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'quota_exceeded' }

function getApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY ?? null
}

export async function searchYouTube(query: string): Promise<YouTubeSearchResult> {
  if (isYouTubeQuotaExceeded()) {
    console.warn(`[youtube] quota backoff active (${Math.round(getYouTubeQuotaWaitMs() / 60000)}m remaining)`)
    return { status: 'quota_exceeded' }
  }

  const cacheKey = query.toLowerCase().trim()
  const cached = searchCache.get(cacheKey)
  if (cached) {
    console.info(`[youtube] cache hit: "${query}"`)
    return { status: 'ok', track: cached }
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    return { status: 'error', message: 'YOUTUBE_API_KEY not configured' }
  }

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10', // Music
    videoEmbeddable: 'true',
    maxResults: '1',
    key: apiKey,
  })

  searchesUsed++
  console.info(`[youtube] searching: "${query}" (${getYouTubeSearchesRemaining()} remaining)`)

  let res: Response
  try {
    res = await fetch(`${YOUTUBE_API_BASE}/search?${params}`)
  } catch (err) {
    console.error('[youtube] network error', err)
    return { status: 'error', message: 'YouTube network error' }
  }

  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.json().catch(() => null)
      const reason = body?.error?.errors?.[0]?.reason
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        markQuotaExceeded()
        return { status: 'quota_exceeded' }
      }
      console.warn('[youtube] 403 forbidden', body)
      return { status: 'error', message: `YouTube API forbidden: ${reason ?? res.status}` }
    }
    const text = await res.text().catch(() => '')
    console.error(`[youtube] search failed: ${res.status}`, text.slice(0, 200))
    return { status: 'error', message: `YouTube search failed: ${res.status}` }
  }

  const data = await res.json()
  const item = data.items?.[0]
  if (!item) {
    console.info(`[youtube] no results for: "${query}"`)
    return { status: 'not_found' }
  }

  const videoId: string = item.id?.videoId
  if (!videoId) {
    return { status: 'not_found' }
  }

  const snippet = item.snippet ?? {}
  const title: string = snippet.title ?? query
  const channelTitle: string = snippet.channelTitle ?? 'Unknown'
  const thumbnailUrl: string =
    snippet.thumbnails?.high?.url ??
    snippet.thumbnails?.medium?.url ??
    snippet.thumbnails?.default?.url ??
    null

  // Parse "Artist - Title" from the video title when possible; otherwise use channel as artist
  let name = title
  let artist = channelTitle
  const dashIdx = title.indexOf(' - ')
  if (dashIdx !== -1) {
    artist = title.slice(0, dashIdx).trim()
    name = title.slice(dashIdx + 3).trim()
  }

  const track: YouTubeTrack = {
    id: videoId,
    videoId,
    source: 'youtube',
    name,
    artist,
    album: '',
    albumArt: thumbnailUrl,
    // YouTube search doesn't return duration; the IFrame player reports actual duration on load.
    durationMs: 0,
  }

  searchCache.set(cacheKey, track)
  persistCache(searchCache)
  console.info(`[youtube] found: "${title}" (${videoId})`)
  return { status: 'ok', track }
}
