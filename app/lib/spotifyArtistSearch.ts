/** Build Spotify search attempts for one LLM `search` row. Uses the string as-is plus mechanical variants. */
export function spotifySearchQueriesForSong(search: string): string[] {
  const base = search.trim()
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

  const dash = base.match(/^(.+?)\s*[-–—]\s*(.+)$/)
  if (dash) {
    const left = dash[1].trim()
    const right = dash[2].trim()
    if (right.length >= 2) push(right)
    if (left.length >= 2 && right.length >= 2) {
      push(`${right} ${left}`)
      push(`${left} ${right}`)
    }
  }

  return out
}
