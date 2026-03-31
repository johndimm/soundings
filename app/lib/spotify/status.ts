const RATE_LIMIT_MIN_WAIT_MS = 30_000
const SPOTIFY_OFFLINE = process.env.SPOTIFY_OFFLINE === 'true'
const SPOTIFY_OFFLINE_WAIT_MS = Number(process.env.SPOTIFY_OFFLINE_WAIT_MS ?? 4 * 60 * 60 * 1000)

let rateLimitUntil = 0
let dynamicOfflineUntil = 0


export function isSpotifyOffline(): boolean {
  return SPOTIFY_OFFLINE || Date.now() < dynamicOfflineUntil
}

export function getSpotifyOfflineWaitMs(): number {
  return SPOTIFY_OFFLINE_WAIT_MS
}

export function getRateLimitUntil(): number {
  return rateLimitUntil
}

export function getRateLimitRemainingMs(): number {
  return Math.max(rateLimitUntil - Date.now(), 0)
}

export function isSpotifyAvailable(): boolean {
  return !isSpotifyOffline() && Date.now() >= rateLimitUntil
}

export function markRateLimited(retryAfterMs?: number) {
  const now = Date.now()
  const wait = Math.max(retryAfterMs ?? 0, RATE_LIMIT_MIN_WAIT_MS)
  rateLimitUntil = Math.max(rateLimitUntil, now + wait)
  console.warn(`[spotify/status] rate limited, retryAfterMs=${wait}, until=${new Date(rateLimitUntil).toISOString()}`)
}

export function markSpotifyUnavailable(durationMs?: number) {
  const wait = durationMs ?? SPOTIFY_OFFLINE_WAIT_MS
  dynamicOfflineUntil = Math.max(dynamicOfflineUntil, Date.now() + wait)
}

export function resetSpotifyState() {
  rateLimitUntil = 0
  dynamicOfflineUntil = 0
}
