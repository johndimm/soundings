import type { SpotifyTrack } from '@/app/lib/spotify'

export function normalizeArtistName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/** True when any credited artist matches the focus act (handles "Angine de poitrine" vs slight variants). */
export function trackMatchesFocusArtist(track: SpotifyTrack, focusArtist: string): boolean {
  const focus = normalizeArtistName(focusArtist)
  if (!focus) return true
  const names = [track.artist, ...(track.artists ?? [])].map(normalizeArtistName).filter(Boolean)
  return names.some(n => n.includes(focus) || focus.includes(n))
}

/** Search queries to try for one LLM row when resolving to Spotify. */
export function spotifySearchQueriesForSong(search: string, focusArtist?: string): string[] {
  const q = search.trim()
  if (!q) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const k = s.toLowerCase()
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(s)
  }

  push(q)
  const focus = focusArtist?.trim()
  if (!focus) return out

  let title = q
  const dashPrefix = `${focus} - `
  if (q.toLowerCase().startsWith(dashPrefix.toLowerCase())) {
    title = q.slice(dashPrefix.length).trim()
  }
  push(`artist:"${focus}" ${title}`)
  push(`${focus} ${title}`)
  return out
}
