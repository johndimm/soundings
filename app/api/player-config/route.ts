import { isYoutubeResolveTestServerEnabled } from '@/app/lib/youtubeResolveTestEnv'

/**
 * Lightweight client bootstrap: same boolean as `isYoutubeResolveTestServerEnabled()` on the server.
 * Used when the player page prop or NEXT_PUBLIC_* is missing from the client bundle.
 */
export async function GET() {
  return Response.json({
    youtubeResolveTestDj: isYoutubeResolveTestServerEnabled(),
  })
}
