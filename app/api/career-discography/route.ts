import { NextRequest } from 'next/server'

/** Avoid LLM/edge timeouts on long discographies (Vercel defaults are often 10s). */
export const maxDuration = 60

export interface CareerWork {
  title: string
  year: number
  search: string
  reason?: string
  isCurrent?: boolean
}

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

const CAREER_LLM_MODEL = 'claude-haiku-4-5'

type AnthropicMessagesResponse = {
  content?: Array<{ type?: string; text?: string }>
  error?: { type?: string; message?: string }
}

function getAssistantText(data: AnthropicMessagesResponse): string {
  const block = data.content?.find(
    c => c.type === 'text' && typeof c.text === 'string'
  ) as { type: 'text'; text: string } | undefined
  return block?.text ?? ''
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const artist = searchParams.get('artist')?.trim()
  const source = searchParams.get('source') ?? 'spotify'
  const trackTitle = searchParams.get('track')?.trim() || undefined
  const albumTitle = searchParams.get('album')?.trim() || undefined

  if (!artist) {
    return Response.json({ error: 'artist required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  let raw: string
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CAREER_LLM_MODEL,
        max_tokens: 4096,
        system: 'You are a music historian with comprehensive knowledge of discographies and classical repertoire.',
        messages: [{ role: 'user', content: buildPrompt(artist, source, trackTitle, albumTitle) }],
      }),
    })
    const payload: AnthropicMessagesResponse = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = payload.error?.message?.trim() || `Anthropic HTTP ${res.status}`
      console.error('[career-discography] Anthropic error', res.status, msg, payload)
      return Response.json(
        { error: msg, works: [] as CareerWork[] },
        { status: 500 }
      )
    }
    raw = getAssistantText(payload)
    if (!raw) {
      console.error('[career-discography] no assistant text in response', JSON.stringify(payload).slice(0, 2000))
      return Response.json(
        { error: 'Empty LLM response', works: [] as CareerWork[] },
        { status: 500 }
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'LLM request failed'
    console.error('[career-discography] LLM error', e)
    return Response.json(
      { error: 'LLM request failed', message: msg, works: [] as CareerWork[] },
      { status: 500 }
    )
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
  console.info('[career-discography]', artist, '— track:', trackTitle, '| album:', albumTitle,
    `\n  currentIdx=${currentIdx}`,
    '\n ' + works.map((w, i) => `${i}: ${w.year} ${w.title}${w.isCurrent ? ' ← CURRENT' : ''}`).join('\n  ')
  )

  return Response.json({ works })
}
