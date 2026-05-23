
/**
 * Extract artist-name hints from channel title and notes for UI quick-picks.
 * The app does not classify names as genres vs acts — that is the LLM's job.
 */

const GENERIC_CHANNEL_NAMES = new Set(['new channel', 'all', 'untitled'])

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function pushArtistHint(out: string[], seen: Set<string>, raw: string) {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (t.length < 2 || t.length > 80) return
  const k = t.toLowerCase()
  if (seen.has(k)) return
  seen.add(k)
  out.push(t)
}

/** Artist names implied by channel title + notes (before / alongside LLM suggestions). */
export function extractArtistHintsFromChannel(input: {
  name?: string
  notes?: string
  genreText?: string
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const name = (input.name ?? '').trim()
  if (name && !GENERIC_CHANNEL_NAMES.has(normalizeKey(name))) {
    pushArtistHint(out, seen, name)
  }

  const notes = [input.notes, input.genreText].filter(Boolean).join('\n').trim()
  if (!notes) return out

  for (const m of notes.matchAll(/"([^"]{2,80})"|'([^']{2,80})'/g)) {
    pushArtistHint(out, seen, m[1] ?? m[2] ?? '')
  }

  const listLine = notes.match(
    /(?:^|\n)\s*(?:artists?|bands?|acts?|focus(?:\s+on)?)\s*[:—–-]\s*([^\n.]+)/im
  )
  if (listLine?.[1]) {
    for (const part of listLine[1].split(/[,;]/)) pushArtistHint(out, seen, part)
  }

  for (const m of notes.matchAll(
    /\b(?:only|just|all|mostly|mainly)\s+([A-ZÀ-ÿ][\w'’.-]*(?:\s+[A-Za-zÀ-ÿ][\w'’.-]*){0,5})/g
  )) {
    pushArtistHint(out, seen, m[1] ?? '')
  }

  return out
}

export function mergeArtistHintLists(...lists: string[][]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const name of list) pushArtistHint(out, seen, name)
  }
  return out
}

/** Channel title as an artist hint when it is not a generic placeholder name. */
export function channelNameAsArtistHint(name?: string): string | undefined {
  const t = (name ?? '').trim()
  if (!t || GENERIC_CHANNEL_NAMES.has(normalizeKey(t))) return undefined
  return t
}

/** When the channel title matches a candidate artist spelling, return canonical form. */
export function findArtistMatchingChannelName(
  channelName: string,
  candidates: string[]
): string | undefined {
  const key = normalizeKey(channelName)
  if (!key || GENERIC_CHANNEL_NAMES.has(key)) return undefined
  for (const candidate of candidates) {
    if (normalizeKey(candidate) === key) return candidate
  }
  return undefined
}

/** Include channel-title artist matches in the saved config artists list. */
export function mergeChannelNameArtistMatch(
  channelName: string,
  selectedArtists: string[],
  candidateArtists: string[]
): string[] {
  const match = findArtistMatchingChannelName(channelName, candidateArtists)
  if (!match) return selectedArtists
  return mergeArtistHintLists(selectedArtists, [match])
}

/** Trim and drop empty artist chip strings. */
export function sanitizeSelectedArtists(names: string[]): string[] {
  return names.filter(n => typeof n === 'string' && n.trim())
}
