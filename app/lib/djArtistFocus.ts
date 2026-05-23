/**
 * Build combined DJ constraint text for the LLM prompt.
 * Artists and channel settings are hints — the LLM decides how to use them.
 */

export function buildCombinedNotes(
  genres: string[],
  genreText: string,
  timePeriod: string,
  notes: string,
  popularity: number,
  regions: string[],
  artists: string[],
  artistText: string
): string {
  const parts: string[] = []
  if (genres.length > 0) parts.push(`Genres: ${genres.join(', ')}`)
  if (regions.length > 0) parts.push(`World region: ${regions.join(', ')}`)
  if (genreText.trim()) parts.push(`Style: ${genreText.trim()}`)
  if (artists.length > 0) parts.push(`Artists to lean toward: ${artists.join(', ')}`)
  if (artistText.trim()) parts.push(`Artist hints: ${artistText.trim()}`)
  if (timePeriod.trim()) parts.push(`Time period: ${timePeriod.trim()}`)
  if (notes.trim()) parts.push(notes.trim())
  if (popularity <= 20) parts.push('Popularity: obscure hidden gems only — avoid anything well-known or mainstream')
  else if (popularity <= 40) parts.push('Popularity: lean toward lesser-known tracks, avoid obvious hits')
  else if (popularity >= 80) parts.push('Popularity: well-known popular songs preferred')
  else if (popularity >= 60) parts.push('Popularity: lean toward recognizable songs')
  return parts.join('. ')
}
