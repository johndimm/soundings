/** JSON export wrapper version (see Settings → Export). */
export const CHANNELS_EXPORT_VERSION = 1

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
  return {
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
  }
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
