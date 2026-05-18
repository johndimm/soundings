import { NextRequest } from 'next/server'
import {
  channelHasArtistDiscoveryInput,
  suggestArtistsFromConstraints,
  type SuggestArtistsInput,
} from '@/app/lib/suggestArtists'
import { DEFAULT_LLM_PROVIDER, type LLMProvider } from '@/app/lib/llm'

export const maxDuration = 45

export async function POST(req: NextRequest) {
  const body = (await req.json()) as SuggestArtistsInput & { provider?: LLMProvider }

  const input: SuggestArtistsInput = {
    name: body.name,
    genres: Array.isArray(body.genres) ? body.genres.filter((g): g is string => typeof g === 'string') : [],
    genreText: typeof body.genreText === 'string' ? body.genreText : '',
    timePeriods: Array.isArray(body.timePeriods)
      ? body.timePeriods.filter((t): t is string => typeof t === 'string')
      : [],
    regions: Array.isArray(body.regions)
      ? body.regions.filter((r): r is string => typeof r === 'string')
      : [],
    notes: typeof body.notes === 'string' ? body.notes : '',
    popularity: typeof body.popularity === 'number' ? body.popularity : 50,
  }

  if (!channelHasArtistDiscoveryInput(input)) {
    return Response.json({ artists: [] })
  }

  const provider =
    body.provider === 'anthropic' ||
    body.provider === 'openai' ||
    body.provider === 'deepseek' ||
    body.provider === 'gemini'
      ? body.provider
      : DEFAULT_LLM_PROVIDER

  try {
    const artists = await suggestArtistsFromConstraints(input, provider)
    return Response.json({ artists })
  } catch (e) {
    console.error('[suggest-artists]', e)
    return Response.json(
      { artists: [], error: e instanceof Error ? e.message : 'suggest failed' },
      { status: 500 }
    )
  }
}
