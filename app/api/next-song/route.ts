import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getNextSongQuery, LLMProvider, ListenEvent } from '@/app/lib/llm'
import { searchTrack } from '@/app/lib/spotify'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('spotify_access_token')?.value

  if (!accessToken) {
    return Response.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const { sessionHistory, priorProfile, provider, artistConstraint, notes } = (await req.json()) as {
    sessionHistory: ListenEvent[]
    priorProfile?: string
    provider?: LLMProvider
    artistConstraint?: string
    notes?: string
  }

  let songs: { search: string; reason: string }[]
  let profile: string | undefined
  try {
    const result = await getNextSongQuery(
      sessionHistory ?? [],
      provider,
      artistConstraint,
      notes,
      priorProfile
    )
    songs = result.songs
    profile = result.profile
  } catch (err) {
    console.error('LLM response error', err)
    return Response.json(
      { error: 'llm_response_invalid', message: (err as Error).message },
      { status: 502 }
    )
  }

  // Search Spotify for all songs in parallel; return whichever succeed
  const results = await Promise.allSettled(
    songs.map(s => searchTrack(s.search, accessToken))
  )

  const foundSongs = results
    .map((r, i) => ({
      track: r.status === 'fulfilled' ? r.value : null,
      reason: songs[i].reason,
    }))
    .filter(s => s.track !== null)
    .map(s => ({ track: s.track!, reason: s.reason }))

  if (foundSongs.length === 0) {
    return Response.json({ error: 'no_tracks_found' }, { status: 404 })
  }

  return Response.json({ songs: foundSongs, profile })
}
