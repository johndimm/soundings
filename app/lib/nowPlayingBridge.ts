const STORAGE_KEY = 'earprint-now-playing'

export type NowPlayingSnapshot = {
  artist: string
  track: string
  album?: string
}

export function writeNowPlayingSnapshot(s: NowPlayingSnapshot | null): void {
  if (typeof window === 'undefined') return
  try {
    if (s && (s.artist || s.track)) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
    window.dispatchEvent(new Event('soundings-now-playing'))
  } catch { /* ignore */ }
}

export function readNowPlayingSnapshot(): NowPlayingSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return null
    const o = p as Record<string, unknown>
    const artist = typeof o.artist === 'string' ? o.artist : ''
    const track = typeof o.track === 'string' ? o.track : ''
    const album = typeof o.album === 'string' ? o.album : ''
    if (!artist && !track) return null
    return { artist, track, album: album || undefined }
  } catch {
    return null
  }
}
