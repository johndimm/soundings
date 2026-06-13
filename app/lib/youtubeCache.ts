// Client-safe YouTube cache operations (no fs/server dependencies)
// This module only handles the in-memory and KV cache, not quota tracking

let searchCache = new Map<string, { videoId: string }>()
let cacheInitialized = false

async function getKvClient() {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import('@vercel/kv')
      return kv
    } catch {
      return null
    }
  }
  return null
}

async function initCache() {
  if (cacheInitialized) return
  cacheInitialized = true

  // Try to load from KV
  const kv = await getKvClient()
  if (kv) {
    try {
      const data = await kv.get<Record<string, { track: { videoId: string } }>('youtube-cache')
      if (data) {
        for (const [key, entry] of Object.entries(data)) {
          searchCache.set(key, { videoId: entry.track.videoId })
        }
      }
    } catch (err) {
      console.warn('[youtube-cache] failed to load from KV:', err)
    }
  }
}

// Safe for client: just looks up cached video IDs
export async function getCachedYouTubeVideoId(query: string): Promise<string | null> {
  await initCache()
  const cacheKey = query.toLowerCase().trim()
  return searchCache.get(cacheKey)?.videoId ?? null
}
