import { normalizeSpotifyTrackId } from '@/app/lib/spotifyTrackId'

export interface ListenEvent {
  track: string
  artist: string
  percentListened: number
  reaction: 'move-on' | 'not-now' | 'more-from-artist'
  coords?: { x: number; y: number; z?: number }
}

export interface SongSuggestion {
  search: string
  reason: string
  category?: string
  spotifyId?: string
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
  gemini: 'gemini-2.5-flash-preview-04-17',
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

NAVIGATION RULES (use full musical knowledge, not just the 2D projection):
- Song liked (≥50% listened): region is promising. Slot 1 should explore its musical neighborhood.
- Song disliked (<50%): avoid that musical territory and those sonic attributes — NOT the artist. A dislike is about the sound of that track, not a rejection of the artist. The same artist may have songs in very different styles; those remain fair game.
- "not-now": skip; not a taste signal.
- "more-from-artist": Slot 1 may be this artist or a close musical peer. Slots 2 and 3 must explore distant territory.

ARTIST RULE — strictly enforced:
- NEVER put two songs by the same artist (or the same group) in the same batch of 3.
- Every batch must have 3 different artists. No exceptions, even if the user requests more from one artist.

THE 3-SLOT RULE — every batch of 3 must serve distinct purposes:
- Slot 1 — NEARBY: If there are likes, pick something musically adjacent to a liked song (similar instruments, era, energy, or mood). If no likes yet, probe a different corner of the most-visited area.
- Slot 2 — FAR: Pick from a region of the space that has NOT been visited yet. Maximize musical distance from everything heard. This is mandatory.
- Slot 3 — WILD CARD: Genuine surprise. Cross musical lines the listener hasn't crossed. Make it interesting.

FIRST TURN (no history): Pick 3 songs from maximally distant parts of the space — e.g. something acoustic and calm, something electronic and intense, something in a cultural tradition that is neither.

DISLIKE ESCALATION:
- 1 dislike in an area: try one more thing at its edge, then move on.
- 2 dislikes with similar attributes: treat that musical territory as exhausted for this session.
- NEVER suggest a song with the same primary instruments + energy level as a recently disliked song.
- A disliked song does NOT blacklist its artist — only its specific sonic territory.

If the user provides explicit constraints (genres, eras, styles), follow them strictly — all 3 slots must satisfy the constraints.

Respond with ONLY a JSON object:
{"songs":[{"search":"track name artist name","reason":"one sentence: slot role, position in space, why this song","category":"broad genre > subgenre","composed":1791,"coords":{"x":42,"y":28,"z":35}},{"search":"...","reason":"...","category":"...","coords":{"x":85,"y":72,"z":80}},{"search":"...","reason":"...","category":"...","coords":{"x":18,"y":55,"z":20}}],"profile":"2-3 natural sentences addressed directly to the listener (use 'you'/'your') describing their emerging taste — mention specific genres, eras, moods, instruments, and energy levels. Grounded in what you've actually observed. Keep it under 60 words. Example tone: 'You seem drawn to warm acoustic folk from the 70s. You light up for complex arrangements but pull away from heavy electronic production.'"}
You may add optional "spotify_id" on any song object when (and only when) you have a trustworthy reference — see rules below.

SPOTIFY ID (spotify_id) — conservative but not silent:
- You do NOT have live Spotify API access. Never invent random-looking 22-character strings; wrong IDs break playback.
- DO include spotify_id when you have a reliable identifier for that exact recording: the 22-character track id, a spotify:track:… URI, or a full https://open.spotify.com/track/… link you know is correct (same recording as "search"). The app extracts the id from URLs.
- If you only know title and artist but have no id or link you trust, omit spotify_id for that song — the app resolves via "search".
- When unsure between including a questionable id or omitting it, omit it.
- The "search" field is always required and is the source of truth for lookup; spotify_id is an optional accelerator when trustworthy.

The "composed" field is the year of composition (for classical/jazz standards/etc.) — omit it for contemporary recordings where the release year is meaningful.
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
      return `- "${e.track}" by ${e.artist}: ${Math.round(e.percentListened)}% [${e.reaction}]${pos}`
    }).join('\n')
    prompt += `Ratings this session:\n${lines}\n\n`
  }

  const hasLikes = sessionHistory.some(e => e.percentListened >= 50) ||
    (priorProfile ? /LIKED:\s*(?!\[none|\[no confirmed|\[nothing)/i.test(priorProfile) : false)

  prompt += slotInstructions(mode, hasLikes, numSongs)

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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${apiKey}`,
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
  if (!res.ok) throw new Error(`Gemini responded with ${res.status}`)
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
): Promise<{ songs: SongSuggestion[]; profile?: string }> {
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
      return parseLLMResponse(raw)
    } catch (err) {
      lastError = err as Error
      if (attempt === MAX_LLM_ATTEMPTS - 1) throw err
    }
  }
  throw lastError ?? new Error('LLM query failed after all attempts')
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

function parseLLMResponse(raw: string): { songs: SongSuggestion[]; profile?: string } {
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

  // New format: {songs: [{search, reason, category, spotify_id, coords}, ...], profile}
  if (Array.isArray(parsed.songs)) {
    type LLMRow = { search: string; reason: string; category?: string; spotify_id?: string; spotifyId?: string; coords?: unknown; composed?: unknown; performer?: unknown }
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
        reason: s.reason,
        category: typeof s.category === 'string' ? s.category : undefined,
        spotifyId: normalizeSpotifyTrackId(rawSpotifyIdFromRow(s as unknown as Record<string, unknown>)),
        coords: parseCoords(s.coords),
        composed: typeof s.composed === 'number' && Number.isFinite(s.composed) ? s.composed : undefined,
        performer: typeof s.performer === 'string' && s.performer.trim() ? s.performer.trim() : undefined,
      }))
      .filter((song: SongSuggestion): song is SongSuggestion => Boolean(song.search && song.reason))
    const chosen = songs.slice(0, 10)  // allow up to 10; caller requested numSongs
    if (songs.length > 0) {
      const withId = chosen.filter(s => s.spotifyId).length
      console.log(
        `LLM songs: ${chosen.length} tracks, ${withId} with spotifyId, ${chosen.length - withId} search-only (no id — normal)`
      )
      console.log(
        chosen.map((s: SongSuggestion) => ({
          search: s.search,
          coords: s.coords,
          ...(s.spotifyId ? { spotifyId: s.spotifyId } : {}),
          ...(s.composed != null ? { composed: s.composed } : {}),
        }))
      )
      return { songs: chosen, profile: typeof parsed.profile === 'string' ? parsed.profile : undefined }
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
      coords: parseCoords(parsed.coords),
    }
    return { songs: [single], profile: typeof parsed.profile === 'string' ? parsed.profile : undefined }
  }

  throw new Error('LLM response format not recognized')
}
