import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Track } from '@/app/lib/playback/types'
import { isYoutubeResolveTestServerEnabled } from '@/app/lib/youtubeResolveTestEnv'
import {
  YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
  YOUTUBE_RESOLVE_TEST_VIDEO_ID,
} from '@/app/lib/youtubeResolveTestDefaults'
import { extractYoutubeVideoId, extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

/** The YouTube Data API returns HTML-encoded titles (e.g. &#39; for '). Decode them. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

// Each search call costs 100 quota units. Free tier = 10,000/day → 100 searches/day.
// Cache aggressively to disk so restarts don't re-burn quota.
const CACHE_FILE = join(process.cwd(), '.youtube-cache.json')

export type YouTubeTrack = Track & { source: 'youtube'; videoId: string }

/** One alternative video from the same search query. Stored alongside the primary track. */
type YouTubeCandidate = {
  videoId: string
  name: string
  artist: string
  albumArt: string | null
}

/** New-format cache entry: primary track + ordered fallback candidates from the same search. */
type YouTubeCacheEntry = {
  track: YouTubeTrack
  candidates: YouTubeCandidate[]
}

/** Disk format: each value is either legacy YouTubeTrack or new YouTubeCacheEntry. */
type CacheDiskValue = YouTubeTrack | YouTubeCacheEntry

function isCacheEntry(v: CacheDiskValue): v is YouTubeCacheEntry {
  return typeof (v as YouTubeCacheEntry).track === 'object'
}

function toEntry(v: CacheDiskValue): YouTubeCacheEntry {
  if (isCacheEntry(v)) return v
  return { track: v, candidates: [] }
}

function loadCache(): Map<string, YouTubeCacheEntry> {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as Record<string, CacheDiskValue>
      const map = new Map<string, YouTubeCacheEntry>()
      for (const [k, v] of Object.entries(data)) map.set(k, toEntry(v))
      return map
    }
  } catch {}
  return new Map()
}

function persistCache(cache: Map<string, YouTubeCacheEntry>) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)))
  } catch {}
}

const searchCache = loadCache()

// Reverse lookup: videoId → cache key (query). Rebuilt on load + updated on new searches.
// Used by getNextYouTubeCandidate to find the entry without the original query string.
const videoIdToKey = new Map<string, string>()
for (const [key, entry] of searchCache) {
  videoIdToKey.set(entry.track.videoId, key)
  for (const c of entry.candidates) videoIdToKey.set(c.videoId, key)
}

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

export type YouTubeSearchResult =
  | { status: 'ok'; track: YouTubeTrack }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'quota_exceeded' }

export { extractYoutubeVideoId, extractYoutubeVideoIdLoose }

/** Prefer remaining text after stripping URLs for title/artist; else generic. */
function searchHintForResolvedQuery(query: string, id: string): string {
  const q = query.trim()
  if (q === id) return 'Unknown track'
  if (/^https?:\/\//i.test(q) || /youtube\.com|youtu\.be/i.test(q)) return 'Unknown track'
  const stripped = q.replace(/https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ').trim()
  return stripped.length >= 3 ? stripped : 'Unknown track'
}

/**
 * Build a playable track from a known video id without calling the Data API (0 quota).
 * Accepts an 11-character id, a full URL, or prose containing a YouTube link (see {@link extractYoutubeVideoIdLoose}).
 * Thumbnail uses YouTube's public i.ytimg.com pattern; title/artist come from the LLM search hint.
 */
export function youtubeTrackFromVideoId(videoId: string, searchHint: string): YouTubeTrack | null {
  const id = extractYoutubeVideoIdLoose(videoId.trim())
  if (!id) return null
  let name = searchHint.trim() || 'Unknown track'
  let artist = 'Unknown'
  const dashIdx = name.indexOf(' - ')
  if (dashIdx !== -1) {
    artist = name.slice(0, dashIdx).trim()
    name = name.slice(dashIdx + 3).trim()
  }
  return {
    id,
    videoId: id,
    source: 'youtube',
    name,
    artist,
    album: '',
    albumArt: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    durationMs: 0,
  }
}

/**
 * Given a video ID that failed with error 101/150 (embedding disabled), return the next
 * alternative candidate from the same search query, skipping all excluded IDs.
 * Returns null if no candidates remain — caller should skip the track.
 * Zero quota cost: uses already-cached search results.
 */
export function getNextYouTubeCandidate(
  failedVideoId: string,
  excludeVideoIds: string[]
): YouTubeTrack | null {
  const key = videoIdToKey.get(failedVideoId)
  if (!key) return null
  const entry = searchCache.get(key)
  if (!entry) return null
  const excludeSet = new Set(excludeVideoIds)
  for (const c of entry.candidates) {
    if (excludeSet.has(c.videoId)) continue
    const track: YouTubeTrack = {
      id: c.videoId,
      videoId: c.videoId,
      source: 'youtube',
      name: c.name,
      artist: c.artist,
      album: '',
      albumArt: c.albumArt,
      durationMs: 0,
    }
    console.info(`[youtube] next-candidate for ${failedVideoId}: ${c.videoId} (excluded: ${excludeVideoIds.join(',')})`)
    return track
  }
  console.info(`[youtube] no more candidates for ${failedVideoId} (tried ${excludeVideoIds.length} already)`)
  return null
}

function getApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY ?? null
}

/** true / 1 / yes / on → true; false / 0 / no / off → false; unset → defaultVal */
function envBool(name: string, defaultVal: boolean): boolean {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return defaultVal
  const v = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return defaultVal
}

/**
 * After search.list, call videos.list to prefer embeddable:true (costs +1 quota unit).
 * On by default — YouTube's videoEmbeddable search filter is unreliable (error 101/150).
 * Set YOUTUBE_EMBED_CHECK=0 to disable.
 */
function shouldRunVideosListEmbedCheck(): boolean {
  return envBool('YOUTUBE_EMBED_CHECK', true)
}

/**
 * search.list's videoEmbeddable filter is not enough — many results still fail in the IFrame API
 * with error 101/150 (embedding disabled). Prefer videos the Data API marks embeddable.
 * One videos.list call per search (+1 quota unit vs 100 for search).
 */
async function pickBestEmbeddableVideoId(
  videoIds: string[],
  apiKey: string
): Promise<string | null> {
  if (videoIds.length === 0) return null
  const uniq = [...new Set(videoIds)].slice(0, 50)
  const params = new URLSearchParams({
    part: 'status',
    id: uniq.join(','),
    key: apiKey,
  })
  let res: Response
  try {
    res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`)
  } catch (err) {
    console.warn('[youtube] videos.list network error — skipping non-embeddable candidates', err)
    return videoIds[0] ?? null
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn(`[youtube] videos.list HTTP ${res.status}`, text.slice(0, 120))
    return null
  }
  const data = (await res.json()) as {
    items?: Array<{ id: string; status?: { embeddable?: boolean } }>
  }
  const statusById = new Map<string, boolean | undefined>()
  for (const it of data.items ?? []) {
    statusById.set(it.id, it.status?.embeddable)
  }
  // Preserve search ranking: first hit that is not explicitly non-embeddable
  for (const vid of videoIds) {
    const emb = statusById.get(vid)
    if (emb === false) continue
    return vid
  }
  return null
}

/** True for YouTube auto-generated "Artist - Topic" channels and VEVO — reliably non-embeddable. */
function isLikelyNonEmbeddableChannel(channelTitle: string): boolean {
  const t = channelTitle.trim()
  if (t.endsWith(' - Topic')) return true
  if (/vevo/i.test(t)) return true
  return false
}

function parseNameArtist(title: string, channelTitle: string): { name: string; artist: string } {
  const dashIdx = title.indexOf(' - ')
  if (dashIdx !== -1) {
    return { artist: title.slice(0, dashIdx).trim(), name: title.slice(dashIdx + 3).trim() }
  }
  return { name: title, artist: channelTitle }
}

export async function searchYouTube(query: string): Promise<YouTubeSearchResult> {
  if (isYoutubeResolveTestServerEnabled()) {
    console.info('[youtube] searchYouTube: YOUTUBE_RESOLVE_TEST — skipping Data API, using fixture')
    return {
      status: 'ok',
      track: youtubeTrackFromVideoId(YOUTUBE_RESOLVE_TEST_VIDEO_ID, YOUTUBE_RESOLVE_TEST_SEARCH_HINT)!,
    }
  }
  if (isYouTubeQuotaExceeded()) {
    console.warn(`[youtube] quota backoff active (${Math.round(getYouTubeQuotaWaitMs() / 60000)}m remaining)`)
    return { status: 'quota_exceeded' }
  }

  const cacheKey = query.toLowerCase().trim()
  const cached = searchCache.get(cacheKey)
  if (cached) {
    console.info(`[youtube] cache hit: "${query}"`)
    return { status: 'ok', track: cached.track }
  }

  const qTrim = query.trim()
  const idFromQuery = extractYoutubeVideoIdLoose(qTrim)
  if (idFromQuery) {
    const hint = searchHintForResolvedQuery(qTrim, idFromQuery)
    const track = youtubeTrackFromVideoId(idFromQuery, hint)
    if (track) {
      const entry: YouTubeCacheEntry = { track, candidates: [] }
      searchCache.set(cacheKey, entry)
      videoIdToKey.set(track.videoId, cacheKey)
      persistCache(searchCache)
      const how =
        idFromQuery === qTrim ? 'bare id' : extractYoutubeVideoId(qTrim) ? 'URL' : 'URL in text'
      console.info(`[youtube] zero-quota resolve (no search.list): ${idFromQuery} (${how})`)
      return { status: 'ok', track }
    }
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    return { status: 'error', message: 'YOUTUBE_API_KEY not configured' }
  }

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '25',
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
  const items: Array<{ id?: { videoId?: string }; snippet?: Record<string, unknown> }> = data.items ?? []
  if (items.length === 0) {
    console.info(`[youtube] no results for: "${query}"`)
    return { status: 'not_found' }
  }

  // Filter out Topic/VEVO channels (reliably non-embeddable) for both primary and candidates.
  const allItems = items.filter(i => {
    const ch = decodeHtmlEntities((i.snippet?.channelTitle as string) ?? '')
    return !isLikelyNonEmbeddableChannel(ch)
  })
  // If filtering removed everything, fall back to all items (better than no results).
  const filteredItems = allItems.length > 0 ? allItems : items

  const orderedIds = filteredItems.map(i => i.id?.videoId).filter((id): id is string => Boolean(id))
  const runEmbedCheck = shouldRunVideosListEmbedCheck()
  const chosenId = runEmbedCheck
    ? await pickBestEmbeddableVideoId(orderedIds, apiKey)
    : orderedIds[0] ?? null
  console.info(`[youtube] videos.list embed check: ${runEmbedCheck ? 'on' : 'off (first search hit only)'}`)
  if (!chosenId) {
    return { status: 'not_found' }
  }
  const item = filteredItems.find(i => i.id?.videoId === chosenId) ?? filteredItems[0]
  const videoId: string = chosenId

  const snippet = (item.snippet ?? {}) as Record<string, unknown>
  const title: string = decodeHtmlEntities((snippet.title as string) ?? query)
  const channelTitle: string = decodeHtmlEntities((snippet.channelTitle as string) ?? 'Unknown')
  const thumbs = snippet.thumbnails as
    | { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } }
    | undefined
  const thumbnailUrl: string | null =
    thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url ?? null

  const { name, artist } = parseNameArtist(title, channelTitle)

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

  // Store up to 4 additional candidates from the same search for zero-quota retries on error 150.
  const candidates: YouTubeCandidate[] = filteredItems
    .filter(i => i.id?.videoId && i.id.videoId !== videoId)
    .slice(0, 4)
    .map(i => {
      const s = (i.snippet ?? {}) as Record<string, unknown>
      const t = decodeHtmlEntities((s.title as string) ?? '')
      const ch = decodeHtmlEntities((s.channelTitle as string) ?? '')
      const th = s.thumbnails as typeof thumbs
      const art = th?.high?.url ?? th?.medium?.url ?? th?.default?.url ?? null
      const { name: n, artist: a } = parseNameArtist(t, ch)
      return { videoId: i.id!.videoId!, name: n, artist: a, albumArt: art }
    })

  const entry: YouTubeCacheEntry = { track, candidates }
  searchCache.set(cacheKey, entry)
  videoIdToKey.set(videoId, cacheKey)
  for (const c of candidates) videoIdToKey.set(c.videoId, cacheKey)
  persistCache(searchCache)
  console.info(`[youtube] found: "${title}" (${videoId}) + ${candidates.length} fallback candidates`)
  return { status: 'ok', track }
}
