import {
  DEFAULT_LLM_PROVIDER,
  LLMProvider,
  parseSuggestedArtistsRaw,
} from '@/app/lib/llm'
import {
  extractArtistHintsFromChannel,
  mergeArtistHintLists,
} from '@/app/lib/artistHintsFromNotes'
export type SuggestArtistsInput = {
  name?: string
  genres?: string[]
  genreText?: string
  timePeriods?: string[]
  regions?: string[]
  notes?: string
  popularity?: number
}

function popularityHint(popularity: number | undefined): string {
  const p = typeof popularity === 'number' ? popularity : 50
  if (p <= 25) return 'Prefer obscure / cult / deep-catalog artists over chart hits.'
  if (p >= 75) return 'Prefer widely known / mainstream artists over deep obscurities.'
  return 'Mix familiar names with a few less obvious but still real artists.'
}

export function buildSuggestArtistsPrompt(input: SuggestArtistsInput): string {
  const lines: string[] = [
    'Suggest recording artists and bands for a music-discovery channel. The listener will toggle names to narrow what the DJ plays.',
    '',
    'Constraints (honor every line that is set):',
  ]
  const name = input.name?.trim()
  if (name && name.toLowerCase() !== 'new channel') {
    lines.push(`- Channel title (style / theme hint only — not a required artist): ${name}`)
  }
  if (input.genres?.length) lines.push(`- Genres: ${input.genres.join(', ')}`)
  if (input.genreText?.trim()) lines.push(`- Genre notes: ${input.genreText.trim()}`)
  if (input.timePeriods?.length) lines.push(`- Time periods: ${input.timePeriods.join(', ')}`)
  if (input.regions?.length) lines.push(`- Regions: ${input.regions.join(', ')}`)
  if (input.notes?.trim()) {
    lines.push(
      `- Freeform prompt (moods, styles, subgenres, example artists to lean toward, avoid lists — interpret this; do NOT echo genre words as artist names): ${input.notes.trim()}`
    )
  }
  lines.push(`- Popularity: ${popularityHint(input.popularity)}`)
  lines.push(
    '',
    'Return ONLY JSON: {"artists":["Artist One","Artist Two",...]}',
    '- 10–14 DISTINCT real artists or bands that fit ALL constraints together',
    '- Use canonical names (as on Spotify / YouTube)',
    '- Never return genre, subgenre, or mood words as artist names (e.g. "chillwave", "cool jazz", "deep house")',
    '- Vary styles within the constraints; include both anchors and adjacent names',
    '- Minimum 6 artists when possible; use [] only if constraints are impossible',
  )
  return lines.join('\n')
}

function parseSuggestArtistsResponse(raw: string): string[] {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } else {
      throw new Error('no JSON')
    }
  }
  if (Array.isArray(parsed)) return parseSuggestedArtistsRaw(parsed)
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    return parseSuggestedArtistsRaw(
      o.artists ?? o.suggested_artists ?? o.suggestedArtists
    )
  }
  return []
}

const SUGGEST_ARTISTS_SYSTEM =
  'You are a music curator. You only output valid JSON with real recording-artist and band names.'

async function askSuggestArtists(
  prompt: string,
  provider: LLMProvider
): Promise<string> {
  switch (provider) {
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: SUGGEST_ARTISTS_SYSTEM },
            { role: 'user', content: prompt },
          ],
        }),
      })
      if (!res.ok) throw new Error(`OpenAI ${res.status}`)
      const data = await res.json()
      return data.choices[0].message.content as string
    }
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SUGGEST_ARTISTS_SYSTEM }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024 },
          }),
        }
      )
      if (!res.ok) throw new Error(`Gemini ${res.status}`)
      const data = await res.json()
      return data.candidates[0].content.parts[0].text as string
    }
    case 'deepseek': {
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
            { role: 'system', content: SUGGEST_ARTISTS_SYSTEM },
            { role: 'user', content: prompt },
          ],
        }),
      })
      if (!res.ok) throw new Error(`DeepSeek ${res.status}`)
      const data = await res.json()
      return data.choices[0].message.content as string
    }
    default: {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: SUGGEST_ARTISTS_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}`)
      const data = await res.json()
      return data.content[0].text as string
    }
  }
}

export function filterSuggestedArtistNames(names: string[]): string[] {
  return names.filter(n => n.trim())
}

export async function suggestArtistsFromConstraints(
  input: SuggestArtistsInput,
  provider: LLMProvider = DEFAULT_LLM_PROVIDER
): Promise<string[]> {
  const fromPrompt = extractArtistHintsFromChannel({
    name: input.name,
    notes: input.notes,
    genreText: input.genreText,
  })
  const prompt = buildSuggestArtistsPrompt(input)
  const raw = await askSuggestArtists(prompt, provider)
  const fromLlm = filterSuggestedArtistNames(parseSuggestArtistsResponse(raw))
  return mergeArtistHintLists(fromPrompt, fromLlm)
}

export function channelHasArtistDiscoveryInput(input: SuggestArtistsInput): boolean {
  if (input.genres?.length) return true
  if (input.timePeriods?.length) return true
  if (input.regions?.length) return true
  if (input.genreText?.trim()) return true
  if (input.notes?.trim()) return true
  const name = input.name?.trim()
  if (name && name.toLowerCase() !== 'new channel' && name.toLowerCase() !== 'all') return true
  return false
}
