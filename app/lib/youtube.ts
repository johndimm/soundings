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

/** Well-known public video — used only for 1-credit quota probes. */
const YOUTUBE_QUOTA_PROBE_VIDEO_ID = 'M7lc1UVf-VE'

export type YouTubeQuotaProbeResult = {
  probed: boolean
  googleAvailable: boolean
  clearedBackoff: boolean
  httpStatus?: number
  reason?: string
}

let quotaProbeInFlight: Promise<YouTubeQuotaProbeResult> | null = null

/**
 * When server backoff is active, call Google (videos.list, 1 credit) to see if quota
 * was reset or the key was rotated — clears stale quotaExceededUntil on success.
 */
export async function probeYouTubeQuotaWhenBackoffActive(): Promise<YouTubeQuotaProbeResult> {
  rollQuotaIfNewDay()
  const backoffActive = quotaExceededUntil > 0 && Date.now() < quotaExceededUntil
  if (!backoffActive) {
    return { probed: false, googleAvailable: true, clearedBackoff: false }
  }

  if (quotaProbeInFlight) return quotaProbeInFlight

  quotaProbeInFlight = (async (): Promise<YouTubeQuotaProbeResult> => {
    const apiKey = getApiKey()
    if (!apiKey) {
      return { probed: true, googleAvailable: false, clearedBackoff: false, reason: 'no_api_key' }
    }

    const params = new URLSearchParams({
      part: 'id',
      id: YOUTUBE_QUOTA_PROBE_VIDEO_ID,
      key: apiKey,
    })

    console.info('[youtube] probing quota via videos.list (1 credit)')
    let res: Response
    try {
      res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`)
    } catch (err) {
      console.warn('[youtube] quota probe network error', err)
      return { probed: true, googleAvailable: false, clearedBackoff: false, reason: 'network_error' }
    }

    if (res.ok) {
      chargeYouTubeCredits(YOUTUBE_CREDITS_PER_VIDEOS_LIST, 'videos.list (quota probe)')
      clearYouTubeQuotaBackoff()
      console.info('[youtube] quota probe OK — cleared server backoff')
      return { probed: true, googleAvailable: true, clearedBackoff: true, httpStatus: res.status }
    }

    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as {
        error?: { errors?: Array<{ reason?: string }> }
      } | null
      const reason = body?.error?.errors?.[0]?.reason
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        markQuotaExceeded()
        console.warn('[youtube] quota probe: still over quota', reason)
        return {
          probed: true,
          googleAvailable: false,
          clearedBackoff: false,
          httpStatus: 403,
          reason: reason ?? 'quotaExceeded',
        }
      }
      console.warn('[youtube] quota probe 403', reason ?? body)
      return {
        probed: true,
        googleAvailable: false,
        clearedBackoff: false,
        httpStatus: 403,
        reason: reason ?? 'forbidden',
      }
    }

    const text = await res.text().catch(() => '')
    console.warn(`[youtube] quota probe HTTP ${res.status}`, text.slice(0, 120))
    return {
      probed: true,
      googleAvailable: false,
      clearedBackoff: false,
      httpStatus: res.status,
      reason: `http_${res.status}`,
    }
  })().finally(() => {
    quotaProbeInFlight = null
  })

  return quotaProbeInFlight
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
}

/** Extra search queries when the title-only query misses. */
export function buildYouTubeSearchAlternates(
  search: string,
  opts?: YouTubeResolveHintOpts
): string[] {
  const q = search.trim()
  if (!q) return []
  const artists: string[] = []
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
  const searchHint = song.search.trim()

  const vid = youtubeVideoIdFromSuggestion(song)
  if (vid) {
    const track = await validateAndResolveVideoId(vid, searchHint, 'LLM video id')
    if (track) return { status: 'ok', track }
    console.info(`[youtube] LLM video id ${vid} failed validation — falling back to search`)
  }

  const queries: string[] = []
  const seen = new Set<string>()
  const push = (q: string) => {
    const k = q.trim().toLowerCase()
    if (!k || seen.has(k)) return
    seen.add(k)
    queries.push(q.trim())
  }

  if (searchHint) push(searchHint)

  for (const alt of buildYouTubeSearchAlternates(searchHint, opts)) {
    push(alt)
  }

  for (const q of queries) {
    const res = await searchYouTube(q, searchHint)
    if (res.status === 'quota_exceeded') return res
    if (res.status === 'ok') return res
  }
  return { status: 'not_found' }
}

/** Prefer metadataHint, else remaining text after stripping URLs; else generic. */
function searchHintForResolvedQuery(query: string, id: string, metadataHint?: string): string {
  const hint = metadataHint?.trim()
  if (hint) return hint
  const q = query.trim()
  if (q === id) return 'Unknown track'
  if (/^https?:\/\//i.test(q) || /youtube\.com|youtu\.be/i.test(q)) return 'Unknown track'
  const stripped = q.replace(/https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ').trim()
  return stripped.length >= 3 ? stripped : 'Unknown track'
}

/** Parse LLM `search` text into display title + artist when resolving by video id (no Data API). */
export function parseSearchHintForYouTube(searchHint: string): { name: string; artist: string } {
  const trimmed = searchHint.trim()
  if (!trimmed) return { name: 'Unknown track', artist: 'Unknown' }

  for (const sep of [' - ', ' — ', ' – ', ': ']) {
    const idx = trimmed.indexOf(sep)
    if (idx !== -1) {
      const left = trimmed.slice(0, idx).trim()
      const right = trimmed.slice(idx + sep.length).trim()
      if (left && right) return { artist: left, name: right }
    }
  }

  // LLM convention: "track name artist name" — artist often last (capitalized words).
  const trailingArtist = trimmed.match(/^(.+?)\s+([A-ZÀ-ÿ][\w'’.-]+(?:\s+[A-ZÀ-ÿ][\w'’.-]+){0,4})$/u)
  if (trailingArtist) {
    const name = trailingArtist[1].trim()
    const artist = trailingArtist[2].trim()
    if (name.length >= 2 && artist.length >= 2) return { name, artist }
  }

  return { name: trimmed, artist: 'Unknown' }
}

/**
 * Build a track from a video id + search hint without validation.
 * Production resolve uses {@link validateAndResolveVideoId} (oEmbed + videos.list + relevance).
 * This helper is for tests and resolve-test fixtures only.
 */
export function youtubeTrackFromVideoId(videoId: string, searchHint: string): YouTubeTrack | null {
  const id = extractYoutubeVideoIdLoose(videoId.trim())
  if (!id) return null
  const { name, artist } = parseSearchHintForYouTube(searchHint)
  return {
    id,
    videoId: id,
    source: 'youtube',
    name: name || 'Unknown track',
    artist: artist || 'Unknown',
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


/** Minimum relevance score to trust an LLM-provided video id (at least one keyword hit). */
export const MIN_YOUTUBE_RELEVANCE = 3

/** Well-known classical composer surnames — penalize when present in video title but absent from query. */
const CLASSICAL_COMPOSER_TOKENS = new Set([
  'bach', 'handel', 'mozart', 'beethoven', 'brahms', 'mahler', 'wagner', 'verdi', 'puccini',
  'debussy', 'ravel', 'stravinsky', 'prokofiev', 'shostakovich', 'rachmaninov', 'rachmaninoff',
  'tchaikovsky', 'tschaikovsky', 'dvorak', 'dvorák', 'sibelius', 'bartok', 'bartók', 'haydn',
  'schubert', 'schumann', 'liszt', 'chopin', 'vivaldi', 'monteverdi', 'purcell', 'elgar',
  'britten', 'holst', 'satie', 'messiaen', 'boulez', 'stockhausen', 'ligeti', 'janacek',
])

export function normalizeForYouTubeMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokens from the LLM/search query used to score YouTube result relevance. */
export function extractYouTubeQueryKeywords(searchHint: string): string[] {
  const n = normalizeForYouTubeMatch(searchHint)
  const stop = new Set([
    'cond', 'von', 'der', 'die', 'das', 'for', 'the', 'and', 'with', 'live', 'full', 'video',
    'audio', 'official', 'remaster', 'remastered', 'recording', 'performance', 'complete',
    'herbert', 'karajan', 'berlin', 'philharmonic', 'philharmonia', 'orchestra', 'orchestral',
    'symphony', 'symphonic', 'conductor', 'conducted',
  ])
  const words = n.split(/\s+/).filter(w => w.length >= 4 && !stop.has(w))
  const slashComposer = searchHint.match(/\/([A-Za-zÀ-ÿ][\w'’.-]*)/i)
  if (slashComposer?.[1]) words.push(normalizeForYouTubeMatch(slashComposer[1]))
  return [...new Set(words.filter(Boolean))]
}

/**
 * Score how well a YouTube result matches the intended search (higher = better).
 * Penalizes wrong-composer matches (e.g. Stravinsky video for a Bartók query).
 */
export function scoreYouTubeResultRelevance(
  searchHint: string,
  videoTitle: string,
  channelTitle: string
): number {
  const keywords = extractYouTubeQueryKeywords(searchHint)
  if (keywords.length === 0) return 0
  const hay = normalizeForYouTubeMatch(`${videoTitle} ${channelTitle}`)
  let score = 0
  let matched = 0
  for (const kw of keywords) {
    if (hay.includes(kw)) {
      score += 3
      matched++
    }
  }
  if (matched === 0) score -= 5
  const titleNorm = normalizeForYouTubeMatch(videoTitle)
  const querySet = new Set(keywords)
  for (const composer of CLASSICAL_COMPOSER_TOKENS) {
    if (titleNorm.includes(composer) && !querySet.has(composer)) score -= 12
  }
  return score
}

type OembedMetadata = {
  embeddable: boolean
  title: string
  authorName: string
}

/**
 * oEmbed is more reliable than videos.list status.embeddable: YouTube returns 401 when
 * embedding is truly disabled, 200 when it works. No API key needed; runs server-side only.
 */
async function fetchOembedMetadata(videoId: string): Promise<OembedMetadata | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { embeddable: false, title: '', authorName: '' }
    const data = (await res.json()) as { title?: string; author_name?: string }
    return {
      embeddable: true,
      title: typeof data.title === 'string' ? decodeHtmlEntities(data.title) : '',
      authorName: typeof data.author_name === 'string' ? decodeHtmlEntities(data.author_name) : '',
    }
  } catch {
    return null
  }
}

async function isEmbeddableViaOembed(videoId: string, strict = false): Promise<boolean> {
  const meta = await fetchOembedMetadata(videoId)
  if (meta === null) return !strict
  return meta.embeddable
}

/** videos.list status.embeddable for one or more ids (1 credit per call). */
async function fetchVideosListEmbeddableMap(
  videoIds: string[],
  apiKey: string
): Promise<Map<string, boolean | undefined>> {
  const map = new Map<string, boolean | undefined>()
  const uniq = [...new Set(videoIds)].filter(Boolean)
  if (uniq.length === 0) return map
  if (wouldExceedCredits(YOUTUBE_CREDITS_PER_VIDEOS_LIST)) {
    console.warn('[youtube] skipping videos.list — local daily credits exhausted')
    return map
  }
  const params = new URLSearchParams({
    part: 'status',
    id: uniq.slice(0, 50).join(','),
    key: apiKey,
  })
  try {
    chargeYouTubeCredits(YOUTUBE_CREDITS_PER_VIDEOS_LIST, 'videos.list')
    const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`)
    if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{ id: string; status?: { embeddable?: boolean } }>
      }
      for (const it of data.items ?? []) {
        map.set(it.id, it.status?.embeddable)
      }
    } else {
      const text = await res.text().catch(() => '')
      console.warn(`[youtube] videos.list HTTP ${res.status}`, text.slice(0, 120))
    }
  } catch (err) {
    console.warn('[youtube] videos.list network error', err)
  }
  return map
}

/**
 * Full embeddability + relevance gate for a direct video id (LLM-provided or URL in query).
 * Requires oEmbed OK, videos.list embeddable !== false when API key is set, and relevance match.
 */
async function validateAndResolveVideoId(
  videoId: string,
  searchHint: string,
  label: string
): Promise<YouTubeTrack | null> {
  const oembed = await fetchOembedMetadata(videoId)
  if (oembed === null) {
    console.info(`[youtube] ${label} ${videoId} rejected — oEmbed unreachable`)
    return null
  }
  if (!oembed.embeddable || !oembed.title) {
    console.info(`[youtube] ${label} ${videoId} rejected — not embeddable via oEmbed`)
    return null
  }

  const apiKey = getApiKey()
  if (apiKey) {
    const statusById = await fetchVideosListEmbeddableMap([videoId], apiKey)
    if (statusById.get(videoId) === false) {
      console.info(`[youtube] ${label} ${videoId} rejected — videos.list embeddable=false`)
      return null
    }
  }

  const relevance = scoreYouTubeResultRelevance(searchHint, oembed.title, oembed.authorName)
  if (relevance < MIN_YOUTUBE_RELEVANCE) {
    console.info(
      `[youtube] ${label} ${videoId} rejected — relevance ${relevance} for "${searchHint.slice(0, 80)}" vs "${oembed.title.slice(0, 80)}"`
    )
    return null
  }

  return youtubeTrackFromOembed(videoId, oembed)
}

function youtubeTrackFromOembed(videoId: string, meta: { title: string; authorName: string }): YouTubeTrack {
  const { name, artist } = parseNameArtist(meta.title, meta.authorName)
  return {
    id: videoId,
    videoId,
    source: 'youtube',
    name: name || meta.title || 'Unknown track',
    artist: artist || meta.authorName || 'Unknown',
    album: '',
    albumArt: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    durationMs: 0,
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
  const statusById = await fetchVideosListEmbeddableMap(videoIds, apiKey)

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
  for (const sep of [' - ', ' — ', ' – ', ' ~ ']) {
    const idx = title.indexOf(sep)
    if (idx !== -1) {
      return { artist: title.slice(0, idx).trim(), name: title.slice(idx + sep.length).trim() }
    }
  }
  const tildeIdx = title.indexOf('~')
  if (tildeIdx !== -1) {
    return { artist: title.slice(0, tildeIdx).trim(), name: title.slice(tildeIdx + 1).trim() }
  }
  return { name: title, artist: channelTitle }
}

export async function searchYouTube(query: string, metadataHint?: string): Promise<YouTubeSearchResult> {
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
    const relevance = scoreYouTubeResultRelevance(
      query,
      cached.track.name,
      cached.track.artist
    )
    if (relevance >= -5) {
      console.info(`[youtube] cache hit: "${query}" (relevance ${relevance})`)
      return { status: 'ok', track: cached.track }
    }
    console.info(`[youtube] cache hit rejected (relevance ${relevance}) — re-searching: "${query}"`)
  }

  const qTrim = query.trim()
  const idFromQuery = extractYoutubeVideoIdLoose(qTrim)
  if (idFromQuery) {
    const hint = searchHintForResolvedQuery(qTrim, idFromQuery, metadataHint)
    const track = await validateAndResolveVideoId(idFromQuery, hint, 'query video id')
    if (track) {
      const entry: YouTubeCacheEntry = { track, candidates: [] }
      searchCache.set(cacheKey, entry)
      videoIdToKey.set(track.videoId, cacheKey)
      persistCache(searchCache)
      const how =
        idFromQuery === qTrim ? 'bare id' : extractYoutubeVideoId(qTrim) ? 'URL' : 'URL in text'
      console.info(`[youtube] zero-quota resolve (validated): ${idFromQuery} (${how})`)
      return { status: 'ok', track }
    }
    console.info(`[youtube] query video id ${idFromQuery} failed validation — falling back to search.list`)
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
    const body = await res.json().catch(() => null)
    if (res.status === 403 || res.status === 429) {
      const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.message
      const message = body?.error?.message ?? ''
      const isQuotaExceeded =
        reason === 'quotaExceeded' ||
        reason === 'dailyLimitExceeded' ||
        (typeof reason === 'string' && reason.includes('Quota exceeded')) ||
        (typeof message === 'string' && message.includes('Quota exceeded'))
      if (isQuotaExceeded) {
        console.warn('[youtube] quota exceeded — marking backoff', { reason, message: message.slice(0, 100) })
        markQuotaExceeded()
        return { status: 'quota_exceeded' }
      }
      if (res.status === 403) {
        console.warn('[youtube] 403 forbidden', body)
        return { status: 'error', message: `YouTube API forbidden: ${reason ?? res.status}` }
      } else {
        console.warn('[youtube] 429 rate limited (not quota)', body)
        return { status: 'error', message: `YouTube API rate limited: ${reason ?? res.status}` }
      }
    }
    const errorMsg = typeof body === 'object' && body !== null ? JSON.stringify(body).slice(0, 200) : ''
    console.error(`[youtube] search failed: ${res.status}`, errorMsg)
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

  const scoredItems = filteredItems
    .map(i => {
      const snippet = (i.snippet ?? {}) as Record<string, unknown>
      const t = decodeHtmlEntities((snippet.title as string) ?? '')
      const ch = decodeHtmlEntities((snippet.channelTitle as string) ?? '')
      const videoId = i.id?.videoId
      const relevance = scoreYouTubeResultRelevance(query, t, ch)
      return { item: i, videoId, title: t, channelTitle: ch, relevance }
    })
    .filter((x): x is typeof x & { videoId: string } => Boolean(x.videoId))
    .sort((a, b) => b.relevance - a.relevance)

  if (scoredItems.length > 0) {
    console.info(
      `[youtube] relevance for "${query.slice(0, 60)}":`,
      scoredItems.slice(0, 3).map(x => `${x.relevance}:${x.title.slice(0, 50)}`).join(' | ')
    )
  }

  const viable = scoredItems.filter(x => x.relevance >= -5)
  const pool = viable.length > 0 ? viable : scoredItems
  if (pool.length === 0 || pool[0].relevance < 0) {
    console.info(
      `[youtube] no relevant match for "${query}" (best relevance ${pool[0]?.relevance ?? 'n/a'})`
    )
    return { status: 'not_found' }
  }
  const orderedIds = pool.map(x => x.videoId)
  const chosenId = await pickBestEmbeddableVideoId(orderedIds, apiKey)
  if (!chosenId) {
    return { status: 'not_found' }
  }
  const item = pool.find(x => x.videoId === chosenId)?.item ?? filteredItems.find(i => i.id?.videoId === chosenId) ?? filteredItems[0]
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
