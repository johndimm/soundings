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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Remove leading genre/style labels the LLM sometimes puts in the search field. */
export function stripGenrePrefixesFromSearch(search: string, genrePrefixes: string[]): string {
  let s = search.trim()
  for (const raw of genrePrefixes) {
    const g = raw.trim()
    if (!g || g.length < 2) continue
    const re = new RegExp(`^${escapeRegExp(g)}\\s*[-–—:]\\s*`, 'i')
    s = s.replace(re, '').trim()
  }
  return s
}

/** Drop parenthetical movement names; keep main title for lookup. */
export function stripParentheticals(search: string): string {
  return search.replace(/\s*\([^)]{1,80}\)/g, '').replace(/\s+/g, ' ').trim()
}

export type SpotifySearchQueryOpts = {
  focusArtist?: string
  genrePrefixes?: string[]
}

/** Build Spotify search attempts for one LLM `search` row (genre-stripped + title/artist variants). */
export function spotifySearchQueriesForSong(search: string, opts?: SpotifySearchQueryOpts): string[] {
  const genrePrefixes = opts?.genrePrefixes ?? []
  const base = stripGenrePrefixesFromSearch(search, genrePrefixes)
  if (!base) return []

  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const t = s.trim()
    const k = t.toLowerCase()
    if (!t || seen.has(k)) return
    seen.add(k)
    out.push(t)
  }

  push(base)
  push(stripParentheticals(base))

  const dash = base.match(/^(.+?)\s*[-–—]\s*(.+)$/s)
  if (dash) {
    const left = dash[1].trim()
    const right = dash[2].trim()
    if (right.length >= 2) push(right)
    if (left.length >= 2 && right.length >= 2) {
      push(`${right} ${left}`)
      push(`${left} ${right}`)
    }
  }

  // "Concierto de Aranjuez (Adagio) Miles Davis" → artist at end
  const trailingArtist = base.match(/^(.+?)\s+([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,4})$/u)
  if (trailingArtist) {
    const title = trailingArtist[1].trim()
    const artist = trailingArtist[2].trim()
    push(`artist:"${artist}" ${stripParentheticals(title)}`)
    push(`${artist} ${stripParentheticals(title)}`)
    push(stripParentheticals(title))
  }

  const focus = opts?.focusArtist?.trim()
  if (focus) {
    let title = base
    const focusPrefix = new RegExp(`^${escapeRegExp(focus)}\\s*[-–—:]\\s*`, 'i')
    title = title.replace(focusPrefix, '').trim()
    if (title && !normalizeArtistName(title).includes(normalizeArtistName(focus))) {
      push(`artist:"${focus}" ${stripParentheticals(title)}`)
      push(`${focus} ${stripParentheticals(title)}`)
    }
  }

  return out
}
