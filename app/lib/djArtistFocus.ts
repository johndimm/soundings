import { channelNameAsArtistHint } from '@/app/lib/artistHintsFromNotes'
import { stripGenrePrefixesFromSearch, stripParentheticals } from '@/app/lib/spotifyArtistSearch'

/**
 * DJ artist-focus helpers. Focus applies when the user sets one artist chip, artist text,
 * names a channel after a real act, or passes an explicit override.
 */

export type DjArtistFocusHints = {
  explicit?: string
  selectedArtists?: string[]
  artistText?: string
  /** When the channel title is a band name (not a genre label), treat it as focus. */
  channelName?: string
}

/** Resolve single-artist focus for LLM + track lookup. */
export function resolveDjArtistConstraint(hints: DjArtistFocusHints): string | undefined {
  const fromArg = hints.explicit?.trim()
  if (fromArg) return fromArg

  const selected = (hints.selectedArtists ?? []).map(a => a.trim()).filter(Boolean)
  if (selected.length === 1) return selected[0]

  const fromText = hints.artistText?.trim()
  if (fromText && !fromText.includes(',') && fromText.length >= 3 && fromText.length <= 80) {
    return fromText
  }

  const fromChannel = channelNameAsArtistHint(hints.channelName)
  if (fromChannel && selected.length === 0) return fromChannel

  return undefined
}

/** @deprecated Use resolveDjArtistConstraint({ explicit, selectedArtists }) */
export function resolveDjArtistConstraintLegacy(
  explicit: string | undefined,
  selectedArtists: string[]
): string | undefined {
  return resolveDjArtistConstraint({ explicit, selectedArtists })
}

export function buildCombinedNotes(
  genres: string[],
  genreText: string,
  timePeriod: string,
  notes: string,
  popularity: number,
  regions: string[],
  artists: string[],
  artistText: string,
  focusArtist?: string
): string {
  const parts: string[] = []
  if (genres.length > 0) parts.push(`Genres: ${genres.join(', ')}`)
  if (regions.length > 0) parts.push(`World region: ${regions.join(', ')}`)
  if (genreText.trim()) parts.push(`Style: ${genreText.trim()}`)

  const focus =
    focusArtist?.trim() ||
    (artists.length === 1 ? artists[0]!.trim() : undefined)

  if (focus && artists.length <= 1) {
    parts.push(
      `FOCUS: Every song in each batch must be by "${focus}". Multiple tracks by this same act in one batch are required.`
    )
  } else if (artists.length > 1) {
    parts.push(
      `ARTIST LIST: Every song must be by one of: ${artists.join(', ')}. Use different names from this list per slot when possible; do not suggest artists outside this list.`
    )
  }

  if (artistText.trim()) parts.push(`More artist hints: ${artistText.trim()}`)
  if (timePeriod.trim()) parts.push(`Time period: ${timePeriod.trim()}`)
  if (notes.trim()) parts.push(notes.trim())
  if (popularity <= 20) parts.push('Popularity: obscure hidden gems only — avoid anything well-known or mainstream')
  else if (popularity <= 40) parts.push('Popularity: lean toward lesser-known tracks, avoid obvious hits')
  else if (popularity >= 80) parts.push('Popularity: well-known popular songs preferred')
  else if (popularity >= 60) parts.push('Popularity: lean toward recognizable songs')
  return parts.join('. ')
}

/** Genre/style labels from DJ chips + free text — used to strip LLM search prefixes. */
export function djGenrePrefixes(genres: string[], genreText?: string): string[] {
  const out = new Set<string>()
  for (const g of genres) {
    const t = g.trim()
    if (t.length >= 2) out.add(t)
  }
  const text = (genreText ?? '').trim()
  if (text) {
    for (const part of text.split(/[,;\n]+/)) {
      const t = part.trim()
      if (t.length >= 2) out.add(t)
    }
  }
  return [...out]
}

/**
 * Clean LLM search text before resolve. Does not prepend the focus artist (that produced
 * strings like "Miles Davis - Cool Jazz - Concierto…"); Spotify fallbacks use artist:"…" instead.
 */
export function enrichSearchWithFocusArtist(
  search: string,
  _focusArtist?: string,
  genrePrefixes?: string[]
): string {
  const stripped = stripGenrePrefixesFromSearch(search, genrePrefixes ?? [])
  return stripParentheticals(stripped) || search.trim()
}
