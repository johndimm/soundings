// Tracks Spotify API call timestamps in localStorage.
// Each lazy resolve uses one Spotify call (GET /v1/tracks?ids= or Search, not both).
// We record timestamps + estimated Spotify call count, then compute the
// peak number of Spotify calls seen in any 30-second window.

const CALL_LOG_KEY = 'spotifyCallLog'      // JSON: {t: number, n: number}[]
const PEAK_KEY = 'spotifyPeakWindow'        // number: peak Spotify calls in any 30s
const WINDOW_MS = 30_000
const LOG_RETENTION_MS = 10 * 60 * 1000   // keep last 10 minutes

interface CallEntry {
  t: number   // timestamp
  n: number   // estimated Spotify calls (songs returned, or 3 on 429)
}

function readLog(): CallEntry[] {
  try {
    const raw = localStorage.getItem(CALL_LOG_KEY)
    return raw ? (JSON.parse(raw) as CallEntry[]) : []
  } catch {
    return []
  }
}

function writeLog(entries: CallEntry[]) {
  try {
    localStorage.setItem(CALL_LOG_KEY, JSON.stringify(entries))
  } catch {}
}

function updatePeak(peak: number) {
  try {
    const stored = Number(localStorage.getItem(PEAK_KEY) ?? 0)
    if (peak > stored) localStorage.setItem(PEAK_KEY, String(peak))
  } catch {}
}

/** Call this after each Spotify lookup (1 per resolved track). Pass 0 to skip logging. */
export function recordFetch(spotifyCallCount: number) {
  if (spotifyCallCount <= 0) return
  const now = Date.now()
  const cutoff = now - LOG_RETENTION_MS
  const log = readLog().filter(e => e.t > cutoff)
  log.push({ t: now, n: spotifyCallCount })
  writeLog(log)

  // Compute peak: for each entry, sum calls in [entry.t, entry.t + WINDOW_MS]
  let peak = 0
  for (const entry of log) {
    const windowEnd = entry.t + WINDOW_MS
    const count = log.filter(e => e.t >= entry.t && e.t <= windowEnd).reduce((s, e) => s + e.n, 0)
    if (count > peak) peak = count
  }
  updatePeak(peak)
}

export interface CallStats {
  log: CallEntry[]
  peakWindow: number
  totalCalls: number
  rateLimitUntil: number | null
}

export function readStats(): CallStats {
  const now = Date.now()
  const cutoff = now - LOG_RETENTION_MS
  const log = readLog().filter(e => e.t > cutoff)
  const totalCalls = log.reduce((s, e) => s + e.n, 0)
  const peakWindow = Number(localStorage.getItem(PEAK_KEY) ?? 0)

  let rateLimitUntil: number | null = null
  try {
    const raw = localStorage.getItem('spotifyRateLimitUntil')
    if (raw) {
      const v = Number(raw)
      if (v > now) rateLimitUntil = v
    }
  } catch {}

  return { log, peakWindow, totalCalls, rateLimitUntil }
}

export function clearStats() {
  try {
    localStorage.removeItem(CALL_LOG_KEY)
    localStorage.removeItem(PEAK_KEY)
    localStorage.removeItem('spotifyRateLimitUntil')
  } catch {}
}
