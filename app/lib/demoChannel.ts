/**
 * Built-in first-run channels and helpers for the "All" empty state.
 */
import type { PlaybackSource, CardState } from './playback/types'

export function getMostPopularCard(source: PlaybackSource): CardState {
  if (source === 'youtube') {
    return {
      track: {
        id: 'Zi_XLOBDo_Y',
        videoId: 'Zi_XLOBDo_Y',
        name: 'Billie Jean (Official Video)',
        artist: 'Michael Jackson',
        album: '',
        albumArt: 'https://i.ytimg.com/vi/Zi_XLOBDo_Y/hqdefault.jpg',
        durationMs: 0,
        source: 'youtube',
      },
      reason: 'Playing the most popular song to get you started on the All channel.',
      category: 'Pop > Dance-Pop',
      coords: { x: 70, y: 75 },
    }
  }
  return {
    track: {
      id: '5vGLqogsz9vSjrsV07n19X',
      uri: 'spotify:track:5vGLqogsz9vSjrsV07n19X',
      name: 'Billie Jean',
      artist: 'Michael Jackson',
      album: 'Thriller',
      albumArt: 'https://i.scdn.co/image/ab67616d0000b2734121a3503f9a70248ad9ea60',
      durationMs: 293826,
      source: 'spotify',
    },
    reason: 'Playing the most popular song to get you started on the All channel.',
    category: 'Pop > Dance-Pop',
    coords: { x: 70, y: 75 },
  }
}

/**
 * Factory defaults: first install (no stored channels), Settings → Factory reset, and blank-slate recovery
 * load from the server file when present, otherwise this object. `ensureAllChannel()` in the player prepends All.
 * System reset is different: it leaves a single empty All row only (see Settings / PlayerClient).
 *
 * Change this in source control to change what ships to every user (not localStorage).
 */
export const BUILT_IN_FACTORY_CHANNELS_IMPORT = {
  earprintExportVersion: 1,
  activeChannelId: 'builtin-my-music',
  channels: [
    {
      id: 'builtin-my-music',
      name: 'My Music',
      isAutoNamed: true,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      currentCard: null,
      queue: [],
      createdAt: 0,
      genres: [],
      genreText: '',
      timePeriod: '',
      notes: '',
      regions: [],
      artists: [],
      artistText: '',
      popularity: 50,
      discovery: 50,
    },
  ],
}

const ALL_CHANNEL_ID = 'earprint-all'

/** Same shape as the player’s aggregate channel (see PlayerClient `makeAllChannel`). */
function makeAllChannelForExport() {
  return {
    id: ALL_CHANNEL_ID,
    name: 'All',
    isAutoNamed: false,
    cardHistory: [],
    sessionHistory: [],
    profile: '',
    createdAt: 0,
    genres: [] as string[],
    genreText: '',
    timePeriod: '',
    notes: '',
    regions: [] as string[],
    artists: [] as string[],
    artistText: '',
    popularity: 50,
    discovery: 100,
  }
}

/**
 * Serialized channels + active id for `earprint-channels` / factory reset (matches code defaults + All).
 */
export function getBundledFactoryChannelsForReset(): {
  channels: unknown[]
  activeChannelId: string
} {
  const fromImport = BUILT_IN_FACTORY_CHANNELS_IMPORT.channels as unknown[]
  const hasAll = fromImport.some(
    c => c && typeof c === 'object' && (c as { id?: string }).id === ALL_CHANNEL_ID,
  )
  const channels = hasAll ? [...fromImport] : [makeAllChannelForExport(), ...fromImport]
  const activeChannelId =
    typeof BUILT_IN_FACTORY_CHANNELS_IMPORT.activeChannelId === 'string'
      ? BUILT_IN_FACTORY_CHANNELS_IMPORT.activeChannelId
      : (channels.find(
          c => c && typeof c === 'object' && (c as { id?: string }).id !== ALL_CHANNEL_ID,
        ) as { id?: string } | undefined)?.id ?? (channels[0] as { id?: string })?.id ?? 'builtin-my-music'
  return { channels, activeChannelId }
}
