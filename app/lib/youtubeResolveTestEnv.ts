/**
 * Server-only: when true, no LLM for profile-only DJ batch, no YouTube search.list (fixtures only).
 * Accepts either YOUTUBE_RESOLVE_TEST or NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST so one .env.local line is enough.
 */
export function isYoutubeResolveTestServerEnabled(): boolean {
  // Bracket access so bundlers don’t drop unknown env keys at compile time.
  const v =
    process.env['YOUTUBE_RESOLVE_TEST'] ?? process.env['NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST']
  if (v == null || v === '') return false
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())
}
