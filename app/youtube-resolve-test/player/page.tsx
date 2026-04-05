'use client'

import Link from 'next/link'
import YoutubePlayer from '@/app/player/YoutubePlayer'
import {
  YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
  YOUTUBE_RESOLVE_TEST_VIDEO_ID,
} from '@/app/lib/youtubeResolveTestDefaults'

/**
 * Embeds the same fixed video id as GET/POST `/api/youtube-resolve-test` defaults.
 * Plain iframe embed (same pattern as YouTube “Share → Embed”) — no YouTube Data API search.
 */
export default function YoutubeResolveTestPlayerPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wide">Debug</p>
        <h1 className="text-lg font-medium text-white">YouTube resolve test — embedded playback</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl">{YOUTUBE_RESOLVE_TEST_SEARCH_HINT}</p>
        <p className="text-xs text-zinc-500 font-mono mt-2">
          videoId=<span className="text-emerald-400/90">{YOUTUBE_RESOLVE_TEST_VIDEO_ID}</span>
        </p>
        <p className="text-xs text-zinc-600 mt-3">
          <Link href="/api/youtube-resolve-test" className="text-sky-400 hover:underline">
            GET /api/youtube-resolve-test
          </Link>
          {' · '}
          No <code className="text-zinc-400">search.list</code> — iframe API loads this id directly.
        </p>
      </header>

      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        <div className="relative w-full max-w-5xl aspect-video rounded-lg overflow-hidden bg-black shadow-2xl ring-1 ring-zinc-800">
          <YoutubePlayer videoId={YOUTUBE_RESOLVE_TEST_VIDEO_ID} />
        </div>
      </div>
    </div>
  )
}
