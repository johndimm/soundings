export interface ListenEvent {
  track: string
  artist: string
  percentListened: number
  reaction: 'move-on' | 'not-now' | 'more-from-artist'
}

export interface SongSuggestion {
  search: string
  reason: string
  spotifyId?: string
}

export type LLMProvider = 'anthropic' | 'openai' | 'deepseek' | 'gemini'

const SYSTEM_PROMPT = `You are a music taste analyst and DJ. Your job is to pick songs that split a group of listeners roughly 50/50 — songs that some people love and others don't.

Given a user's taste profile and recent ratings, suggest 4 songs to play next and clearly note which three you would prioritize. Each should differ in style, era, or energy to cover diverse taste dimensions, while remaining compatible with what you know about the user.

IMPORTANT: If the user provides explicit instructions (genres, time periods, style preferences, or other constraints), you MUST follow them strictly — they take priority over your taste inference. Every song you suggest must satisfy those constraints.

Reaction codes:
- "move-on" = ready to hear something else; percent listened is the engagement signal (low % = didn't like it, high % = enjoyed it)
- "not-now" = not in the mood right now, independent of taste (don't treat as dislike)
- "more-from-artist" = wants more from this artist or very similar style

If the most recent reaction is "more-from-artist", all suggested songs should be by that artist or very similar artists.

Respond with ONLY a JSON object in this exact format:
{"songs":[{"search":"track name artist name","reason":"one sentence explanation","spotify_id":"use Spotify track ID if you can identify the exact version"},{"search":"track name artist name","reason":"one sentence explanation","spotify_id":"..."},{"search":"track name artist name","reason":"one sentence explanation","spotify_id":"..."},{"search":"track name artist name","reason":"one sentence explanation","spotify_id":"..."}],"profile":"2-3 sentences addressed directly to the listener using 'you/your', describing what you've learned about their taste — be specific about genres, eras, energy levels, and patterns you've noticed"}`

function buildUserPrompt(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string
): string {
  let prompt = ''

  // User constraints go first so they're never buried
  if (notes?.trim()) {
    prompt += `USER CONSTRAINTS (must be followed for every song): ${notes.trim()}\n\n`
  }

  if (artistConstraint) {
    prompt += `IMPORTANT: The user wants more from "${artistConstraint}". All 3 songs should be by this artist or a very similar one.\n\n`
  }

  if (priorProfile) {
    prompt += `Taste profile from prior sessions: ${priorProfile}\n\n`
  }

  if (sessionHistory.length === 0 && !priorProfile) {
    prompt += 'This is the first song for this user. Pick a widely known song that splits pop music listeners. Return 3 songs as specified.'
    return prompt
  }

  if (sessionHistory.length > 0) {
    const lines = sessionHistory
      .map(e => `- "${e.track}" by ${e.artist}: listened to ${Math.round(e.percentListened)}% [${e.reaction}]`)
      .join('\n')
    prompt += `New ratings this session:\n${lines}\n\n`
  }

  prompt += 'Based on this, pick 3 songs to play next.'

  return prompt
}

async function askAnthropic(
  sessionHistory: ListenEvent[],
  priorProfile?: string,
  artistConstraint?: string,
  notes?: string
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
      messages: [{ role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes) }],
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
  notes?: string
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
        { role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes) },
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
  notes?: string
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
        { role: 'user', content: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes) },
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
  notes?: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: buildUserPrompt(sessionHistory, priorProfile, artistConstraint, notes) }] }],
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
  priorProfile?: string
): Promise<{ songs: SongSuggestion[]; profile?: string }> {
  const ask = () => {
    switch (provider) {
      case 'openai': return askOpenAI(sessionHistory, priorProfile, artistConstraint, notes)
      case 'deepseek': return askDeepSeek(sessionHistory, priorProfile, artistConstraint, notes)
      case 'gemini': return askGemini(sessionHistory, priorProfile, artistConstraint, notes)
      default: return askAnthropic(sessionHistory, priorProfile, artistConstraint, notes)
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
    type LLMRow = { search: string; reason: string; spotify_id?: string; spotifyId?: string }
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
