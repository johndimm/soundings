import type { SongSuggestion } from '@/app/lib/llm'

/** Shared with `api/youtube-resolve-test` and the embed test page — no Data API search. */
/** On-demand sample (Google); avoid 24/7 live streams here — they often fail in embedded IFrame API + autoplay while /watch works. */
export const YOUTUBE_RESOLVE_TEST_VIDEO_ID = 'M7lc1UVf-VE'
export const YOUTUBE_RESOLVE_TEST_SEARCH_HINT =
  'Google Developers - I/O sample video'

/** Single LLM-shaped row used when YouTube resolve test mode skips the real LLM (no tokens, no API). */
export function getYoutubeResolveTestFixtureSuggestion(): SongSuggestion {
  return {
    search: YOUTUBE_RESOLVE_TEST_SEARCH_HINT,
    reason: 'YouTube resolve test mode — single fixture track (no LLM, no YouTube search).',
    category: 'youtube resolve test',
    youtubeVideoId: YOUTUBE_RESOLVE_TEST_VIDEO_ID,
    coords: { x: 50, y: 50, z: 50 },
  }
}

/** True when this row is the shared test fixture (e.g. resolve path when `source` was wrong). */
export function isYoutubeResolveTestFixtureSuggestion(s: SongSuggestion): boolean {
  if (!s) return false
  if (s.youtubeVideoId === YOUTUBE_RESOLVE_TEST_VIDEO_ID) return true
  return s.search?.trim() === YOUTUBE_RESOLVE_TEST_SEARCH_HINT
}
