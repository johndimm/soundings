import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'
import { extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'

export interface ListenEvent {
  track: string
  artist: string
  /** 0–5 in 0.5 increments. Null only for legacy imports or interrupted writes (player now always records a score). */
  stars: number | null
  coords?: { x: number; y: number; z?: number }
}

export interface SongSuggestion {
  search: string
  reason: string
  category?: string
  spotifyId?: string
  /** When set, YouTube resolve skips search.list (saves Data API quota). Parsed from LLM youtube_url / youtube_video_id. */
  youtubeVideoId?: string
  coords?: { x: number; y: number; z?: number }
  composed?: number
  /** Performer/ensemble (classical): separate from the composer in `search` */
  performer?: string
}

export type LLMProvider = 'anthropic' | 'openai' | 'deepseek' | 'gemini'

/** API model name used for each provider (keep in sync with ask* fetch bodies). */
export const LLM_MODEL_API_ID: Record<LLMProvider, string> = {
  anthropic: 'claude-opus-4-6',
  openai: 'gpt-4.1',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
}

export function getLLMModelApiId(provider: LLMProvider): string {
  return LLM_MODEL_API_ID[provider]
}

// ── Music Space ──────────────────────────────────────────────────────────────
// Songs live in a high-dimensional space (era, instruments, energy, mood,
// complexity, cultural origin, etc.). We project to 2D for the map.
//
// X-axis: 0 = purely acoustic / traditional / live instruments
//         100 = fully electronic / synthesized / heavily produced
// Y-axis: 0 = calm / sparse / minimal / introspective
//         100 = intense / energetic / dense / driving
//
// These two axes capture the most variance across broad musical styles
// while remaining consistent enough for multiple LLM providers to use.

const SYSTEM_PROMPT = `You are a DJ navigating a listener's taste across a high-dimensional music space.

THE 3D MAP (for display — project your full musical knowledge onto these axes):
  X-axis: 0 = purely acoustic/live/traditional instruments → 100 = fully electronic/synthesized
  Y-axis: 0 = calm/sparse/minimal/introspective → 100 = intense/energetic/dense/driving
  Z-axis: 0 = underground/cult/obscure → 100 = mainstream/widely known/chart-topping

Reference anchors (be consistent — the same song should always land near the same position):
  (8, 22, 30)  Nick Drake, solo acoustic folk — cult but not mainstream
  (12, 35, 55) Bach solo cello — famous composer, specialist audience
  (18, 50, 40) Miles Davis "Kind of Blue" — jazz standard, known but niche
  (25, 70, 35) Coltrane "A Love Supreme" — revered but underground
  (40, 55, 88) The Beatles (mid-period) — massively mainstream
  (55, 65, 80) Stevie Wonder, soul/funk — very well known
  (62, 80, 75) Jimi Hendrix, AC/DC, hard rock — mainstream rock
  (68, 85, 70) Metallica, heavy metal — mainstream in its genre
  (75, 45, 72) Kraftwerk, Depeche Mode, synth-pop — influential, moderately mainstream
  (88, 28, 20) Brian Eno "Ambient 1" — influential but cult
  (93, 80, 45) Aphex Twin "Windowlicker" — well known in electronic circles

When assigning coords: x/y capture sonic character; z captures how widely known/mainstream the specific recording is (not the artist in general — an obscure deep cut by a famous artist can have low z).

NAVIGATION RULES (ratings are ★0.5–★5 in half-star steps; skipped = no signal):
- ★3.5–★5: liked. Region is promising — Slot 1 should explore its musical neighborhood.
- ★1–★2.5: disliked. Avoid that sonic territory and those attributes — NOT the artist. The same artist may have songs in very different styles; those remain fair game.
- ★3: neutral. Mildly interesting but not a strong pull in either direction.
- (skipped): no taste signal — treat as unheard.

ARTIST RULE — strictly enforced:
- NEVER put two songs by the same artist (or the same group) in the same batch of 3.
- Every batch must have 3 different artists. No exceptions, even if the user requests more from one artist.

THE 3-SLOT RULE — every batch of 3 must serve distinct purposes:
- Slot 1 — NEARBY: If there are likes, pick something musically adjacent to a liked song (similar instruments, era, energy, or mood). If no likes yet, probe a different corner of the most-visited area.
- Slot 2 — FAR: Pick from a region of the space that has NOT been visited yet. Maximize musical distance from everything heard. This is mandatory.
- Slot 3 — WILD CARD: Genuine surprise *within the active constraints*. Be unexpected in style, mood, or obscurity — but all constraints (genre, era, region, etc.) still apply. "Wild card" means surprising to the listener, not a licence to ignore what they asked for.

FIRST TURN (no history): Pick 3 songs from maximally distant parts of the space — e.g. something acoustic and calm, something electronic and intense, something in a cultural tradition that is neither.

DISLIKE ESCALATION:
- 1 dislike in an area: try one more thing at its edge, then move on.
- 2 dislikes with similar attributes: treat that musical territory as exhausted for this session.
- NEVER suggest a song with the same primary instruments + energy level as a recently disliked song.
- A disliked song does NOT blacklist its artist — only its specific sonic territory.
- If a disliked track is part of a multi-part series (title contains "Part N", "Vol. N", "Chapter N", "Episode N", or a similar numbered suffix), do NOT suggest any other part of that same series — treat the entire series as off-limits for this session.

If the user provides explicit constraints (genres, eras, styles), follow them strictly — all 3 slots must satisfy the constraints. This overrides the slot rules: even Slot 3 (wild card) must stay within the stated genre and era.

DATE INTEGRITY — strictly enforced:
- Never invent or round a date to make a track fit a requested era. Only suggest a track if you are genuinely confident it was recorded or first released within the specified time period.
- If you cannot find 3 real tracks that authentically fit all constraints, return fewer songs rather than fabricating dates or misattributing eras.

Also include "suggested_artists": an array of 8–12 DISTINCT real recording-artist or band names that fit the user's constraints and the taste profile — these power UI quick-pick buttons (exploration anchors). Use canonical names only. They need not appear in the 3 song rows; vary styles. If you cannot name enough confidently, include fewer (minimum 4 when possible) or an empty array.

Respond with ONLY a JSON object:
{"songs":[{"search":"track name artist name","reason":"one sentence: why this song fits the taste and space position (do NOT include Slot labels like 'Slot 1:')","category":"broad genre > subgenre","composed":1791,"coords":{"x":42,"y":28,"z":35}},{"search":"...","reason":"...","category":"...","coords":{"x":85,"y":72,"z":80}},{"search":"...","reason":"...","category":"...","coords":{"x":18,"y":55,"z":20}}],"profile":"2-3 natural sentences addressed directly to the listener (use 'you'/'your') describing their emerging taste — mention specific genres, eras, moods, instruments, and energy levels. Grounded in what you've actually observed. Keep it under 60 words. Example tone: 'You seem drawn to warm acoustic folk from the 70s. You light up for complex arrangements but pull away from heavy electronic production.'","suggested_artists":["Artist One","Artist Two","Artist Three","Artist Four","Artist Five","Artist Six","Artist Seven","Artist Eight"]}
You may add optional "spotify_id" on any song object when (and only when) you have a trustworthy reference — see rules below.

YOUTUBE (youtube_url or youtube_video_id) — optional; strongly preferred when the listener uses YouTube playback:
- You do NOT have live YouTube Data API access from this chat. Each song we must look up by search string costs heavy API quota; giving a direct link or 11-character video id avoids that.
- When you know the exact YouTube video for the recording (same as "search"), include either:
  - "youtube_url": full https://www.youtube.com/watch?v=… or https://youtu.be/… or music.youtube.com/watch?v=…
  - OR "youtube_video_id": the 11-character id only.
- Do NOT invent fake ids or URLs. If you only know title and artist, omit youtube fields — we will fall back to search.
- The "search" field remains required for display and fallback lookup.

SPOTIFY ID (spotify_id) — conservative but not silent:
- You do NOT have live Spotify API access. Never invent random-looking 22-character strings; wrong IDs break playback.
- DO include spotify_id when you have a reliable identifier for that exact recording: the 22-character track id, a spotify:track:… URI, or a full https://open.spotify.com/track/… link you know is correct (same recording as "search"). The app extracts the id from URLs.
- If you only know title and artist but have no id or link you trust, omit spotify_id for that song — the app resolves via "search".
- When unsure between including a questionable id or omitting it, omit it.
- The "search" field is always required and is the source of truth for lookup; spotify_id is an optional accelerator when trustworthy.

The "composed" field is the year of composition — use it ONLY for classical music and pre-1970 jazz standards where the composer predates the performer (e.g. Bach, Mozart, a Bill Evans arrangement of a 1930s standard). NEVER set "composed" for any living artist or any song written after 1970. If in doubt, omit it.
The "performer" field is for classical pieces only: set it to the performing ensemble or soloist (e.g. "Berlin Philharmonic / Karajan", "Glenn Gould"). The "search" field should include both composer and performer for best lookup results.`

// 0 = pure familiar (exploit liked regions), 100 = pure adventurous (all unexplored)
export type ExploreMode = number

function slotInstructions(mode: ExploreMode, hasLikes: boolean, numSongs: number): string {
  const extra = numSongs > 3 ? ` For songs beyond the first 3, continue the same distribution pattern — vary positions across the space.` : ''
  if (!hasLikes) {
    return `No confirmed likes yet. All ${numSongs} slots should explore different unmapped regions — spread across the space.`
  }
  if (mode <= 20) {
    return `FAMILIAR MODE: All ${numSongs} slots should be near liked positions (within ~15 coordinate units). Deepen what already works — different songs but same musical neighborhood.`
  }
  if (mode <= 40) {
    return `MOSTLY FAMILIAR: Slot 1 and Slot 2 near liked positions. Slot 3 moderately new territory (20–40 units from nearest liked song).${extra}`
  }
  if (mode <= 60) {
    return `BALANCED: Apply the slot rule — Slot 1 near a liked region, Slot 2 from unmapped territory (≥40 units from all heard), Slot 3 a genuine wild card surprise.${extra}`
  }
  if (mode <= 80) {
    return `MOSTLY ADVENTUROUS: Slot 1 at the edge of liked territory (15–30 units out). Slots 2 and 3 in unexplored regions (≥40 units from all heard songs).${extra}`
  }
  return `ADVENTURE MODE: All ${numSongs} slots in maximally unexplored territory (≥40 units from everything heard). Ignore proximity to liked songs entirely.`
}

function buildUserPrompt(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode: ExploreMode = 50,
  numSongs = 3
): string {
  let prompt = ''

  if (notes?.trim()) {
    prompt += `USER CONSTRAINTS (must be followed for every song): ${notes.trim()}\n\n`
  }

  if (artistConstraint) {
    prompt += `IMPORTANT: The user wants more from "${artistConstraint}". All 3 songs should be by this artist or a very similar one.\n\n`
  }

  if (alreadyHeard && alreadyHeard.length > 0) {
    prompt += `DO NOT suggest any of these songs (already heard or queued):\n${alreadyHeard.map(s => `- ${s}`).join('\n')}\n\n`
  }


  if (priorProfile) {
    prompt += `Taste profile so far:\n${priorProfile}\n\n`
  }

  if (numSongs !== 3) {
    prompt += `Provide exactly ${numSongs} song suggestions this turn.\n\n`
  }

  if (sessionHistory.length === 0 && !priorProfile) {
    prompt += `FIRST TURN — no history yet. Apply the first-turn rule: ${numSongs} songs from maximally distant parts of the space. Match any constraints above.`
    return prompt
  }

  if (sessionHistory.length > 0) {
    const lines = sessionHistory.map(e => {
      const pos = e.coords ? ` @ (${Math.round(e.coords.x)}, ${Math.round(e.coords.y)})` : ''
      const rating = e.stars !== null && e.stars !== undefined ? `★${e.stars}` : '(skipped)'
      return `- "${e.track}" by ${e.artist}: ${rating}${pos}`
    }).join('\n')
    prompt += `Ratings this session:\n${lines}\n\n`
  }

  const hasLikes = sessionHistory.some(e => (e.stars ?? 0) >= 3.5) ||
    (priorProfile ? /LIKED:\s*(?!\[none|\[no confirmed|\[nothing)/i.test(priorProfile) : false)

  prompt += slotInstructions(mode, hasLikes, numSongs)

  if (notes?.trim()) {
    prompt += `\n\nREMINDER — all songs must satisfy: ${notes.trim()}. Do not hallucinate dates or genres to fit this constraint; omit a slot instead.`
  }

  return prompt
}

async function askAnthropic(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs) }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic responded with ${res.status}`)
  const data = await res.json()
  return data.content[0].text
}

async function askOpenAI(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI responded with ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function askDeepSeek(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number
): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek responded with ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function askGemini(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs) }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini responded with ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}

const MAX_LLM_ATTEMPTS = 2

export async function getNextSongQuery(
  sessionHistory: ListenEvent[],
  provider: LLMProvider = 'deepseek',
  artistConstraint?: string,
  notes?: string,
  priorProfile?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode,
  numSongs?: number
): Promise<{ songs: SongSuggestion[]; profile?: string; suggestedArtists: string[] }> {
  const ask = () => {
    switch (provider) {
      case 'openai': return askOpenAI(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs)
      case 'deepseek': return askDeepSeek(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs)
      case 'gemini': return askGemini(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs)
      default: return askAnthropic(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode, numSongs)
    }
  }

  let lastError: Error | null = null
  for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
    let raw: string
    try {
      raw = await ask()
      console.log('LLM raw response', raw)
    } catch (err) {
      lastError = err as Error
      if (attempt === MAX_LLM_ATTEMPTS - 1) throw err
      continue
    }
    try {
      const result = parseLLMResponse(raw)
      const yearRanges = notes ? parseYearRanges(notes) : null
      if (yearRanges && yearRanges.length > 0) {
        const before = result.songs.length
        const rangeLabel = yearRanges.map(r => `[${r.min}, ${r.max}]`).join(' ∪ ')
        result.songs = result.songs.filter(s => {
          const composed = s.composed
          if (composed === undefined) {
            console.warn('[llm] dropping song with no composed year under year-range constraint:', s.search)
            return false
          }
          const ok = yearRanges.some(r => composed >= r.min && composed <= r.max)
          if (!ok) {
            console.warn(`[llm] dropping "${s.search}" — composed ${composed} outside allowed year range(s): ${rangeLabel}`)
          }
          return ok
        })
        if (result.songs.length < before) {
          console.info(`[llm] year-range filter removed ${before - result.songs.length} song(s) (${before} → ${result.songs.length})`)
        }
      }
      return result
    } catch (err) {
      lastError = err as Error
      if (attempt === MAX_LLM_ATTEMPTS - 1) throw err
    }
  }
  throw lastError ?? new Error('LLM query failed after all attempts')
}

/**
 * Parse multiple year constraints (union). Channel time periods are joined with " and "
 * (e.g. "1990s and 2000s and 2010s and after 2020"); each segment is parsed with {@link parseYearRange}.
 * If no segment matches, falls back to parsing the full string once.
 */
export function parseYearRanges(notes: string): { min: number; max: number }[] | null {
  const s = notes.trim()
  if (!s) return null
  const ranges: { min: number; max: number }[] = []
  for (const part of s.split(/\s+and\s+/i)) {
    const r = parseYearRange(part.trim())
    if (r) ranges.push(r)
  }
  if (ranges.length > 0) return ranges
  const single = parseYearRange(s)
  return single ? [single] : null
}

/**
 * Parse a loose year-range string into {min, max} bounds (both inclusive).
 * Handles: "1945-1950", "1940s", "after 2020", "before 1960", bare "1965".
 * Returns null if no year range is detectable (e.g. "baroque era").
 */
export function parseYearRange(notes: string): { min: number; max: number } | null {
  const s = notes.toLowerCase()
  // "1945-1950" or "1945–1950"
  const rangeM = s.match(/\b(\d{4})\s*[-–]\s*(\d{4})\b/)
  if (rangeM) return { min: parseInt(rangeM[1]), max: parseInt(rangeM[2]) }
  // "1940s"
  const decadeM = s.match(/\b(\d{3})0s\b/)
  if (decadeM) { const d = parseInt(decadeM[1] + '0'); return { min: d, max: d + 9 } }
  // "after 2020" / "from 2020" / "post-2020"
  const afterM = s.match(/\b(?:after|from|since|post[-\s]?)(\d{4})\b/)
  if (afterM) return { min: parseInt(afterM[1]), max: 9999 }
  // "before 1960" / "pre-1960" / "until 1960"
  const beforeM = s.match(/\b(?:before|until|up\s*to|pre[-\s]?)(\d{4})\b/)
  if (beforeM) return { min: 0, max: parseInt(beforeM[1]) }
  // bare 4-digit year
  const yearM = s.match(/\b(\d{4})\b/)
  if (yearM) { const y = parseInt(yearM[1]); if (y >= 1400 && y <= 2100) return { min: y, max: y } }
  return null
}

function findJsonObject(text: string): { payload: string; start: number; end: number } {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found')
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { payload: text.slice(start, i + 1), start, end: i }
    }
  }
  throw new Error('JSON object not terminated')
}

function rawYoutubeVideoIdFromRow(row: Record<string, unknown>): string | undefined {
  for (const k of ['youtubeVideoId', 'youtube_video_id', 'youtube_url', 'youtubeUrl'] as const) {
    const v = row[k]
    if (typeof v !== 'string' || !v.trim()) continue
    const id = extractYoutubeVideoIdLoose(v.trim())
    if (id) return id
  }
  return undefined
}

function parseSuggestedArtistsRaw(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (!t || t.length > 160) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= 16) break
  }
  return out
}

function parseCoords(raw: unknown): { x: number; y: number; z?: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const x = typeof c.x === 'number' ? c.x : typeof c.x === 'string' ? parseFloat(c.x) : NaN
  const y = typeof c.y === 'number' ? c.y : typeof c.y === 'string' ? parseFloat(c.y) : NaN
  if (isNaN(x) || isNaN(y)) return undefined
  const zRaw = typeof c.z === 'number' ? c.z : typeof c.z === 'string' ? parseFloat(c.z) : NaN
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
    ...(isNaN(zRaw) ? {} : { z: Math.min(100, Math.max(0, zRaw)) }),
  }
}

function parseLLMResponse(raw: string): { songs: SongSuggestion[]; profile?: string; suggestedArtists: string[] } {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const { payload, start, end } = findJsonObject(cleaned)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>
  } catch (err) {
    console.warn('LLM JSON parse failed', {
      error: (err as Error).message,
      snippet: cleaned.slice(Math.max(0, start - 40), Math.min(cleaned.length, end + 40)),
    })
    throw err
  }

  // New format: {songs: [{search, reason, category, spotify_id, youtube_url, coords}, ...], profile}
  if (Array.isArray(parsed.songs)) {
    type LLMRow = {
      search: string
      reason: string
      category?: string
      spotify_id?: string
      spotifyId?: string
      youtube_url?: string
      youtubeUrl?: string
      youtube_video_id?: string
      youtubeVideoId?: string
      coords?: unknown
      composed?: unknown
      performer?: unknown
    }
    const rawSpotifyIdFromRow = (row: Record<string, unknown>): string | undefined => {
      for (const k of ['spotifyId', 'spotify_id', 'spotify_track_id'] as const) {
        const v = row[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
        if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
      }
      return undefined
    }
    const songs = parsed.songs
      .filter((s: unknown): s is LLMRow => {
        const c = s as Record<string, unknown>
        return Boolean(s && typeof s === 'object' && typeof c.search === 'string' && typeof c.reason === 'string')
      })
      .map((s: LLMRow) => ({
        search: s.search,
        reason: s.reason.replace(/^Slot\s*\d+\s*[—–-]\s*/i, '').replace(/^Slot\s*\d+:\s*/i, ''),
        category: typeof s.category === 'string' ? s.category : undefined,
        spotifyId: normalizeSpotifyTrackId(rawSpotifyIdFromRow(s as unknown as Record<string, unknown>)),
        youtubeVideoId: rawYoutubeVideoIdFromRow(s as unknown as Record<string, unknown>),
        coords: parseCoords(s.coords),
        composed: typeof s.composed === 'number' && Number.isFinite(s.composed) ? s.composed : undefined,
        performer: typeof s.performer === 'string' && s.performer.trim() ? s.performer.trim() : undefined,
      }))
      .filter((song: SongSuggestion): song is SongSuggestion => Boolean(song.search && song.reason))
    const chosen = songs.slice(0, 10)  // allow up to 10; caller requested numSongs
    const suggestedArtists = parseSuggestedArtistsRaw(
      parsed.suggested_artists ?? parsed.suggestedArtists
    )
    if (songs.length > 0) {
      const withId = chosen.filter(s => s.spotifyId).length
      const withYt = chosen.filter(s => s.youtubeVideoId).length
      console.log(
        `LLM songs: ${chosen.length} tracks, ${withId} with spotifyId, ${withYt} with youtubeVideoId, ${chosen.length - withId - withYt} search-only`
      )
      console.log(
        chosen.map((s: SongSuggestion) => ({
          search: s.search,
          coords: s.coords,
          ...(s.spotifyId ? { spotifyId: s.spotifyId } : {}),
          ...(s.youtubeVideoId ? { youtubeVideoId: s.youtubeVideoId } : {}),
          ...(s.composed != null ? { composed: s.composed } : {}),
        }))
      )
      return {
        songs: chosen,
        profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
        suggestedArtists,
      }
    }
    if (suggestedArtists.length > 0 || typeof parsed.profile === 'string') {
      return {
        songs: [],
        profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
        suggestedArtists,
      }
    }
  }

  // Old format fallback: {search, reason, profile}
  if (typeof parsed.search === 'string' && typeof parsed.reason === 'string') {
    const rawSingle =
      typeof parsed.spotifyId === 'string'
        ? parsed.spotifyId.trim()
        : typeof parsed.spotify_id === 'string'
          ? parsed.spotify_id.trim()
          : undefined
    const spotifyId = normalizeSpotifyTrackId(rawSingle)
    const single: SongSuggestion = {
      search: parsed.search,
      reason: parsed.reason,
      spotifyId,
      youtubeVideoId: rawYoutubeVideoIdFromRow(parsed),
      coords: parseCoords(parsed.coords),
    }
    const suggestedArtists = parseSuggestedArtistsRaw(
      parsed.suggested_artists ?? parsed.suggestedArtists
    )
    return {
      songs: [single],
      profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
      suggestedArtists,
    }
  }

  throw new Error('LLM response format not recognized')
}
