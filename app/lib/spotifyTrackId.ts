/**
 * Normalize LLM/user input to a bare Spotify track id.
 * Accepts: raw id, spotify:track:… URI, or open.spotify.com/track/… (models often paste links).
 */
export function normalizeSpotifyTrackId(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  let s = String(raw).trim()
  if (!s) return undefined

  // LLMs often emit placeholder text instead of omitting the field.
  if (/^(none|null|n\/a|unknown|omit|tbd|\?|—|-)$/i.test(s)) return undefined

  const fromUrl = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([0-9A-Za-z]{22})\b/i)
  if (fromUrl) return fromUrl[1]

  const fromUri = s.match(/^spotify:track:([0-9A-Za-z]{22})$/i)
  if (fromUri) return fromUri[1]

  if (/^[0-9A-Za-z]{22}$/.test(s)) return s

  const looseUri = s.match(/^spotify:track:([a-zA-Z0-9]+)$/i)
  if (looseUri) return looseUri[1]

  return s
}
