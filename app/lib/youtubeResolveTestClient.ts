/** Client-only: NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST must be set at build time; restart dev after .env.local changes. */
export function isYoutubeResolveTestClientEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_YOUTUBE_RESOLVE_TEST
  if (v == null || v === '') return false
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())
}
