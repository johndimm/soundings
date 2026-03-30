import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getNextSongQuery, LLMProvider, ListenEvent } from '@/app/lib/llm'
import { getTracksByIds, searchTrack, type SpotifyTrack } from '@/app/lib/spotify'
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
  markSpotifyUnavailable,
} from '@/app/lib/spotify/status'

const DEFAULT_FORCE_TEXT_SEARCH = true

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  let accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value

  if (!isSpotifyAvailable()) {
    const waitMs = isSpotifyOffline() ? getSpotifyOfflineWaitMs() : getRateLimitRemainingMs()
    markRateLimited(waitMs)
    return Response.json(
      { error: 'rate_limited', retryAfterMs: waitMs },
      { status: 429 }
    )
  }

  const expiresAt = getAccessTokenExpiry(cookieStore)
  const shouldRefresh = expiresAt === null || expiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS

  if (shouldRefresh) {
    const refreshedToken = await refreshSpotifyAccessToken(cookieStore)
    if (refreshedToken) {
      accessToken = refreshedToken
    } else {
      console.warn('Spotify access token refresh failed; falling back to existing token')
    }
  }

  if (!accessToken) {
    markSpotifyUnavailable()
    return Response.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const { sessionHistory, priorProfile, provider, artistConstraint, notes, forceTextSearch } =
    (await req.json()) as {
    sessionHistory: ListenEvent[]
    priorProfile?: string
    provider?: LLMProvider
    artistConstraint?: string
    notes?: string
    forceTextSearch?: boolean
  }

  let songs: { search: string; reason: string }[]
  let profile: string | undefined
  try {
    const result = await getNextSongQuery(
      sessionHistory ?? [],
      provider,
      artistConstraint,
      notes,
      priorProfile
    )
    songs = result.songs
    profile = result.profile
  } catch (err) {
    console.error('LLM response error', err)
    return Response.json(
      { error: 'llm_response_invalid', message: (err as Error).message },
      { status: 502 }
    )
  }

  if (isSpotifyOffline()) {
    const waitMs = getSpotifyOfflineWaitMs()
    console.warn(`Spotify offline mode active (${waitMs}ms). Skipping lookup.`)
    markRateLimited(waitMs)
    return Response.json(
      { error: 'rate_limited', retryAfterMs: waitMs },
      { status: 429 }
    )
  }

  const { foundSongs, rateLimitedRetryMs, unauthorized } = await resolveSongs(
    songs,
    accessToken,
    forceTextSearch,
    sessionHistory ?? []
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

  return Response.json({ songs: foundSongs, profile })
}

const SEARCH_DELAY_MS = 250

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type FoundSong = { track: SpotifyTrack; reason: string }

function buildTrackKey(track: SpotifyTrack) {
  return `${track.name.toLowerCase()}|${track.artist.toLowerCase()}`
}

function trackIsDuplicate(track: SpotifyTrack, seen: Set<string>, produced: Set<string>) {
  const key = buildTrackKey(track)
  if (seen.has(key) || produced.has(key)) {
    return true
  }
  produced.add(key)
  return false
}

async function resolveSongs(
  songs: { search: string; reason: string; spotifyId?: string }[],
  accessToken: string,
  forceTextSearch = DEFAULT_FORCE_TEXT_SEARCH,
  sessionHistory: ListenEvent[]
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
  const skipTrack = (track: SpotifyTrack) => trackIsDuplicate(track, seenHistory, produced)

  console.info('resolveSongs mode', {
    forceTextSearch,
    songs: songs.map(({ search }) => search),
  })

  const idToReason = new Map<string, string>()
  const ids: string[] = []
  const idlessSongs = songs.filter(song => !(song.spotifyId?.trim()))
  for (const song of songs) {
    const id = song.spotifyId?.trim()
    if (!id) continue
    if (!idToReason.has(id)) {
      idToReason.set(id, song.reason)
      ids.push(id)
    }
  }

  let fallbackSongs = songs

  if (!forceTextSearch) {
    fallbackSongs = idlessSongs.slice()

    if (ids.length > 0) {
      const trackResult = await getTracksByIds(ids, accessToken)
      if (trackResult.status === 'rate_limited') {
        rateLimitedRetryMs = trackResult.retryAfterMs
      } else if (trackResult.status === 'unauthorized') {
        unauthorized = true
      } else if (trackResult.status === 'ok') {
      trackResult.tracks.forEach(track => {
        if (!track) return
        if (skipTrack(track)) return
        const reason = idToReason.get(track.id) ?? 'Spotify batch match'
        results.push({ track, reason })
      })
        fallbackSongs = idlessSongs.slice()
      } else {
        console.warn('Spotify batch fetch failed, falling back to text search', trackResult.message)
        fallbackSongs = songs
      }
    }
  }

  if (!rateLimitedRetryMs && fallbackSongs.length > 0 && !unauthorized) {
    const sequentialResult = await searchSongsSequential(
      fallbackSongs,
      accessToken,
      seenHistory,
      produced
    )
    results.push(...sequentialResult.foundSongs)
    if (sequentialResult.rateLimitedRetryMs) {
      rateLimitedRetryMs = sequentialResult.rateLimitedRetryMs
    }
    if (sequentialResult.unauthorized) {
      unauthorized = true
    }
  }

  return { foundSongs: results, rateLimitedRetryMs, unauthorized }
}

async function searchSongsSequential(
  songs: { search: string; reason: string }[],
  accessToken: string,
  seenHistory: Set<string>,
  produced: Set<string>
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
      if (trackIsDuplicate(response.track, seenHistory, produced)) {
        continue
      }
      results.push({ track: response.track, reason: song.reason })
    }

    await sleep(SEARCH_DELAY_MS)
  }

  return { foundSongs: results, rateLimitedRetryMs, unauthorized }
}

