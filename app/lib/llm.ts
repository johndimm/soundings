export interface ListenEvent {
  track: string
  artist: string
  percentListened: number
  reaction: 'move-on' | 'not-now' | 'more-from-artist'
}

export interface SongSuggestion {
  search: string
  reason: string
  category?: string
  spotifyId?: string
}

export type LLMProvider = 'anthropic' | 'openai' | 'deepseek' | 'gemini'

const SYSTEM_PROMPT = `You are a DJ mapping a listener's taste. Imagine all music printed on a giant map where similar-sounding songs are neighbors — like a geographic map of sound. Your job is to efficiently figure out which regions of that map the listener finds interesting.

HOW TO EXPLORE:
- Think of each rating as a data point on the map. High % listened = attractor (this region is interesting). Low % = repulsor (move away from this point).
- After a LIKE: the region around that song is promising. Explore nearby — similar genre, era, mood, energy — to discover how wide the liked region is and where its edges are.
- After a DISLIKE: move away from that specific point, but don't write off the whole neighborhood. A disliked uptempo pop song doesn't mean all pop is bad — maybe just that corner. Explore the edges of disliked areas, not just distant lands.
- Balance EXPLOITATION (probe the shape and edges of liked regions) with EXPLORATION (sample uncharted areas to find new attractors).
- When everything so far is disliked, take samples from distant, unvisited parts of the map to find any attractor at all — but vary the distance and direction each time.

Each batch of 3 songs should answer: "is this region interesting?" Choose songs that, regardless of outcome, reveal something new about the shape of this listener's taste.

IMPORTANT: If the user provides explicit instructions (genres, time periods, style preferences, or other constraints), follow them strictly — they override your inference.

Reaction codes:
- "move-on" = ready to move on; percent listened is the signal (high % = liked, low % = disliked)
- "not-now" = not in the mood, not a taste signal
- "more-from-artist" = enjoyed this; one song may be from this artist or close peers, the other two must explore different territory

Respond with ONLY a JSON object in this exact format:
{"songs":[{"search":"track name artist name","reason":"one sentence explanation","category":"broad > subcategory (e.g. Classical > Baroque, Electronic > Ambient, Jazz > Modal Jazz)","spotify_id":"use Spotify track ID if you can identify the exact version"},{"search":"track name artist name","reason":"one sentence explanation","category":"...","spotify_id":"..."},{"search":"track name artist name","reason":"one sentence explanation","category":"...","spotify_id":"..."}],"profile":"LIKES: [specific songs/genres/moods that landed, with notes on region shape] | DISLIKES: [specific points sampled and rejected, noting which parts of each region were tried] | NEXT: [where to sample next — exploitation of a known liked region, edge of a disliked one, or uncharted territory — and why]"}`

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

  // User constraints go first so they're never buried
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
    prompt += 'This is the first turn. Pick 3 songs from very different regions of taste-space — e.g. one energetic, one mellow, one acoustic or classical — so the reaction immediately splits the possibility space in half no matter which way it goes. Match the popularity level specified in any constraints above.'
    return prompt
  }

  if (sessionHistory.length > 0) {
    const lines = sessionHistory
      .map(e => `- "${e.track}" by ${e.artist}: listened to ${Math.round(e.percentListened)}% [${e.reaction}]`)
      .join('\n')
    prompt += `New ratings this session:\n${lines}\n\n`
  }

  const hasLikes = sessionHistory.some(e => e.percentListened >= 50) ||
    (priorProfile ? /LIKES:\s*(?!\[none|\[no confirmed|\[nothing)/i.test(priorProfile) : false)

  const effectiveMode = mode === 'exploit' && !hasLikes ? 'explore' : mode

  if (effectiveMode === 'exploit') {
    prompt += 'MODE: EXPLOIT. Focus on the LIKES in the profile. Pick 3 songs that are close neighbors of what was liked — same or adjacent genre, era, mood, energy — to map the shape and edges of that region.'
  } else {
    prompt += 'MODE: EXPLORE. Pick 3 songs from parts of the map NOT yet sampled — far from anything already heard or disliked. Do not revisit territory in DISLIKES. If nothing has been heard yet, sample 3 distant, contrasting regions to split the space.'
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
        generationConfig: { maxOutputTokens: 400 },
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
  if (start === -1) {
    throw new Error('No JSON object found')
  }
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return {
          payload: text.slice(start, i + 1),
          start,
          end: i,
        }
      }
    }
  }
  throw new Error('JSON object not terminated')
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

  // New format: {songs: [{search, reason}, ...], profile}
  if (Array.isArray(parsed.songs)) {
    type LLMRow = { search: string; reason: string; category?: string; spotify_id?: string; spotifyId?: string }
    const songs = parsed.songs
      .filter((s: unknown): s is LLMRow => {
        const candidate = s as Record<string, unknown>
        return Boolean(
          s &&
            typeof s === 'object' &&
            typeof candidate.search === 'string' &&
            typeof candidate.reason === 'string'
        )
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
      }))
      .filter((song: SongSuggestion): song is SongSuggestion => Boolean(song.search && song.reason))
    const chosen = songs.slice(0, 3)
    if (songs.length > 0) {
      console.log(
        'LLM songs with IDs',
        chosen.map((song: SongSuggestion) => ({ search: song.search, spotifyId: song.spotifyId ?? 'none' }))
      )
      return { songs: chosen, profile: typeof parsed.profile === 'string' ? parsed.profile : undefined }
    }
  }

  // Old format fallback: {search, reason, profile}
  if (typeof parsed.search === 'string' && typeof parsed.reason === 'string') {
    const spotifyId =
      typeof parsed.spotifyId === 'string'
        ? parsed.spotifyId.trim()
        : typeof parsed.spotify_id === 'string'
          ? parsed.spotify_id.trim()
          : undefined
    const single = { search: parsed.search, reason: parsed.reason, spotifyId }
    console.log('LLM fallback song', { ...single, spotifyId: spotifyId ?? 'none' })
    return {
      songs: [single],
      profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
    }
  }

  throw new Error('LLM response format not recognized')
}
