import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet } from '@/app/lib/kvStore'

/**
 * Share API.
 *
 *   POST /api/share
 *     body: { channel: ChannelMeta, track: CardState, source: 'spotify' | 'youtube' }
 *     → { ok: true, id } on success; share persists in Redis REST (Marketplace KV) for ~90 days.
 *
 *   GET  /api/share?id=<id>
 *     → { ok: true, payload } | { ok: false, reason }
 *
 * The payload intentionally carries ONLY enough state to reconstruct what the
 * sender's player is showing right now:
 *   - the **channel settings** (name, profile, genres/regions/artists, etc.)
 *     so the recipient can get the same DJ vibe. The channel's listening
 *     history and queued tracks are NOT included — the queue belongs to the
 *     sender's session, and history is personal.
 *   - the **current track** only (one CardState).
 *
 * On the recipient side (see PlayerClient), if the channel's id is already
 * present we just switch to it; otherwise we insert a fresh copy (empty
 * history) and switch. Either way the shared track becomes the now-playing
 * card so playback starts immediately.
 */

const SHARE_KEY_PREFIX = 'earprint:share:'
const SHARE_TTL_SEC = 60 * 60 * 24 * 90 // 90 days

// 10-char base36 id: ~5e15 combinations. Plenty for collision-safe short links
// at our scale without needing a retry loop.
function genShareId(): string {
  const a = Math.random().toString(36).slice(2, 8)
  const b = Math.random().toString(36).slice(2, 6)
  return (a + b).slice(0, 10)
}

type CardStateLike = {
  track: {
    id: string
    name: string
    artist: string
    artists?: string[]
    album: string
    albumArt: string | null
    durationMs: number
    releaseYear?: number
    source: 'spotify' | 'youtube'
    uri?: string
    videoId?: string
  }
  reason: string
  category?: string
  coords?: { x: number; y: number }
  composed?: number
  performer?: string
}

function sanitizeTrack(raw: unknown): CardStateLike | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const t = r.track as Record<string, unknown> | undefined
  if (!t || typeof t !== 'object') return null
  const id = typeof t.id === 'string' ? t.id : ''
  const name = typeof t.name === 'string' ? t.name : ''
  const artist = typeof t.artist === 'string' ? t.artist : ''
  const source = t.source === 'youtube' ? 'youtube' : t.source === 'spotify' ? 'spotify' : null
  if (!id || !name || !source) return null
  const out: CardStateLike = {
    track: {
      id,
      name,
      artist,
      artists: Array.isArray(t.artists) ? (t.artists as string[]) : undefined,
      album: typeof t.album === 'string' ? t.album : '',
      albumArt: typeof t.albumArt === 'string' ? t.albumArt : null,
      durationMs: typeof t.durationMs === 'number' ? t.durationMs : 0,
      releaseYear: typeof t.releaseYear === 'number' ? t.releaseYear : undefined,
      source,
      uri: typeof t.uri === 'string' ? t.uri : undefined,
      videoId: typeof t.videoId === 'string' ? t.videoId : undefined,
    },
    reason: typeof r.reason === 'string' ? r.reason : '',
    category: typeof r.category === 'string' ? r.category : undefined,
    coords:
      r.coords &&
      typeof r.coords === 'object' &&
      typeof (r.coords as Record<string, unknown>).x === 'number' &&
      typeof (r.coords as Record<string, unknown>).y === 'number'
        ? { x: (r.coords as { x: number }).x, y: (r.coords as { y: number }).y }
        : undefined,
    composed: typeof r.composed === 'number' ? r.composed : undefined,
    performer: typeof r.performer === 'string' ? r.performer : undefined,
  }
  return out
}

function sanitizeChannel(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null
  if (!id || !name) return null
  // Copy only the settings fields that influence DJ behaviour. Deliberately
  // drop cardHistory / sessionHistory / queue / currentCard / playback cursors.
  const out: Record<string, unknown> = { id, name }
  if (typeof o.isAutoNamed === 'boolean') out.isAutoNamed = o.isAutoNamed
  if (typeof o.profile === 'string') out.profile = o.profile
  if (typeof o.createdAt === 'number') out.createdAt = o.createdAt
  if (Array.isArray(o.genres)) out.genres = o.genres as string[]
  if (typeof o.genreText === 'string') out.genreText = o.genreText
  if (Array.isArray(o.timePeriods)) out.timePeriods = o.timePeriods as string[]
  else if (typeof o.timePeriod === 'string' && o.timePeriod) out.timePeriods = [o.timePeriod]
  if (typeof o.notes === 'string') out.notes = o.notes
  if (Array.isArray(o.regions)) out.regions = o.regions as string[]
  if (Array.isArray(o.artists)) out.artists = o.artists as string[]
  if (typeof o.artistText === 'string') out.artistText = o.artistText
  if (typeof o.popularity === 'number') out.popularity = o.popularity
  if (typeof o.discovery === 'number') out.discovery = o.discovery
  if (o.source === 'spotify' || o.source === 'youtube') out.source = o.source
  return out
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const b = body as { channel?: unknown; track?: unknown; source?: unknown }
  const channel = sanitizeChannel(b.channel)
  const track = sanitizeTrack(b.track)
  const source = b.source === 'youtube' ? 'youtube' : b.source === 'spotify' ? 'spotify' : null

  if (!channel || !track || !source) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 })
  }

  const id = genShareId()
  const payload = {
    v: 1 as const,
    createdAt: Date.now(),
    source,
    channel,
    track,
  }

  const ok = await kvSet(SHARE_KEY_PREFIX + id, payload, SHARE_TTL_SEC)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'kv_write_failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, id })
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id || !/^[a-z0-9]{4,32}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 })
  }

  const payload = await kvGet(SHARE_KEY_PREFIX + id)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, payload })
}
