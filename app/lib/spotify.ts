export async function searchTrack(
  query: string,
  accessToken: string
): Promise<SpotifyTrack | null> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '1' })
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  const track = data.tracks?.items?.[0]
  if (!track) return null
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists[0]?.name ?? 'Unknown',
    album: track.album.name,
    albumArt: track.album.images[0]?.url ?? null,
    durationMs: track.duration_ms,
  }
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
