export interface ListenEvent {
  track: string
  artist: string
  percentListened: number
  reaction: 'move-on' | 'not-now' | 'more-from-artist'
  coords?: { x: number; y: number }
}

export interface SongSuggestion {
  search: string
  reason: string
  category?: string
  spotifyId?: string
  coords?: { x: number; y: number }
}

export type LLMProvider = 'anthropic' | 'openai' | 'deepseek' | 'gemini'

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

THE 2D MAP (for display — project your full musical knowledge onto these axes):
  X-axis: 0 = purely acoustic/live/traditional instruments → 100 = fully electronic/synthesized
  Y-axis: 0 = calm/sparse/minimal/introspective → 100 = intense/energetic/dense/driving

Reference anchors (be consistent — the same song should always land near the same position):
  (8, 22)  Nick Drake, solo acoustic folk
  (12, 35) Bach solo cello, chamber music
  (18, 50) Miles Davis "Kind of Blue", cool jazz
  (25, 70) Flamenco, Coltrane "A Love Supreme"
  (40, 55) The Beatles (mid-period), classic singer-songwriter
  (55, 65) Stevie Wonder, soul/funk
  (62, 80) Jimi Hendrix, AC/DC, hard rock
  (68, 85) Metallica, heavy metal
  (75, 45) Kraftwerk, Depeche Mode, synth-pop
  (82, 70) Nine Inch Nails, industrial rock
  (88, 28) Brian Eno "Ambient 1", ambient electronic
  (93, 80) Aphex Twin "Windowlicker", electronic/IDM

When assigning coords: consider all musical attributes — instrumentation, era, production style, tempo, harmonic complexity, cultural origin, mood. The 2D position is a projection of this richer space, not just genre.

NAVIGATION RULES (use full musical knowledge, not just the 2D projection):
- Song liked (≥50% listened): region is promising. Slot 1 should explore its musical neighborhood.
- Song disliked (<50%): avoid that musical territory. Do not suggest songs with similar attributes.
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

If the user provides explicit constraints (genres, eras, styles), follow them strictly — all 3 slots must satisfy the constraints.

Respond with ONLY a JSON object:
{"songs":[{"search":"track name artist name","reason":"one sentence: slot role, position in space, why this song","category":"broad genre > subgenre","spotify_id":"Spotify track ID if known","coords":{"x":42,"y":28}},{"search":"...","reason":"...","category":"...","spotify_id":"...","coords":{"x":85,"y":72}},{"search":"...","reason":"...","category":"...","spotify_id":"...","coords":{"x":18,"y":55}}],"profile":"LIKED: [positions + musical notes e.g. (42,28) warm soul, brass-heavy] | DISLIKED: [positions + notes to avoid] | EXPLORED: [quadrant coverage notes] | NEXT: [spatial plan — which region and why]"}`

export type ExploreMode = 'exploit' | 'explore'

function buildUserPrompt(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode: ExploreMode = 'explore'
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

  if (sessionHistory.length === 0 && !priorProfile) {
    prompt += 'FIRST TURN — no history yet. Apply the first-turn rule: 3 songs from maximally distant parts of the space. Match any constraints above.'
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

  if (!hasLikes) {
    prompt += 'No confirmed likes yet. Prioritize Slot 2 (FAR) and Slot 3 (WILD CARD) — cover unmapped territory. Slot 1 may probe a different corner of a disliked area only if it has fewer than 2 strikes.'
  } else {
    prompt += 'Apply the 3-slot rule: Slot 1 near a liked musical region, Slot 2 from unmapped territory, Slot 3 a genuine surprise.'
  }

  return prompt
}

async function askAnthropic(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string,
  alreadyHeard?: string[],
  mode?: ExploreMode
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
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode) }],
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
  mode?: ExploreMode
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode) },
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
  mode?: ExploreMode
): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode) },
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
  mode?: ExploreMode
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode) }] }],
        generationConfig: { maxOutputTokens: 512 },
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
  mode?: ExploreMode
): Promise<{ songs: SongSuggestion[]; profile?: string }> {
  const ask = () => {
    switch (provider) {
      case 'openai': return askOpenAI(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode)
      case 'deepseek': return askDeepSeek(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode)
      case 'gemini': return askGemini(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode)
      default: return askAnthropic(sessionHistory, priorProfile, artistConstraint, notes, alreadyHeard, mode)
    }
  }

  let lastError: Error | null = null
  for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
    let raw: string
    try {
      raw = await ask()
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

function parseCoords(raw: unknown): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const x = typeof c.x === 'number' ? c.x : typeof c.x === 'string' ? parseFloat(c.x) : NaN
  const y = typeof c.y === 'number' ? c.y : typeof c.y === 'string' ? parseFloat(c.y) : NaN
  if (isNaN(x) || isNaN(y)) return undefined
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
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
    type LLMRow = { search: string; reason: string; category?: string; spotify_id?: string; spotifyId?: string; coords?: unknown }
    const songs = parsed.songs
      .filter((s: unknown): s is LLMRow => {
        const c = s as Record<string, unknown>
        return Boolean(s && typeof s === 'object' && typeof c.search === 'string' && typeof c.reason === 'string')
      })
      .map((s: LLMRow) => ({
        search: s.search,
        reason: s.reason,
        category: typeof s.category === 'string' ? s.category : undefined,
        spotifyId: typeof s.spotifyId === 'string'
          ? s.spotifyId.trim()
          : typeof s.spotify_id === 'string'
            ? s.spotify_id.trim()
            : undefined,
        coords: parseCoords(s.coords),
      }))
      .filter((song: SongSuggestion): song is SongSuggestion => Boolean(song.search && song.reason))
    const chosen = songs.slice(0, 3)
    if (songs.length > 0) {
      console.log('LLM songs', chosen.map((s: SongSuggestion) => ({
        search: s.search,
        coords: s.coords ?? 'none',
        spotifyId: s.spotifyId ?? 'none',
      })))
      return { songs: chosen, profile: typeof parsed.profile === 'string' ? parsed.profile : undefined }
    }
  }

  // Old format fallback: {search, reason, profile}
  if (typeof parsed.search === 'string' && typeof parsed.reason === 'string') {
    const spotifyId =
      typeof parsed.spotifyId === 'string' ? parsed.spotifyId.trim()
      : typeof parsed.spotify_id === 'string' ? parsed.spotify_id.trim()
      : undefined
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
