import { NextRequest } from 'next/server'
import {
  extractYoutubeVideoId,
  getYouTubeSearchesRemaining,
  youtubeTrackFromVideoId,
} from '@/app/lib/youtube'
import {
  YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
  YOUTUBE_RESOLVE_TEST_VIDEO_ID,
} from '@/app/lib/youtubeResolveTestDefaults'

/**
 * Temporary dev / debug endpoint: returns one fixed (or overridden) resolved YouTube track
 * without calling the YouTube Data API — same JSON shape as POST /api/next-song with
 * `songsToResolve` + `source: 'youtube'`.
 *
 * Enable with either:
 * - `NODE_ENV=development`, or
 * - `YOUTUBE_RESOLVE_TEST=1` (or `true`) in the server environment (e.g. Vercel preview).
 *
 * To trace promotion in the debugger without burning quota, temporarily point
 * `resolveOneSuggestion` in `PlayerClient.tsx` at this URL instead of `/api/next-song`.
 */

function testRouteEnabled(): boolean {
  const flag = process.env.YOUTUBE_RESOLVE_TEST
  if (flag === '1' || flag === 'true') return true
  return process.env.NODE_ENV === 'development'
}

type Body = {
  youtubeVideoId?: string
  search?: string
  reason?: string
  category?: string
}

export async function GET() {
  if (!testRouteEnabled()) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json({
    enabled: true,
    description:
      'POST with optional JSON { youtubeVideoId?, search?, reason?, category? } — returns one resolved song; 0 YouTube Data API quota.',
    defaults: {
      youtubeVideoId: YOUTUBE_RESOLVE_TEST_VIDEO_ID,
      search: YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
    },
    embedPlayerPath: '/youtube-resolve-test/player',
    curl: `curl -s -X POST http://localhost:3000/api/youtube-resolve-test -H 'Content-Type: application/json' -d '{}' | jq`,
  })
}

export async function POST(req: NextRequest) {
  if (!testRouteEnabled()) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const rawYt =
    typeof body.youtubeVideoId === 'string' && body.youtubeVideoId.trim()
      ? body.youtubeVideoId.trim()
      : undefined
  const videoId = rawYt ? extractYoutubeVideoId(rawYt) ?? YOUTUBE_RESOLVE_TEST_VIDEO_ID : YOUTUBE_RESOLVE_TEST_VIDEO_ID
  const searchHint =
    typeof body.search === 'string' && body.search.trim() ? body.search.trim() : YOUTUBE_RESOLVE_TEST_SEARCH_HINT
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Test fixture (youtube-resolve-test)'
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'debug'

  const track = youtubeTrackFromVideoId(videoId, searchHint)!

  return Response.json({
    songs: [
      {
        track,
        reason,
        category,
        coords: { x: 50, y: 50, z: 50 },
      },
    ],
    ytSearchesRemaining: getYouTubeSearchesRemaining(),
    _fixture: true,
  })
}
