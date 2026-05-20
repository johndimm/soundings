const DEFAULT_NAME_MAX = 40

/** Short tab label from a track title. */
export function trackToChannelName(track: string, maxLen = DEFAULT_NAME_MAX): string {
  const raw = track.replace(/\s+/g, ' ').trim() || 'New Channel'
  if (raw.length <= maxLen) return raw
  if (maxLen < 2) return '…'
  return raw.slice(0, maxLen - 1) + '…'
}

/** Free-text description for a channel seeded from a track. */
export function trackToChannelNotes(track: string, artist: string, album?: string): string {
  const t = track.trim()
  const a = artist.trim()
  const lines = [`Channel inspired by: "${t}" by ${a}.`, 'Find similar tracks and artists.']
  const alb = album?.trim()
  if (alb) lines.splice(1, 0, `Album: ${alb}`)
  return lines.join('\n')
}

export function trackToChannelSeeds(
  track: string,
  artist: string,
  options?: { album?: string },
): { name: string; freeText: string; artists: string[] } {
  const a = artist.trim()
  return {
    name: trackToChannelName(track),
    freeText: trackToChannelNotes(track, artist, options?.album),
    artists: a ? [a] : [],
  }
}
