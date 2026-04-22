/** JSON export wrapper version (see Settings → Export). */
export const CHANNELS_EXPORT_VERSION = 1

/** Matches `earprint-all` in the player and channels UI. */
export const EARPRINT_ALL_CHANNEL_ID = 'earprint-all'

/**
 * Map exploration for bounded channels: balanced slots; channel filters carry the intent.
 * (No per-channel discovery slider — only "All" uses full exploration.)
 */
export const CHANNEL_DISCOVERY_DEFAULT = 50

/** All channel: full exploration in taste space (no genre/region filters). */
export const ALL_CHANNEL_DISCOVERY_DEFAULT = 100

export function normalizeChannelDiscovery(c: Channel): Channel {
  const discovery =
    c.id === EARPRINT_ALL_CHANNEL_ID ? ALL_CHANNEL_DISCOVERY_DEFAULT : CHANNEL_DISCOVERY_DEFAULT
  return { ...c, discovery }
}

export interface HistoryEntry {
  track: string
  artist: string
  albumArt?: string | null
  uri?: string | null
  source?: 'spotify' | 'youtube'
  stars?: number | null
  [key: string]: unknown
}

export interface Channel {
  id: string
  name: string
  isAutoNamed: boolean
  cardHistory: HistoryEntry[]
  sessionHistory: unknown[]
  profile: string
  createdAt: number
  genres?: string[]
  genreText?: string
  timePeriods?: string[]
  notes?: string
  regions?: string[]
  artists?: string[]
  artistText?: string
  popularity?: number
  discovery?: number
  /** Up-next queue at the time of export (preserved through import so the user
   *  doesn't lose their queued-up suggestions after an export → reset → import cycle). */
  queue?: unknown[]
  /** The track that was playing at export time. Preserved for the same reason as `queue`. */
  currentCard?: unknown
  playbackPositionMs?: number
  playbackTrackUri?: string
  /** True when the user created this channel in-app; false = factory/share/starter import. */
  userCreated?: boolean
  [key: string]: unknown
}

export function genChannelId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function normalizeImportedChannel(raw: unknown): Channel | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : genChannelId()
  const name = typeof o.name === 'string' ? o.name : 'Channel'
  const createdAt = typeof o.createdAt === 'number' ? o.createdAt : Date.now()
  const base: Channel = {
    id,
    name,
    isAutoNamed: typeof o.isAutoNamed === 'boolean' ? o.isAutoNamed : false,
    cardHistory: Array.isArray(o.cardHistory) ? (o.cardHistory as HistoryEntry[]) : [],
    sessionHistory: Array.isArray(o.sessionHistory) ? o.sessionHistory : [],
    profile: typeof o.profile === 'string' ? o.profile : '',
    createdAt,
    ...(o.genres !== undefined && { genres: o.genres as string[] }),
    ...(o.genreText !== undefined && { genreText: o.genreText as string }),
    timePeriods: Array.isArray(o.timePeriods)
      ? (o.timePeriods as string[])
      : typeof o.timePeriod === 'string' && o.timePeriod
        ? [o.timePeriod as string]
        : [],
    ...(o.notes !== undefined && { notes: o.notes as string }),
    ...(o.regions !== undefined && { regions: o.regions as string[] }),
    ...(o.artists !== undefined && { artists: o.artists as string[] }),
    ...(o.artistText !== undefined && { artistText: o.artistText as string }),
    ...(o.popularity !== undefined && { popularity: o.popularity as number }),
    ...(o.discovery !== undefined && { discovery: o.discovery as number }),
    ...(o.source !== undefined && { source: o.source as string }),
    // Preserve queued-up playback state so export → reset → import doesn't silently
    // eat the user's up-next queue and current track. The PlayerClient normalizer
    // already keeps these; the shared helper used to drop them.
    ...(Array.isArray(o.queue) && { queue: o.queue as unknown[] }),
    ...(o.currentCard !== undefined && { currentCard: o.currentCard }),
    ...(typeof o.playbackPositionMs === 'number' && { playbackPositionMs: o.playbackPositionMs }),
    ...(typeof o.playbackTrackUri === 'string' && { playbackTrackUri: o.playbackTrackUri }),
    ...(typeof o.userCreated === 'boolean' && { userCreated: o.userCreated }),
  }
  return normalizeChannelDiscovery(base)
}

export function parseChannelsImport(raw: unknown): { channels: Channel[]; activeChannelId?: string } | null {
  let list: unknown[] | undefined
  let activeChannelId: string | undefined
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.channels)) {
      list = o.channels
      activeChannelId = o.activeChannelId as string | undefined
    }
  }
  if (!list?.length) return null
  const channels: Channel[] = []
  for (const item of list) {
    const ch = normalizeImportedChannel(item)
    if (ch) channels.push(ch)
  }
  return channels.length ? { channels, activeChannelId } : null
}
