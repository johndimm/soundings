import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Track } from '@/app/lib/playback/types'
import { isYoutubeResolveTestServerEnabled } from '@/app/lib/youtubeResolveTestEnv'
import {
  YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
  YOUTUBE_RESOLVE_TEST_VIDEO_ID,
} from '@/app/lib/youtubeResolveTestDefaults'
import type { SongSuggestion } from '@/app/lib/llm'
import { extractYoutubeVideoId, extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'
import {
  YOUTUBE_CREDITS_PER_SEARCH,
  YOUTUBE_CREDITS_PER_VIDEOS_LIST,
  YOUTUBE_DAILY_CREDITS,
} from '@/app/lib/youtubeQuota'

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

// Each search.list costs 100 quota credits. Daily allowance = 110,000 credits → 1,100 searches/day.
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

const QUOTA_FILE = join(process.cwd(), '.youtube-quota.json')
const DAILY_CREDITS = YOUTUBE_DAILY_CREDITS

type QuotaDisk = {
  ptDate: string
  creditsUsed: number
  quotaExceededUntil: number
}

function pacificDateKey(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function loadQuotaState(): QuotaDisk {
  const today = pacificDateKey()
  try {
    if (existsSync(QUOTA_FILE)) {
      const raw = JSON.parse(readFileSync(QUOTA_FILE, 'utf-8')) as Partial<
        QuotaDisk & { searchesUsed?: number }
      >
      if (raw.ptDate === today) {
        let creditsUsed = 0
        if (typeof raw.creditsUsed === 'number') {
          creditsUsed = Math.max(0, raw.creditsUsed)
        } else if (typeof raw.searchesUsed === 'number') {
          creditsUsed = Math.max(0, raw.searchesUsed) * YOUTUBE_CREDITS_PER_SEARCH
        }
        return {
          ptDate: today,
          creditsUsed,
          quotaExceededUntil: typeof raw.quotaExceededUntil === 'number' ? raw.quotaExceededUntil : 0,
        }
      }
    }
  } catch {}
  return { ptDate: today, creditsUsed: 0, quotaExceededUntil: 0 }
}

function persistQuotaState() {
  try {
    const payload: QuotaDisk = {
      ptDate: pacificDateKey(),
      creditsUsed,
      quotaExceededUntil,
    }
    writeFileSync(QUOTA_FILE, JSON.stringify(payload))
  } catch {}
}

let quotaPtDate = pacificDateKey()
let { creditsUsed, quotaExceededUntil } = (() => {
  const s = loadQuotaState()
  quotaPtDate = s.ptDate
  return { creditsUsed: s.creditsUsed, quotaExceededUntil: s.quotaExceededUntil }
})()

function rollQuotaIfNewDay() {
  const today = pacificDateKey()
  if (quotaPtDate === today) return
  quotaPtDate = today
  creditsUsed = 0
  quotaExceededUntil = 0
  persistQuotaState()
  console.info('[youtube] new Pacific day — API credit counter reset')
}

function chargeYouTubeCredits(credits: number, label: string) {
  if (credits <= 0) return
  rollQuotaIfNewDay()
  creditsUsed += credits
  persistQuotaState()
  console.info(
    `[youtube] +${credits} credits (${label}); ${getYouTubeCreditsRemaining().toLocaleString()} remaining today`
  )
}

export {
  YOUTUBE_DAILY_CREDITS,
  YOUTUBE_CREDITS_PER_SEARCH,
  YOUTUBE_CREDITS_PER_VIDEOS_LIST,
} from '@/app/lib/youtubeQuota'

export function getYouTubeCreditsUsed(): number {
  rollQuotaIfNewDay()
  return creditsUsed
}

export function getYouTubeCreditsRemaining(): number {
  rollQuotaIfNewDay()
  return Math.max(0, DAILY_CREDITS - creditsUsed)
}

/** @deprecated Prefer getYouTubeCreditsRemaining() / 100 */
export function getYouTubeSearchesRemaining(): number {
  return Math.floor(getYouTubeCreditsRemaining() / YOUTUBE_CREDITS_PER_SEARCH)
}

export type YouTubeQuotaStatus = {
  dailyCredits: number
  creditsUsed: number
  creditsRemaining: number
  /** Server backoff after Google returned quotaExceeded (may differ from local counter). */
  quotaExceeded: boolean
  /** Google 403 backoff active while local credits remain (shared API key / production usage). */
  googleBackoffActive: boolean
  /** True when this server's tracked credits for today are exhausted. */
  localLimitReached: boolean
  retryAfterMs: number
  resetAt: string | null
}

export function getYouTubeQuotaStatus(): YouTubeQuotaStatus {
  rollQuotaIfNewDay()
  const retryAfterMs = getYouTubeQuotaWaitMs()
  const googleBackoff = Date.now() < quotaExceededUntil
  const exceeded = isYouTubeQuotaExceeded()
  const remaining = getYouTubeCreditsRemaining()
  let resetAt: string | null = null
  if (googleBackoff && retryAfterMs > 0) {
    resetAt = new Date(Date.now() + retryAfterMs).toISOString()
  }
  return {
    dailyCredits: DAILY_CREDITS,
    creditsUsed,
    creditsRemaining: remaining,
    quotaExceeded: exceeded,
    googleBackoffActive: googleBackoff,
    localLimitReached: remaining === 0,
    retryAfterMs,
    resetAt,
  }
}

// Server-side quota backoff: once quota_exceeded is hit, stop calling until reset time.
// YouTube quota resets at midnight Pacific. We back off until then + 30 min buffer.
function markQuotaExceeded() {
  const now = new Date()
  const resetUTC = new Date(now)
  resetUTC.setUTCHours(8, 30, 0, 0) // 00:30 PT = 08:30 UTC
  if (resetUTC.getTime() <= now.getTime()) {
    resetUTC.setUTCDate(resetUTC.getUTCDate() + 1)
  }
  quotaExceededUntil = resetUTC.getTime()
  persistQuotaState()
  console.warn(`[youtube] quota exceeded — backing off until ${resetUTC.toISOString()}`)
}

/** Clear server backoff after a successful search or when the window has passed. */
export function clearYouTubeQuotaBackoff(): void {
  if (quotaExceededUntil === 0) return
  quotaExceededUntil = 0
  persistQuotaState()
  console.info('[youtube] quota backoff cleared')
}

export function isYouTubeQuotaExceeded(): boolean {
  rollQuotaIfNewDay()
  if (creditsUsed >= DAILY_CREDITS) return true
  if (quotaExceededUntil > 0 && Date.now() >= quotaExceededUntil) {
    clearYouTubeQuotaBackoff()
    return false
  }
  return Date.now() < quotaExceededUntil
}

function wouldExceedCredits(cost: number): boolean {
  rollQuotaIfNewDay()
  return creditsUsed + cost > DAILY_CREDITS
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

export type YouTubeResolveHintOpts = {
  preferredArtists?: string[]
  artistConstraint?: string
}

/** Extra search queries when the title-only query misses (artist-focused channels). */
export function buildYouTubeSearchAlternates(
  search: string,
  opts?: YouTubeResolveHintOpts
): string[] {
  const q = search.trim()
  if (!q) return []
  const artists: string[] = []
  const ac = opts?.artistConstraint?.trim()
  if (ac) artists.push(ac)
  for (const a of opts?.preferredArtists ?? []) {
    const t = a.trim()
    if (!t) continue
    if (artists.some(x => x.toLowerCase() === t.toLowerCase())) continue
    artists.push(t)
  }
  const qLower = q.toLowerCase()
  const out: string[] = []
  for (const artist of artists.slice(0, 6)) {
    if (qLower.includes(artist.toLowerCase())) continue
    out.push(`${artist} - ${q}`)
    out.push(`${artist} ${q}`)
  }
  return out
}

function youtubeVideoIdFromSuggestion(song: SongSuggestion): string | null {
  if (song.youtubeVideoId) {
    const id = extractYoutubeVideoIdLoose(song.youtubeVideoId)
    if (id) return id
  }
  return null
}

/** Resolve one LLM row: optional zero-quota video id, then search + artist fallbacks. */
export async function resolveYouTubeSuggestion(
  song: SongSuggestion,
  opts?: YouTubeResolveHintOpts
): Promise<YouTubeSearchResult> {
  const queries: string[] = []
  const seen = new Set<string>()
  const push = (q: string) => {
    const k = q.trim().toLowerCase()
    if (!k || seen.has(k)) return
    seen.add(k)
    queries.push(q.trim())
  }

  const vid = youtubeVideoIdFromSuggestion(song)
  if (vid) push(vid)

  const main = song.search.trim()
  if (main) push(main)

  for (const alt of buildYouTubeSearchAlternates(main, opts)) {
    push(alt)
  }

  for (const q of queries) {
    const res = await searchYouTube(q)
    if (res.status === 'quota_exceeded') return res
    if (res.status === 'ok') return res
  }
  return { status: 'not_found' }
}

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
 * oEmbed is more reliable than videos.list status.embeddable: YouTube returns 401 when
 * embedding is truly disabled, 200 when it works. No API key needed; runs server-side only.
 */
async function isEmbeddableViaOembed(videoId: string): Promise<boolean> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return true // network error: assume embeddable to avoid over-filtering
  }
}

/**
 * search.list's videoEmbeddable filter is not enough — many results still fail in the IFrame API
 * with error 101/150 (embedding disabled). Use videos.list to pre-sort, then confirm via oEmbed
 * (which is definitive: 200 = embeddable, 401 = not). Cycles through candidates until one passes.
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
  let statusById = new Map<string, boolean | undefined>()
  try {
    if (wouldExceedCredits(YOUTUBE_CREDITS_PER_VIDEOS_LIST)) {
      console.warn('[youtube] skipping videos.list — local daily credits exhausted')
      return null
    }
    chargeYouTubeCredits(YOUTUBE_CREDITS_PER_VIDEOS_LIST, 'videos.list')
    const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`)
    if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{ id: string; status?: { embeddable?: boolean } }>
      }
      for (const it of data.items ?? []) {
        statusById.set(it.id, it.status?.embeddable)
      }
    } else {
      const text = await res.text().catch(() => '')
      console.warn(`[youtube] videos.list HTTP ${res.status}`, text.slice(0, 120))
    }
  } catch (err) {
    console.warn('[youtube] videos.list network error', err)
  }

  // Order: explicitly embeddable first, then unknown, skip explicitly false.
  const candidates = [
    ...videoIds.filter(v => statusById.get(v) === true),
    ...videoIds.filter(v => statusById.get(v) === undefined),
  ]
  if (candidates.length === 0) candidates.push(...videoIds) // all were false — try anyway

  // Confirm via oEmbed (definitive check). Try each candidate until one passes.
  for (const vid of candidates) {
    const ok = await isEmbeddableViaOembed(vid)
    console.info(`[youtube] oEmbed check ${vid}: ${ok ? 'embeddable' : 'blocked'}`)
    if (ok) return vid
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
  rollQuotaIfNewDay()
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
  if (wouldExceedCredits(YOUTUBE_CREDITS_PER_SEARCH)) {
    console.warn('[youtube] local daily credit budget exhausted — skipping search.list')
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

  chargeYouTubeCredits(YOUTUBE_CREDITS_PER_SEARCH, `search.list: "${query}"`)

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
  const chosenId = await pickBestEmbeddableVideoId(orderedIds, apiKey)
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
  clearYouTubeQuotaBackoff()
  console.info(`[youtube] found: "${title}" (${videoId}) + ${candidates.length} fallback candidates`)
  return { status: 'ok', track }
}
