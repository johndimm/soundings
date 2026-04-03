/** Strip whitespace and `spotify:track:` prefix so LLM can return URI or raw id. */
export function normalizeSpotifyTrackId(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s) return undefined
  const m = s.match(/^spotify:track:([a-zA-Z0-9]+)$/i)
  if (m) return m[1]
  return s
}
