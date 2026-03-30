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

export async function searchTrack(
  query: string,
  accessToken: string
): Promise<SpotifySearchResult> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '1' })
  console.info(`searching spotify for ${query}`)
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
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

  return {
    status: 'ok',
    track: {
      id: track.id,
      uri: track.uri,
      name: track.name,
      artist: track.artists[0]?.name ?? 'Unknown',
      album: track.album.name,
      albumArt: track.album.images[0]?.url ?? null,
      durationMs: track.duration_ms,
    },
  }
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
  const res = await fetch(`https://api.spotify.com/v1/tracks?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

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
}
