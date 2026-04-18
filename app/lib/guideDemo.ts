import type { ListenEvent, LLMProvider } from './llm'
import type { SpotifyTrack } from './spotify'

export interface GuideDemoHistoryEntry extends ListenEvent {
  albumArt: string | null
  uri: string | null
  category?: string
}

export interface GuideDemoCardState {
  track: SpotifyTrack
  reason: string
  category?: string
  coords?: { x: number; y: number }
  composed?: number
}

export interface GuideDemoChannel {
  id: string
  name: string
  isAutoNamed: boolean
  cardHistory: GuideDemoHistoryEntry[]
  sessionHistory: ListenEvent[]
  profile: string
  createdAt: number
  genres?: string[]
  genreText?: string
  timePeriod?: string
  notes?: string
  regions?: string[]
  artists?: string[]
  artistText?: string
  popularity?: number
  discovery?: number
}

export interface GuideDemoState {
  currentCard: GuideDemoCardState
  queue: GuideDemoCardState[]
  cardHistory: GuideDemoHistoryEntry[]
  sessionHistory: ListenEvent[]
  profile: string
  priorProfile: string
  pendingSuggestions: { search: string; reason: string }[]
  channels: GuideDemoChannel[]
  activeChannelId: string
  notes: string
  genres: string[]
  genreText: string
  timePeriod: string
  regions: string[]
  popularity: number
  discovery: number
  provider: LLMProvider
  playbackState: {
    paused: boolean
    position: number
    duration: number
    track_window: {
      current_track: { id: string; name: string; artists: { name: string }[] }
    }
  }
  sliderPosition: number
  currentStars: number | null
  loadingQueue: boolean
  submittedUris: Set<string>
  spotifyUser: { id: string; display_name?: string; product?: string }
  settingsDirty: boolean
  backoffUntil: number | null
  artists: string[]
  artistText: string
}

const art = (name: string) => `/guide/art/${name}.svg`

function track(
  id: string,
  name: string,
  artist: string,
  album: string,
  albumArt: string,
  durationMs: number,
  releaseYear: number
): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artist,
    album,
    albumArt,
    durationMs,
    releaseYear,
    source: 'spotify' as const,
  }
}

const tracks = {
  current: track(
    '6xdpwECaUdzv48eP9W9Urj',
    'Israel',
    'Miles Davis',
    'Birth Of The Cool',
    'https://i.scdn.co/image/ab67616d0000b273f44518f7aea6cc64ecca8448',
    138_321,
    1957
  ),
  queue: track('guide002', 'Velvet Transit', 'Milo Static', 'Night Platform', art('midnight-grid'), 215_000, 2022),
  heard1: track('guide003', 'Warm Signal', 'June Archive', 'Signal Bloom', art('signal-bloom'), 198_000, 2021),
  heard2: track('guide004', 'Brass in the Rain', 'Tomas Reed', 'Streetlight Suite', art('brass-sun'), 233_000, 2019),
  heard3: track('guide005', 'Cinder Mosaic', 'North Avenue', 'Chrome Rooms', art('cinder-mosaic'), 207_000, 2020),
  heard4: track('guide006', 'Cloud Memory', 'Iris Harbor', 'Cloud Memory', art('cloud-memory'), 254_000, 2018),
  heard5: track('guide007', 'Low Winter Sun', 'Kite Hours', 'Pale Orbit', art('aurora'), 221_000, 2017),
  heard6: track('guide008', 'River Circuit', 'Sable Choir', 'River Circuit', art('signal-bloom'), 202_000, 2023),
  heard7: track('guide009', 'Glass Spine', 'Vex Relay', 'Glass Spine', art('cinder-mosaic'), 189_000, 2021),
  heard8: track('guide010', 'Crowd Static', 'Mono Tier', 'Crowd Static', art('midnight-grid'), 176_000, 2022),
}

const profile =
  'LIKED: warm brass, nocturnal grooves, airy jazz harmony | DISLIKED: brittle synth-pop and frantic drums | EXPLORED: modern soul, downtempo electronica, modal jazz | NEXT: keep it rhythmic, melodic, and slightly left of center'

const cardHistory: GuideDemoHistoryEntry[] = [
  {
    track: tracks.heard1.name,
    artist: tracks.heard1.artist,
    stars: 4.5,
    albumArt: tracks.heard1.albumArt,
    uri: tracks.heard1.uri,
    category: 'Soul/Blues > Modern soul',
    coords: { x: 34, y: 56 },
  },
  {
    track: tracks.heard2.name,
    artist: tracks.heard2.artist,
    stars: 3.5,
    albumArt: tracks.heard2.albumArt,
    uri: tracks.heard2.uri,
    category: 'Jazz > Spiritual jazz',
    coords: { x: 24, y: 47 },
  },
  {
    track: tracks.heard3.name,
    artist: tracks.heard3.artist,
    stars: 1.5,
    albumArt: tracks.heard3.albumArt,
    uri: tracks.heard3.uri,
    category: 'Electronic > Industrial pop',
    coords: { x: 82, y: 71 },
  },
  {
    track: tracks.heard4.name,
    artist: tracks.heard4.artist,
    stars: 3.5,
    albumArt: tracks.heard4.albumArt,
    uri: tracks.heard4.uri,
    category: 'Ambient/New Age > Drift ambient',
    coords: { x: 88, y: 22 },
  },
  {
    track: tracks.heard5.name,
    artist: tracks.heard5.artist,
    stars: 5,
    albumArt: tracks.heard5.albumArt,
    uri: tracks.heard5.uri,
    category: 'Folk/Country > Cosmic folk',
    coords: { x: 18, y: 34 },
  },
  {
    track: tracks.heard6.name,
    artist: tracks.heard6.artist,
    stars: 3,
    albumArt: tracks.heard6.albumArt,
    uri: tracks.heard6.uri,
    category: 'World/Latin > Afro-Latin fusion',
    coords: { x: 42, y: 67 },
  },
  {
    track: tracks.heard7.name,
    artist: tracks.heard7.artist,
    stars: 1.5,
    albumArt: tracks.heard7.albumArt,
    uri: tracks.heard7.uri,
    category: 'Metal > Melodic metal',
    coords: { x: 70, y: 86 },
  },
  {
    track: tracks.heard8.name,
    artist: tracks.heard8.artist,
    stars: 2,
    albumArt: tracks.heard8.albumArt,
    uri: tracks.heard8.uri,
    category: 'Hip-Hop/R&B > Trap',
    coords: { x: 74, y: 61 },
  },
]

const sessionHistory: ListenEvent[] = cardHistory.map(({ track, artist, stars, coords }) => ({
  track,
  artist,
  stars,
  coords,
}))

const activeChannelId = 'guide-jazz-soul'

export const GUIDE_DEMO_MAP_HISTORY = cardHistory

export function getGuideDemoState(scene?: string | null): GuideDemoState {
  const currentCard: GuideDemoCardState = {
      track: tracks.current,
    reason: 'Picked because you kept rewarding spacious brass-led jazz with a cool, nocturnal feel.',
    category: 'Jazz > Cool jazz',
    coords: { x: 28, y: 44 },
    composed: 1949,
  }

  const queue: GuideDemoCardState[] = [
    {
      track: tracks.queue,
      reason: 'Keeps the pulse steady while nudging further into electronic texture.',
      category: 'Electronic > Downtempo',
      coords: { x: 74, y: 49 },
    },
  ]

  const pendingSuggestions = [
    {
      search: 'Harbor Lights by Sachi Mori',
      reason: 'A softer jazz-soul detour with similar harmonic warmth.',
    },
    {
      search: 'Static Bloom by Feral Coast',
      reason: 'A slightly rougher electronic edge without losing the nocturnal mood.',
    },
  ]

  const channels: GuideDemoChannel[] = [
    {
      id: activeChannelId,
      name: 'Jazz & Soul',
      isAutoNamed: false,
      cardHistory,
      sessionHistory,
      profile,
      createdAt: 1,
      genres: ['Jazz', 'Electronic'],
      genreText: 'dreamy downtempo',
      timePeriod: '1970s to now',
      notes: 'Keep it nocturnal, melodic, and low on distorted guitars.',
      regions: ['Scandinavia'],
      artists: [],
      artistText: '',
      popularity: 45,
      discovery: 50,
    },
    {
      id: 'guide-electronic',
      name: 'Electronic',
      isAutoNamed: false,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      createdAt: 2,
    },
    {
      id: 'guide-new',
      name: 'New Channel',
      isAutoNamed: true,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      createdAt: 3,
    },
  ]

  const backoffUntil = scene === 'status' ? Date.now() + 14 * 60_000 : null

  return {
    currentCard,
    queue,
    cardHistory,
    sessionHistory,
    profile,
    priorProfile: profile,
    pendingSuggestions,
    channels,
    activeChannelId,
    notes: 'Keep it nocturnal, melodic, and low on distorted guitars.',
    genres: ['Jazz', 'Electronic'],
    genreText: 'dreamy downtempo',
    timePeriod: '1970s to now',
    regions: ['Scandinavia'],
    popularity: 45,
    discovery: 50,
    artists: [],
    artistText: '',
    provider: 'deepseek',
    playbackState: {
      paused: false,
      position: 83_000,
      duration: currentCard.track.durationMs,
      track_window: {
        current_track: {
          id: currentCard.track.id,
          name: currentCard.track.name,
          artists: [{ name: currentCard.track.artist }],
        },
      },
    },
    sliderPosition: 83_000,
    currentStars: 4,
    loadingQueue: false,
    submittedUris: new Set(cardHistory.map(entry => entry.uri ?? '').filter(Boolean)),
    spotifyUser: {
      id: 'guide-demo',
      display_name: 'Guide Demo',
      product: 'premium',
    },
    settingsDirty: true,
    backoffUntil,
  }
}
