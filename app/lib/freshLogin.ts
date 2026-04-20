/**
 * Handles the per-browser cleanup that must run after a fresh login via
 * `/player?spotify_login=1` (Spotify OAuth callback) or `/player?youtube_login=1`
 * (the `/api/auth/youtube` route handler).
 *
 * The reset has to run before `PlayerClient` reads `localStorage` to hydrate
 * channels, otherwise the player boots with leftover cross-source state
 * (e.g. Spotify `currentCard` still present in YouTube mode, which produces a
 * black player panel because the `YoutubePlayer` only renders when
 * `currentCard.track.source === 'youtube'`).
 *
 * Why a module-level flag instead of a component ref:
 * `PersistentPlayerHost` wraps its inner component in a `Suspense` boundary
 * (needed for `useSearchParams`). On the server the fallback renders — which
 * includes `PlayerClient` — and on the client that fallback hydrates first,
 * letting `PlayerClient` read stale storage before the suspense resolves. To
 * beat that race we also call `applyFreshLoginIfNeeded` at the top of
 * `PlayerClient`'s own hydration effect. The module-level flag guarantees the
 * reset runs at most once per page load no matter which caller wins the race.
 */

const SETTINGS_STORAGE_KEY = 'earprint-settings'
const CHANNELS_STORAGE_KEY = 'earprint-channels'

let freshLoginApplied = false

function applyFreshLoginSource(next: 'spotify' | 'youtube') {
  try {
    const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const existing = rawSettings ? JSON.parse(rawSettings) : {}
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...existing, source: next }),
    )

    const rawChannels = localStorage.getItem(CHANNELS_STORAGE_KEY)
    if (!rawChannels) {
      console.info('[fresh-login]', next, '— no channels to scrub')
      return
    }
    const channels = JSON.parse(rawChannels)
    if (!Array.isArray(channels)) {
      console.info('[fresh-login]', next, '— channels not an array')
      return
    }

    const matchesSource = (card: unknown): boolean => {
      if (!card || typeof card !== 'object') return false
      const track = (card as { track?: { source?: unknown } }).track
      if (!track || typeof track !== 'object') return false
      // Older persisted cards may not carry `source`; historically only Spotify
      // tracks omitted it, so default to 'spotify'.
      const src = typeof track.source === 'string' ? track.source : 'spotify'
      return src === next
    }

    let droppedCurrent = 0
    let droppedQueue = 0
    let mutated = false
    const cleaned = channels.map((c: Record<string, unknown>) => {
      const current = c.currentCard
      const queue = Array.isArray(c.queue) ? c.queue : []
      const currentOk = !current || matchesSource(current)
      const filteredQueue = queue.filter(matchesSource)
      if (!currentOk) droppedCurrent++
      droppedQueue += queue.length - filteredQueue.length
      if (currentOk && filteredQueue.length === queue.length && current === c.currentCard) {
        return c
      }
      mutated = true
      const resumePositionStale = !currentOk || filteredQueue.length !== queue.length
      return {
        ...c,
        currentCard: currentOk ? current ?? null : null,
        queue: filteredQueue,
        // Resume position is bound to `currentCard`; drop it if we cleared the card.
        playbackPositionMs: resumePositionStale && !currentOk ? 0 : c.playbackPositionMs,
        playbackTrackUri: resumePositionStale && !currentOk ? null : c.playbackTrackUri,
      }
    })
    console.info(
      '[fresh-login]',
      next,
      '— channels:',
      channels.length,
      '· dropped currentCard:',
      droppedCurrent,
      '· dropped queue items:',
      droppedQueue,
      '· mutated:',
      mutated,
    )
    if (mutated) {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(cleaned))
    }
  } catch (err) {
    console.warn('[fresh-login] failed', err)
  }
}

/** Returns the fresh-login source if one was applied, otherwise null. */
export function applyFreshLoginIfNeeded(): 'spotify' | 'youtube' | null {
  if (freshLoginApplied) return null
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const freshSource: 'spotify' | 'youtube' | null =
      params.get('spotify_login') === '1'
        ? 'spotify'
        : params.get('youtube_login') === '1'
          ? 'youtube'
          : null
    console.info(
      '[fresh-login] check · search:',
      window.location.search,
      '· matched:',
      freshSource,
      '· alreadyApplied:',
      freshLoginApplied,
    )
    if (!freshSource) return null
    freshLoginApplied = true
    applyFreshLoginSource(freshSource)
    return freshSource
  } catch (err) {
    console.warn('[fresh-login] check threw', err)
    return null
  }
}
