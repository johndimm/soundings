import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import {
  getLLMModelApiId,
  getNextSongQuery,
  LLMProvider,
  ListenEvent,
  ExploreMode,
  SongSuggestion,
} from '@/app/lib/llm'
import {
  logLlmCallWithModel,
  logSpotifyBatchIdOutcome,
  logSpotifyBatchIdsSkipped,
} from '@/app/lib/llmSpotifyIdLog'
import { enrichAlbumArtIfMissing, getTracksByIds, searchTrack, type SpotifyTrack } from '@/app/lib/spotify'
import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import {
  searchYouTube,
  isYouTubeQuotaExceeded,
  getYouTubeQuotaWaitMs,
  getYouTubeSearchesRemaining,
  youtubeTrackFromVideoId,
} from '@/app/lib/youtube'
import { isYoutubeResolveTestServerEnabled } from '@/app/lib/youtubeResolveTestEnv'
import {
  getYoutubeResolveTestFixtureSuggestion,
  isYoutubeResolveTestFixtureSuggestion,
  YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
  YOUTUBE_RESOLVE_TEST_VIDEO_ID,
} from '@/app/lib/youtubeResolveTestDefaults'
import type { PlaybackSource } from '@/app/lib/playback/types'
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAccessTokenExpiry,
  refreshSpotifyAccessToken,
  TOKEN_REFRESH_THRESHOLD_MS,
} from '@/app/lib/spotify/tokens'
import {
  getRateLimitRemainingMs,
  getSpotifyOfflineWaitMs,
  isSpotifyAvailable,
  isSpotifyOffline,
  markRateLimited,
} from '@/app/lib/spotify/status'

const DEFAULT_FORCE_TEXT_SEARCH = true

export async function POST(req: NextRequest) {
  const [cookieStore, body] = await Promise.all([
    cookies(),
    req.json() as Promise<{
      sessionHistory: ListenEvent[]
      priorProfile?: string
      provider?: LLMProvider
      artistConstraint?: string
      notes?: string
      globalNotes?: string
      forceTextSearch?: boolean
      alreadyHeard?: string[]
      accessToken?: string
      mode?: ExploreMode
      numSongs?: number
      profileOnly?: boolean
      songsToResolve?: SongSuggestion[]
      source?: PlaybackSource
      /** Client echoes test mode (dev fallback if server env is missing in the route bundle). */
      youtubeResolveTest?: boolean
    }>,
  ])

  const allCookieNames = cookieStore.getAll().map(c => c.name)
  console.info('next-song: cookies present', allCookieNames)
  let accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value
  console.info('next-song: access token present from cookie', Boolean(accessToken))

  if (!accessToken && body.accessToken) {
    console.info('next-song: using accessToken from request body (cookie not present)')
    accessToken = body.accessToken
  }

  const hasResolveOnly = Boolean(body.songsToResolve && body.songsToResolve.length > 0)
  const llmOnlyNoSpotify = body.profileOnly === true && !hasResolveOnly

  /** Normalized playback source — JSON may omit `source` (undefined strips in some clients). */
  const rawSource =
    typeof body.source === 'string' ? body.source.trim().toLowerCase() : ''

  /** YouTube resolve test: profile-only batch skips LLM. Env + dev-only body echo (see PlayerClient). */
  const youtubeResolveTestEffective =
    isYoutubeResolveTestServerEnabled() ||
    (process.env.NODE_ENV === 'development' && body.youtubeResolveTest === true)

  const youtubeTestProfileOnly =
    body.profileOnly === true && !hasResolveOnly && youtubeResolveTestEffective

  /**
   * `songsToResolve` must bypass the outer gate so resolve runs (with its own offline checks).
   * Profile-only LLM (DJ buffer) skips Spotify on the server but still needs Spotify to be up for
   * IDs to matter — when `isSpotifyOffline()`, do not call the LLM (same gate as full next-song).
   */
  const skipGlobalSpotifyGate =
    hasResolveOnly ||
    (llmOnlyNoSpotify && !isSpotifyOffline()) ||
    youtubeTestProfileOnly

  if (!skipGlobalSpotifyGate && !isSpotifyAvailable()) {
    const waitMs = isSpotifyOffline() ? getSpotifyOfflineWaitMs() : getRateLimitRemainingMs()
    console.warn('[next-song] global Spotify gate blocked request', {
      hasResolveOnly,
      profileOnly: body.profileOnly,
      waitMs,
    })
    // Do NOT call markRateLimited here — that would extend the cooldown (min 30s) on every poll
    // while already blocked, trapping the client in perpetual 429.
    return Response.json(
      { error: 'rate_limited', retryAfterMs: waitMs },
      { status: 429 }
    )
  }

  const requestIsHttps = req.nextUrl.protocol === 'https:'

  // YouTube source never needs a Spotify token — skip refresh entirely.
  if (rawSource !== 'youtube') {
    const expiresAt = getAccessTokenExpiry(cookieStore)
    const shouldRefresh = expiresAt === null || expiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS
    if (shouldRefresh) {
      const refreshedToken = await refreshSpotifyAccessToken(cookieStore, requestIsHttps)
      if (refreshedToken) {
        accessToken = refreshedToken
      } else {
        console.warn('Spotify access token refresh failed; falling back to existing token')
      }
    }
  }

  if (!accessToken && rawSource !== 'youtube') {
    return Response.json({ error: 'not_authenticated' }, { status: 401 })
  }
  // For all Spotify paths below, accessToken is guaranteed to be present.
  const spotifyToken: string = accessToken ?? ''

  const { sessionHistory, priorProfile, provider, artistConstraint, notes, globalNotes, forceTextSearch, alreadyHeard, mode, profileOnly, songsToResolve, source } = body
  const combinedNotes = [notes, globalNotes].filter(Boolean).join('\n\n') || undefined

  // ── Resolve-only path: skip LLM, just look up provided songs ────────────
  if (songsToResolve && songsToResolve.length > 0) {
    console.info('[next-song] resolve-only', songsToResolve.length, 'songs', {
      source: source ?? 'spotify',
      forceTextSearch: forceTextSearch ?? DEFAULT_FORCE_TEXT_SEARCH,
    })

    const resolveAsYouTube =
      rawSource === 'youtube' ||
      (youtubeResolveTestEffective && songsToResolve.every(isYoutubeResolveTestFixtureSuggestion))

    if (resolveAsYouTube) {
      if (isYouTubeQuotaExceeded()) {
        return Response.json({ error: 'rate_limited', retryAfterMs: getYouTubeQuotaWaitMs() }, { status: 429 })
      }
      const { songs: ytSongs, quotaExceeded } = await resolveYouTubeSongs(songsToResolve, {
        useTestFixture: youtubeResolveTestEffective,
      })
      if (quotaExceeded) {
        return Response.json({ error: 'rate_limited', retryAfterMs: getYouTubeQuotaWaitMs() }, { status: 429 })
      }
      if (ytSongs.length === 0) return Response.json({ error: 'no_tracks_found' }, { status: 404 })
      return Response.json({ songs: ytSongs, ytSearchesRemaining: getYouTubeSearchesRemaining() })
    }

    if (isSpotifyOffline()) {
      const waitMs = getSpotifyOfflineWaitMs()
      markRateLimited(waitMs)
      return Response.json({ error: 'rate_limited', retryAfterMs: waitMs }, { status: 429 })
    }
    const { foundSongs, rateLimitedRetryMs, unauthorized } = await resolveSongs(
      songsToResolve,
      spotifyToken,
      forceTextSearch,
      sessionHistory ?? [],
      undefined
    )
    if (unauthorized) return Response.json({ error: 'not_authenticated' }, { status: 401 })
    if (rateLimitedRetryMs) markRateLimited(rateLimitedRetryMs)
    if (foundSongs.length === 0) {
      if (rateLimitedRetryMs) return Response.json({ error: 'rate_limited', retryAfterMs: rateLimitedRetryMs }, { status: 429 })
      return Response.json({ error: 'no_tracks_found' }, { status: 404 })
    }
    return Response.json({ songs: foundSongs })
  }

  // The fixture is a YouTube track — only short-circuit when the caller is in
  // YouTube mode. Otherwise a Spotify client would get a YouTube suggestion it
  // can't play, fail to resolve, and retry forever (see the flicker loop fixed
  // on the client in `resolveOneSuggestion` / `fetchSuggestions` / `fetchProfileOnly`).
  if (
    profileOnly === true &&
    youtubeResolveTestEffective &&
    !hasResolveOnly &&
    rawSource === 'youtube'
  ) {
    console.info('[next-song] YOUTUBE_RESOLVE_TEST: skipping LLM — fixture suggestion only', {
      rawSource: rawSource || '(missing)',
      devBodyFallback: !isYoutubeResolveTestServerEnabled() && body.youtubeResolveTest === true,
    })
    return Response.json({
      songs: [getYoutubeResolveTestFixtureSuggestion()],
      profile: undefined,
      suggestedArtists: [],
    })
  }

  let songs: SongSuggestion[]
  let profile: string | undefined
  let suggestedArtists: string[] = []
  try {
    const result = await getNextSongQuery(
      sessionHistory ?? [],
      provider,
      artistConstraint,
      combinedNotes,
      priorProfile,
      alreadyHeard,
      mode,
      body.numSongs
    )
    songs = result.songs
    profile = result.profile
    suggestedArtists = result.suggestedArtists ?? []
    const llmProvider = provider ?? 'deepseek'
    const llmModelId = getLLMModelApiId(llmProvider)
    const idsFromLlm = songs.filter(s => normalizeSpotifyTrackId(s.spotifyId)).length
    logLlmCallWithModel({
      provider: llmProvider,
      modelId: llmModelId,
      songCount: songs.length,
      idsFromLlm,
      profileOnly: body.profileOnly === true,
    })
  } catch (err) {
    console.error('LLM response error', err)
    return Response.json(
      { error: 'llm_response_invalid', message: (err as Error).message },
      { status: 502 }
    )
  }

  // ── Profile-only path: return LLM suggestions without any track lookup ──
  if (profileOnly) {
    return Response.json({ songs, profile, suggestedArtists })
  }

  // ── YouTube resolve path ──────────────────────────────────────────────────
  if (source === 'youtube') {
    if (isYouTubeQuotaExceeded()) {
      return Response.json({ error: 'rate_limited', retryAfterMs: getYouTubeQuotaWaitMs() }, { status: 429 })
    }
    const { songs: ytSongs, quotaExceeded } = await resolveYouTubeSongs(songs, {
      useTestFixture: youtubeResolveTestEffective,
    })
    if (quotaExceeded) {
      return Response.json({ error: 'rate_limited', retryAfterMs: getYouTubeQuotaWaitMs() }, { status: 429 })
    }
    if (ytSongs.length === 0) {
      return Response.json({ error: 'no_tracks_found' }, { status: 404 })
    }
    return Response.json({
      songs: ytSongs,
      profile,
      suggestedArtists,
      ytSearchesRemaining: getYouTubeSearchesRemaining(),
    })
  }

  // ── Spotify resolve path ─────────────────────────────────────────────────
  if (isSpotifyOffline()) {
    const waitMs = getSpotifyOfflineWaitMs()
    console.warn(`Spotify offline mode active (${waitMs}ms). Skipping lookup.`)
    markRateLimited(waitMs)
    return Response.json(
      { error: 'rate_limited', retryAfterMs: waitMs },
      { status: 429 }
    )
  }

  const llmLog = { provider: provider ?? 'deepseek', modelId: getLLMModelApiId(provider ?? 'deepseek') }
  const { foundSongs, rateLimitedRetryMs, unauthorized } = await resolveSongs(
    songs,
    spotifyToken,
    forceTextSearch,
    sessionHistory ?? [],
    llmLog
  )

  if (unauthorized) {
    return Response.json({ error: 'not_authenticated' }, { status: 401 })
  }

  if (rateLimitedRetryMs) {
    markRateLimited(rateLimitedRetryMs)
  }

  if (foundSongs.length === 0) {
    if (rateLimitedRetryMs) {
      return Response.json(
        { error: 'rate_limited', retryAfterMs: rateLimitedRetryMs },
        { status: 429 }
      )
    }

    return Response.json({ error: 'no_tracks_found' }, { status: 404 })
  }

  return Response.json({ songs: foundSongs, profile, suggestedArtists })
}

type YTFoundSong = { track: import('@/app/lib/youtube').YouTubeTrack; reason: string; category?: string; coords?: { x: number; y: number }; composed?: number; performer?: string }

async function resolveYouTubeSongs(
  songs: SongSuggestion[],
  opts?: { useTestFixture?: boolean }
): Promise<{ songs: YTFoundSong[]; quotaExceeded: boolean }> {
  const useFixture = opts?.useTestFixture ?? isYoutubeResolveTestServerEnabled()
  if (useFixture) {
    console.info('[next-song] resolveYouTubeSongs: YOUTUBE_RESOLVE_TEST — fixture only, no search')
    const track = youtubeTrackFromVideoId(YOUTUBE_RESOLVE_TEST_VIDEO_ID, YOUTUBE_RESOLVE_TEST_SEARCH_HINT)!
    return {
      songs: songs.map(song => ({
        track,
        reason: song.reason,
        category: song.category,
        coords: song.coords,
        composed: song.composed,
        performer: song.performer,
      })),
      quotaExceeded: false,
    }
  }
  const results: YTFoundSong[] = []
  for (const song of songs) {
    // Always search — LLM-provided video IDs are often hallucinated or non-embeddable.
    const res = await searchYouTube(song.search)
    if (res.status === 'ok') {
      results.push({ track: res.track, reason: song.reason, category: song.category, coords: song.coords, composed: song.composed, performer: song.performer })
    }
    if (res.status === 'quota_exceeded') {
      return { songs: results, quotaExceeded: true }
    }
  }
  return { songs: results, quotaExceeded: false }
}

const SEARCH_DELAY_MS = 1500

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type FoundSong = { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number }; composed?: number; performer?: string }

function buildTrackKey(track: SpotifyTrack) {
  return `${track.name.toLowerCase()}|${track.artist.toLowerCase()}`
}

function normaliseArtist(artist: string) {
  return artist.toLowerCase().replace(/^the\s+/, '').trim()
}

function trackIsDuplicate(
  track: SpotifyTrack,
  seen: Set<string>,
  produced: Set<string>,
  producedArtists: Set<string>
) {
  const key = buildTrackKey(track)
  if (seen.has(key) || produced.has(key)) return true
  const artistKey = normaliseArtist(track.artist)
  if (producedArtists.has(artistKey)) {
    console.info('next-song: skipping duplicate artist in batch', track.artist)
    return true
  }
  produced.add(key)
  producedArtists.add(artistKey)
  return false
}

async function resolveSongs(
  songs: { search: string; reason: string; spotifyId?: string; category?: string; coords?: { x: number; y: number }; composed?: number; performer?: string }[],
  accessToken: string,
  forceTextSearch = DEFAULT_FORCE_TEXT_SEARCH,
  sessionHistory: ListenEvent[],
  llmContext?: { provider: LLMProvider; modelId: string }
): Promise<{ foundSongs: FoundSong[]; rateLimitedRetryMs: number | null; unauthorized: boolean }> {
  const results: FoundSong[] = []
  let rateLimitedRetryMs: number | null = null
  let unauthorized = false

  const seenHistory = new Set(
    sessionHistory
      .map(e => `${e.track.toLowerCase()}|${e.artist.toLowerCase()}`)
      .filter(Boolean)
  )

  const produced = new Set<string>()
  const producedArtists = new Set<string>()
  const skipTrack = (track: SpotifyTrack) => trackIsDuplicate(track, seenHistory, produced, producedArtists)

  console.info('resolveSongs mode', {
    forceTextSearch,
    songs: songs.map(({ search, spotifyId }) => ({
      search,
      spotifyId: normalizeSpotifyTrackId(spotifyId) ?? '(none)',
    })),
  })

  const idToReason = new Map<string, string>()
  const idToCategory = new Map<string, string>()
  const idToCoords = new Map<string, { x: number; y: number }>()
  const idToComposed = new Map<string, number>()
  const idToPerformer = new Map<string, string>()
  const ids: string[] = []
  const idlessSongs = songs.filter(song => !normalizeSpotifyTrackId(song.spotifyId))
  for (const song of songs) {
    const id = normalizeSpotifyTrackId(song.spotifyId)
    if (!id) continue
    if (!idToReason.has(id)) {
      idToReason.set(id, song.reason)
      if (song.category) idToCategory.set(id, song.category)
      if (song.coords) idToCoords.set(id, song.coords)
      if (song.composed) idToComposed.set(id, song.composed)
      if (song.performer) idToPerformer.set(id, song.performer)
      ids.push(id)
    }
  }

  if (llmContext && ids.length > 0 && forceTextSearch) {
    logSpotifyBatchIdsSkipped({
      provider: llmContext.provider,
      modelId: llmContext.modelId,
      reason: 'forceTextSearch',
      idsThatWouldHaveBeenChecked: ids.length,
    })
  }

  let fallbackSongs = songs

  if (!forceTextSearch) {
    fallbackSongs = idlessSongs.slice()

    if (ids.length > 0) {
      const trackResult = await getTracksByIds(ids, accessToken)
      if (trackResult.status === 'rate_limited') {
        rateLimitedRetryMs = trackResult.retryAfterMs
        if (llmContext) {
          logSpotifyBatchIdsSkipped({
            provider: llmContext.provider,
            modelId: llmContext.modelId,
            reason: 'rate_limited',
            idsThatWouldHaveBeenChecked: ids.length,
          })
        }
      } else if (trackResult.status === 'unauthorized') {
        console.warn('Spotify batch lookup unauthorized, falling back to text search')
        if (llmContext) {
          logSpotifyBatchIdsSkipped({
            provider: llmContext.provider,
            modelId: llmContext.modelId,
            reason: 'unauthorized',
            idsThatWouldHaveBeenChecked: ids.length,
          })
        }
        fallbackSongs = songs
      } else if (trackResult.status === 'ok') {
        const idsNeedingSearch: typeof songs = []
        let verifiedBySpotify = 0
        let spotifyReturnedNull = 0
        trackResult.tracks.forEach((track, i) => {
          const requestedId = ids[i]
          if (!track) {
            spotifyReturnedNull++
            const song = songs.find(s => normalizeSpotifyTrackId(s.spotifyId) === requestedId)
            if (song) idsNeedingSearch.push(song)
            return
          }
          verifiedBySpotify++
          if (skipTrack(track)) return
          const reason = idToReason.get(track.id) ?? 'Spotify batch match'
          const category = idToCategory.get(track.id)
          const coords = idToCoords.get(track.id)
          const composed = idToComposed.get(track.id)
          const performer = idToPerformer.get(track.id)
          results.push({ track, reason, category, coords, composed, performer })
        })
        if (llmContext) {
          logSpotifyBatchIdOutcome({
            provider: llmContext.provider,
            modelId: llmContext.modelId,
            requestedIds: ids.length,
            verifiedBySpotify,
            spotifyReturnedNull,
          })
        }
        fallbackSongs = [...idlessSongs, ...idsNeedingSearch]
      } else {
        console.warn('Spotify batch fetch failed, falling back to text search', trackResult.message)
        if (llmContext) {
          logSpotifyBatchIdsSkipped({
            provider: llmContext.provider,
            modelId: llmContext.modelId,
            reason: 'error',
            idsThatWouldHaveBeenChecked: ids.length,
          })
        }
        fallbackSongs = songs
      }
    }
  }

  if (!rateLimitedRetryMs && fallbackSongs.length > 0 && !unauthorized) {
    const sequentialResult = await searchSongsSequential(
      fallbackSongs,
      accessToken,
      seenHistory,
      produced,
      producedArtists
    )
    results.push(...sequentialResult.foundSongs)
    if (sequentialResult.rateLimitedRetryMs) {
      rateLimitedRetryMs = sequentialResult.rateLimitedRetryMs
    }
    if (sequentialResult.unauthorized) {
      unauthorized = true
    }
  }

  // ID batch path skips search, so album.images can be empty — fill from search when same track id.
  if (!rateLimitedRetryMs && !unauthorized && results.length > 0) {
    for (let i = 0; i < results.length; i++) {
      const fs = results[i]
      if (fs.track.albumArt) continue
      const t = fs.track
      const hint =
        songs.find(s => normalizeSpotifyTrackId(s.spotifyId) === t.id)?.search ??
        `${t.name} ${t.artist}`
      const next = await enrichAlbumArtIfMissing(t, accessToken, hint)
      if (next.albumArt !== t.albumArt) {
        console.info('next-song: enriched album art via search', { id: t.id, hint: hint.slice(0, 60) })
        results[i] = { ...fs, track: next }
      }
    }
  }

  return { foundSongs: results, rateLimitedRetryMs, unauthorized }
}

async function searchSongsSequential(
  songs: { search: string; reason: string; category?: string; coords?: { x: number; y: number }; composed?: number; performer?: string }[],
  accessToken: string,
  seenHistory: Set<string>,
  produced: Set<string>,
  producedArtists: Set<string>
): Promise<{ foundSongs: FoundSong[]; rateLimitedRetryMs: number | null; unauthorized: boolean }> {
  console.info('searchSongsSequential list', songs.map(song => song.search))
  const results: FoundSong[] = []
  let rateLimitedRetryMs: number | null = null
  let unauthorized = false

  for (const song of songs) {
    const response = await searchTrack(song.search, accessToken)

    if (response.status === 'rate_limited') {
      rateLimitedRetryMs = response.retryAfterMs
      break
    }

    if (response.status === 'unauthorized') {
      unauthorized = true
      break
    }

    if (response.status === 'ok') {
      if (trackIsDuplicate(response.track, seenHistory, produced, producedArtists)) {
        continue
      }
      results.push({ track: response.track, reason: song.reason, category: song.category, coords: song.coords, composed: song.composed, performer: song.performer })
    }

    await sleep(SEARCH_DELAY_MS)
  }

  return { foundSongs: results, rateLimitedRetryMs, unauthorized }
}

