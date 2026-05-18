/**
 * DJ artist-focus helpers (single-artist channels such as Angine de poitrine).
 * Pure functions — safe for unit tests without React.
 */

/** Canonical name used in tests and docs for the French coldwave act. */
export const ANGINE_DE_POITRINE = 'Angine de poitrine'

const GENERIC_CHANNEL_NAME = /^(all|new channel|untitled|channel\s*\d*)$/i

export type DjArtistFocusHints = {
  explicit?: string
  selectedArtists?: string[]
  /** Channel title when the act is named there but not toggled in artist chips. */
  channelName?: string
  artistText?: string
}

/** Channel title is used as focus when it looks like an act name, not a generic label. */
export function channelNameAsArtistFocus(channelName?: string): string | undefined {
  const n = channelName?.trim()
  if (!n || n.length < 3) return undefined
  if (GENERIC_CHANNEL_NAME.test(n)) return undefined
  return n
}

/** Resolve the single-artist focus for LLM + track lookup. */
export function resolveDjArtistConstraint(hints: DjArtistFocusHints): string | undefined {
  const fromArg = hints.explicit?.trim()
  if (fromArg) return fromArg

  const selected = (hints.selectedArtists ?? []).map(a => a.trim()).filter(Boolean)
  if (selected.length === 1) return selected[0]

  const fromText = hints.artistText?.trim()
  if (fromText && !fromText.includes(',') && fromText.length >= 3 && fromText.length <= 80) {
    return fromText
  }

  return channelNameAsArtistFocus(hints.channelName)
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

/** Prefix focus artist on resolve when the LLM search line omitted the act name. */
export function enrichSearchWithFocusArtist(search: string, focusArtist: string | undefined): string {
  if (!focusArtist?.trim()) return search
  const focus = focusArtist.trim()
  if (search.toLowerCase().includes(focus.toLowerCase())) return search
  return `${focus} - ${search}`
}
