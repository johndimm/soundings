import { NextRequest } from 'next/server'

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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: 'You are a music historian with comprehensive knowledge of discographies and classical repertoire.',
        messages: [{ role: 'user', content: buildPrompt(artist, source, trackTitle, albumTitle) }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = await res.json()
    raw = data.content[0].text as string
  } catch (e) {
    console.error('[career-discography] LLM error', e)
    return Response.json({ error: 'LLM request failed' }, { status: 500 })
  }

  let works: CareerWork[] = []
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) works = JSON.parse(match[0])
  } catch {
    return Response.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  works = works
    .filter((w): w is CareerWork =>
      typeof w.title === 'string' &&
      typeof w.year === 'number' &&
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
