import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getNextSongQuery, LLMProvider, ListenEvent, ExploreMode } from '@/app/lib/llm'
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
      forceTextSearch?: boolean
      alreadyHeard?: string[]
      accessToken?: string
      mode?: ExploreMode
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
    return Response.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const { sessionHistory, priorProfile, provider, artistConstraint, notes, forceTextSearch, alreadyHeard, mode } = body

  let songs: { search: string; reason: string }[]
  let profile: string | undefined
  try {
    const result = await getNextSongQuery(
      sessionHistory ?? [],
      provider,
      artistConstraint,
      notes,
      priorProfile,
      alreadyHeard,
      mode
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

type FoundSong = { track: SpotifyTrack; reason: string; category?: string; coords?: { x: number; y: number } }

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
  songs: { search: string; reason: string; spotifyId?: string; category?: string; coords?: { x: number; y: number } }[],
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
  const producedArtists = new Set<string>()
  const skipTrack = (track: SpotifyTrack) => trackIsDuplicate(track, seenHistory, produced, producedArtists)

  console.info('resolveSongs mode', {
    forceTextSearch,
    songs: songs.map(({ search }) => search),
  })

  const idToReason = new Map<string, string>()
  const idToCategory = new Map<string, string>()
  const idToCoords = new Map<string, { x: number; y: number }>()
  const ids: string[] = []
  const idlessSongs = songs.filter(song => !(song.spotifyId?.trim()))
  for (const song of songs) {
    const id = song.spotifyId?.trim()
    if (!id) continue
    if (!idToReason.has(id)) {
      idToReason.set(id, song.reason)
      if (song.category) idToCategory.set(id, song.category)
      if (song.coords) idToCoords.set(id, song.coords)
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
        const category = idToCategory.get(track.id)
        const coords = idToCoords.get(track.id)
        results.push({ track, reason, category, coords })
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

  return { foundSongs: results, rateLimitedRetryMs, unauthorized }
}

async function searchSongsSequential(
  songs: { search: string; reason: string; category?: string; coords?: { x: number; y: number } }[],
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
      results.push({ track: response.track, reason: song.reason, category: song.category, coords: song.coords })
    }

    await sleep(SEARCH_DELAY_MS)
  }

  return { foundSongs: results, rateLimitedRetryMs, unauthorized }
}

