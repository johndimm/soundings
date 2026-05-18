import { NextRequest } from 'next/server'
import { DEFAULT_LLM_PROVIDER } from '@/app/lib/llm'
import { askLlmSimpleChat, parseLlmProvider } from '@/app/lib/llmSimpleChat'

/** Avoid LLM/edge timeouts on long discographies (Vercel defaults are often 10s). */
export const maxDuration = 60

export interface CareerWork {
  title: string
  year: number
  search: string
  reason?: string
  isCurrent?: boolean
}

const CAREER_SYSTEM =
  'You are a music historian with comprehensive knowledge of discographies and classical repertoire.'

function buildPrompt(artistName: string, source: string, trackTitle?: string, albumTitle?: string): string {
  const platform = source === 'youtube' ? 'YouTube' : 'Spotify'
  const currentTrackClause = trackTitle
    ? `\nThe user is currently listening to the track "${trackTitle}". Using your knowledge, identify which original studio album in the discography first contained this track and mark it with "isCurrent": true. Important: the Spotify/streaming album name may be a compilation or reissue — ignore it and find the original release. Omit "isCurrent" from all other works.`
    : ''
  return `List the chronological discography of "${artistName}".

For musicians and bands: list studio albums in release order. Include historically significant live albums. Skip compilations and greatest-hits packages.
For classical composers: list major works chronologically (symphonies, concertos, chamber music, operas, solo works, etc.).
${currentTrackClause}
Return a JSON array of objects with:
- "title": album or work title
- "year": year of release or first performance (number)
- "search": a search string to find a representative track on ${platform}
  — For albums: "[artist] [album]" e.g. "Miles Davis Kind of Blue"
  — For classical works: "[composer] [work] [recommended performer]" e.g. "Beethoven Symphony No 5 Karajan"
- "reason": one sentence about why this work is significant or what it represents in the artist's career
- "isCurrent": true only for the original album that first contained the currently playing track (omit otherwise)

Return ONLY the JSON array. No markdown fences, no explanation.`
}

function userFacingLlmError(e: unknown, provider: string): string {
  const raw = e instanceof Error ? e.message : 'LLM request failed'
  if (/api[- ]?key|authentication|unauthorized|401|403/i.test(raw)) {
    return `Career mode could not authenticate with ${provider}. Check the matching API key in .env.local (Settings → LLM provider).`
  }
  if (/not configured/i.test(raw)) {
    return raw
  }
  return `Career discography failed (${provider}): ${raw}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const artist = searchParams.get('artist')?.trim()
  const source = searchParams.get('source') ?? 'spotify'
  const trackTitle = searchParams.get('track')?.trim() || undefined
  const albumTitle = searchParams.get('album')?.trim() || undefined
  const provider = parseLlmProvider(searchParams.get('provider') ?? DEFAULT_LLM_PROVIDER)

  if (!artist) {
    return Response.json({ error: 'artist required' }, { status: 400 })
  }

  let raw: string
  try {
    raw = await askLlmSimpleChat(
      CAREER_SYSTEM,
      buildPrompt(artist, source, trackTitle, albumTitle),
      provider,
      4096
    )
  } catch (e) {
    const msg = userFacingLlmError(e, provider)
    console.error('[career-discography] LLM error', provider, e)
    return Response.json({ error: msg, works: [] as CareerWork[] }, { status: 500 })
  }

  let works: CareerWork[] = []
  const jsonSlice =
    raw.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/i)?.[1] ?? raw.match(/\[[\s\S]*\]/)?.[0] ?? null
  try {
    if (jsonSlice) works = JSON.parse(jsonSlice) as CareerWork[]
  } catch (e) {
    console.error('[career-discography] JSON parse', e, 'raw start:', raw.slice(0, 500))
    return Response.json(
      { error: 'Failed to parse LLM response', works: [] as CareerWork[] },
      { status: 500 }
    )
  }
  if (!Array.isArray(works)) {
    return Response.json(
      { error: 'LLM did not return a JSON array', works: [] as CareerWork[] },
      { status: 500 }
    )
  }

  works = works
    .map(w => {
      const year = typeof w.year === 'string' ? parseInt(w.year, 10) : w.year
      return { ...w, year }
    })
    .filter((w): w is CareerWork =>
      typeof w.title === 'string' &&
      typeof w.year === 'number' &&
      Number.isFinite(w.year) &&
      typeof w.search === 'string'
    )
    .sort((a, b) => a.year - b.year)

  const currentIdx = works.findIndex(w => w.isCurrent)
  console.info(
    '[career-discography]',
    provider,
    artist,
    '— track:',
    trackTitle,
    '| album:',
    albumTitle,
    `\n  currentIdx=${currentIdx}`,
    '\n ' + works.map((w, i) => `${i}: ${w.year} ${w.title}${w.isCurrent ? ' ← CURRENT' : ''}`).join('\n  ')
  )

  return Response.json({ works })
}
