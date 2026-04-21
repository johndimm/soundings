'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppHeader from '@/app/components/AppHeader'
import { getBundledFactoryChannelsForReset } from '@/app/lib/demoChannel'
import {
  ALL_CHANNEL_DISCOVERY_DEFAULT,
  CHANNEL_DISCOVERY_DEFAULT,
  genChannelId,
  normalizeChannelDiscovery,
  type Channel,
} from '@/app/lib/channelsImportExport'

const CHANNELS_STORAGE_KEY = 'earprint-channels'
const ACTIVE_CHANNEL_KEY = 'earprint-active-channel'
const ALL_CHANNEL_ID = 'earprint-all'

const GENRE_OPTIONS = [
  'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Folk', 'Metal', 'Soul', 'Blues', 'Reggae', 'Latin', 'Punk',
]

const TIME_PERIOD_OPTIONS = [
  { label: '40s', value: '1940s' },
  { label: '50s', value: '1950s' },
  { label: '60s', value: '1960s' },
  { label: '70s', value: '1970s' },
  { label: '80s', value: '1980s' },
  { label: '90s', value: '1990s' },
  { label: '2000s', value: '2000s' },
  { label: '2010s', value: '2010s' },
  { label: 'Recent', value: 'after 2020' },
  { label: 'Medieval', value: 'medieval era' },
  { label: 'Renaissance', value: 'Renaissance era' },
  { label: 'Baroque', value: 'Baroque era' },
  { label: 'Classical', value: 'Classical era' },
  { label: 'Romantic', value: 'Romantic era' },
  { label: '20th C.', value: '20th century classical' },
]

const REGION_OPTIONS = [
  'US & Canada', 'UK & Ireland', 'Western Europe', 'Scandinavia',
  'Eastern Europe', 'Latin America', 'Brazil', 'Caribbean',
  'Africa', 'Middle East', 'India', 'East Asia', 'Southeast Asia',
]

/** Artist quick-picks keyed by genre (union when multiple genres are selected). */
const ARTISTS_BY_GENRE: Record<string, readonly string[]> = {
  Pop: ['The Beatles', 'Madonna', 'Michael Jackson', 'ABBA', 'Taylor Swift', 'Elton John'],
  Rock: ['The Beatles', 'Led Zeppelin', 'Pink Floyd', 'David Bowie', 'Radiohead', 'The Cure'],
  'Hip-Hop': ['Kendrick Lamar', 'Outkast', 'Nas', 'Missy Elliott', 'Wu-Tang Clan'],
  'R&B': ['Marvin Gaye', 'Aretha Franklin', 'Stevie Wonder', 'Prince', 'Whitney Houston'],
  Electronic: ['Kraftwerk', 'Aphex Twin', 'Daft Punk', 'Brian Eno', 'Depeche Mode'],
  Jazz: ['Miles Davis', 'John Coltrane', 'Billie Holiday', 'Ella Fitzgerald', 'Duke Ellington', 'Nina Simone'],
  Classical: [
    'Johann Sebastian Bach',
    'Wolfgang Amadeus Mozart',
    'Ludwig van Beethoven',
    'Frédéric Chopin',
    'Claude Debussy',
    'Igor Stravinsky',
    'Philip Glass',
  ],
  Country: ['Johnny Cash', 'Dolly Parton', 'Willie Nelson', 'Patsy Cline', 'Hank Williams'],
  Folk: ['Joni Mitchell', 'Bob Dylan', 'Joan Baez', 'Simon & Garfunkel'],
  Metal: ['Metallica', 'Black Sabbath', 'Iron Maiden', 'Judas Priest'],
  Soul: ['Marvin Gaye', 'Aretha Franklin', 'Otis Redding', 'James Brown'],
  Blues: ['B.B. King', 'Muddy Waters', 'Robert Johnson', 'Howlin\' Wolf'],
  Reggae: ['Bob Marley', 'Peter Tosh', 'Jimmy Cliff'],
  Latin: ['Celia Cruz', 'Carlos Santana', 'Bad Bunny', 'Rosalía'],
  Punk: ['The Ramones', 'Sex Pistols', 'The Clash', 'Black Flag'],
}

/**
 * Time chips → example names. Decade rows mix familiar recording artists with composers in the
 * notated / concert tradition (including contemporary classical); art-music era rows are historical style periods.
 */
const ARTISTS_BY_TIME_PERIOD: Record<string, readonly string[]> = {
  '1940s': ['Frank Sinatra', 'Billie Holiday', 'Ella Fitzgerald', 'Duke Ellington', 'Igor Stravinsky', 'Benjamin Britten'],
  '1950s': ['Elvis Presley', 'Chuck Berry', 'Little Richard', 'Miles Davis', 'Pierre Boulez', 'John Cage'],
  '1960s': ['The Beatles', 'Bob Dylan', 'Jimi Hendrix', 'Aretha Franklin', 'György Ligeti', 'Steve Reich'],
  '1970s': ['Led Zeppelin', 'Stevie Wonder', 'David Bowie', 'Pink Floyd', 'Philip Glass', 'Arvo Pärt'],
  '1980s': ['Madonna', 'Prince', 'Michael Jackson', 'The Cure', 'John Adams', 'Henryk Górecki'],
  '1990s': ['Radiohead', 'Outkast', 'Björk', 'Nirvana', 'Thomas Adès', 'Kaija Saariaho'],
  '2000s': ['Radiohead', 'Outkast', 'Beyoncé', 'Amy Winehouse', 'John Luther Adams', 'Anna Meredith'],
  '2010s': ['Taylor Swift', 'Kendrick Lamar', 'Adele', 'Caroline Shaw', 'Hildur Guðnadóttir'],
  'after 2020': ['Taylor Swift', 'Bad Bunny', 'Billie Eilish', 'Anna Thorvaldsdottir', 'Gabriel Kahane'],
  'medieval era': ['Hildegard von Bingen', 'Guillaume de Machaut', 'Perotin'],
  'Renaissance era': ['Josquin des Prez', 'Giovanni Palestrina', 'William Byrd'],
  'Baroque era': ['Johann Sebastian Bach', 'George Frideric Handel', 'Antonio Vivaldi', 'Claudio Monteverdi'],
  'Classical era': ['Wolfgang Amadeus Mozart', 'Joseph Haydn', 'Ludwig van Beethoven'],
  'Romantic era': ['Frédéric Chopin', 'Johannes Brahms', 'Richard Wagner', 'Pyotr Ilyich Tchaikovsky'],
  '20th century classical': ['Igor Stravinsky', 'Dmitri Shostakovich', 'Béla Bartók', 'Olivier Messiaen'],
}

const ARTISTS_BY_REGION: Record<string, readonly string[]> = {
  'US & Canada': ['Frank Sinatra', 'Prince', 'Bob Dylan', 'Aaron Copland'],
  'UK & Ireland': ['The Beatles', 'David Bowie', 'Kate Bush', 'Benjamin Britten'],
  'Western Europe': ['Édith Piaf', 'Claude Debussy', 'Maurice Ravel', 'Johannes Brahms'],
  Scandinavia: ['ABBA', 'Björk', 'Robyn', 'Jean Sibelius'],
  'Eastern Europe': ['Frédéric Chopin', 'Dmitri Shostakovich', 'Béla Bartók'],
  'Latin America': ['Celia Cruz', 'Carlos Santana', 'Heitor Villa-Lobos'],
  Brazil: ['Antônio Carlos Jobim', 'Gilberto Gil', 'Caetano Veloso'],
  Caribbean: ['Bob Marley', 'Jimmy Cliff', 'Celia Cruz'],
  Africa: ['Fela Kuti', 'Youssou N\'Dour'],
  'Middle East': ['Fairuz', 'Ofra Haza'],
  India: ['Ravi Shankar', 'A.R. Rahman'],
  'East Asia': ['Ryuichi Sakamoto', 'Yo-Yo Ma'],
  'Southeast Asia': ['Yanni', 'Anggun'],
}

/** Union of genre + selected time periods + selected regions (deduped). */
function deriveArtistOptions(genres: string[], timePeriods: string[], regions: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    out.push(name)
  }
  for (const g of genres) {
    for (const a of ARTISTS_BY_GENRE[g] ?? []) push(a)
  }
  for (const tp of timePeriods) {
    for (const a of ARTISTS_BY_TIME_PERIOD[tp] ?? []) push(a)
  }
  for (const r of regions) {
    for (const a of ARTISTS_BY_REGION[r] ?? []) push(a)
  }
  return out
}

function mergeArtistTextIntoNotes(ch: Channel): Channel {
  const at = typeof ch.artistText === 'string' ? ch.artistText.trim() : ''
  if (!at) return ch
  const n = typeof ch.notes === 'string' ? ch.notes.trim() : ''
  const merged = n ? `${n}\n\n${at}` : at
  return { ...ch, notes: merged, artistText: '' }
}

function makeAllChannel(): Channel {
  return {
    id: ALL_CHANNEL_ID,
    name: 'All',
    isAutoNamed: false,
    cardHistory: [],
    sessionHistory: [],
    profile: '',
    createdAt: 0,
    genres: [],
    genreText: '',
    timePeriods: [],
    notes: '',
    regions: [],
    artists: [],
    artistText: '',
    popularity: 50,
    discovery: ALL_CHANNEL_DISCOVERY_DEFAULT,
  }
}

function ensureAllChannel(channels: Channel[]): Channel[] {
  if (channels.some(c => c.id === ALL_CHANNEL_ID)) return channels
  return [makeAllChannel(), ...channels]
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-black text-white border-black'
          : 'bg-transparent text-zinc-500 border-zinc-300 hover:border-zinc-500 hover:text-black'
      }`}
    >
      {label}
    </button>
  )
}

export default function ChannelsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const newHandled = useRef(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingChannelName, setEditingChannelName] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    let loaded: Channel[] = []
    try {
      const raw = localStorage.getItem(CHANNELS_STORAGE_KEY)
      loaded = ensureAllChannel(raw ? JSON.parse(raw) : [])
      loaded = loaded.map(mergeArtistTextIntoNotes).map(normalizeChannelDiscovery)
      // Persist merged notes + cleared artistText, and any All-channel insertion from ensureAllChannel
      try { localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(loaded)) } catch {}
      const activeId = localStorage.getItem(ACTIVE_CHANNEL_KEY)
      setChannels(loaded)
      setActiveChannelId(activeId ?? loaded[0]?.id ?? null)
    } catch {}

    if (searchParams.get('new') === '1' && !newHandled.current) {
      newHandled.current = true
      const newCh: Channel = {
        id: genChannelId(),
        name: 'New Channel',
        isAutoNamed: false,
        cardHistory: [],
        sessionHistory: [],
        profile: '',
        createdAt: Date.now(),
        genres: [],
        genreText: '',
        timePeriods: [],
        notes: '',
        regions: [],
        artists: [],
        artistText: '',
        popularity: 50,
        discovery: CHANNEL_DISCOVERY_DEFAULT,
      }
      const updated = [...loaded, newCh]
      setChannels(updated)
      setActiveChannelId(newCh.id)
      try {
        localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(updated))
        localStorage.setItem(ACTIVE_CHANNEL_KEY, newCh.id)
      } catch {}
      router.replace('/channels', { scroll: false })
    }

    setMounted(true)
  }, [searchParams])

  const activeChannel = channels.find(c => c.id === activeChannelId) ?? channels[0]

  const selectionKey = JSON.stringify({
    g: activeChannel?.genres ?? [],
    tp: activeChannel?.timePeriods ?? [],
    r: activeChannel?.regions ?? [],
  })

  const derivedArtistOptions = useMemo(
    () =>
      deriveArtistOptions(
        activeChannel?.genres ?? [],
        activeChannel?.timePeriods ?? [],
        activeChannel?.regions ?? []
      ),
    [selectionKey]
  )

  useEffect(() => {
    if (!mounted) return
    if (!activeChannelId) return
    setChannels(prev => {
      const ch = prev.find(c => c.id === activeChannelId)
      if (!ch || ch.id === ALL_CHANNEL_ID) return prev
      const allowed = new Set(
        deriveArtistOptions(ch.genres ?? [], ch.timePeriods ?? [], ch.regions ?? [])
      )
      const cur = ch.artists ?? []
      const pruned = cur.filter(a => allowed.has(a))
      if (pruned.length === cur.length) return prev
      const next = prev.map(c => (c.id === ch.id ? { ...c, artists: pruned } : c))
      try {
        localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [mounted, activeChannelId, selectionKey])

  const persist = (updated: Channel[]) => {
    setChannels(updated)
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(updated))
    } catch {}
  }

  const updateActive = (patch: Partial<Channel>) => {
    if (!activeChannel) return
    persist(
      channels.map(c => (c.id === activeChannel.id ? { ...c, ...patch } : c))
    )
  }

  const switchChannel = (id: string) => {
    setActiveChannelId(id)
    try {
      localStorage.setItem(ACTIVE_CHANNEL_KEY, id)
    } catch {}
  }

  const createChannel = () => {
    const newCh: Channel = {
      id: genChannelId(),
      name: 'New Channel',
      isAutoNamed: false,
      cardHistory: [],
      sessionHistory: [],
      profile: '',
      createdAt: Date.now(),
      genres: [],
      genreText: '',
      timePeriods: [],
      notes: '',
      regions: [],
      artists: [],
      artistText: '',
      popularity: 50,
      discovery: CHANNEL_DISCOVERY_DEFAULT,
    }
    const updated = [...channels, newCh]
    persist(updated)
    switchChannel(newCh.id)
  }

  const deleteChannel = (id: string) => {
    if (id === ALL_CHANNEL_ID) return
    if (channels.length <= 1) return
    const updated = channels.filter(c => c.id !== id)
    persist(updated)
    if (id === activeChannelId) {
      switchChannel(updated[0].id)
    }
  }

  const renameChannel = (id: string, name: string) => {
    persist(channels.map(c => (c.id === id ? { ...c, name, isAutoNamed: false } : c)))
  }

  const toggleGenre = (g: string) => {
    const genres = activeChannel?.genres ?? []
    updateActive({
      genres: genres.includes(g) ? genres.filter(x => x !== g) : [...genres, g],
    })
  }

  const toggleTimePeriod = (v: string) => {
    const tps = activeChannel?.timePeriods ?? []
    updateActive({ timePeriods: tps.includes(v) ? tps.filter(x => x !== v) : [...tps, v] })
  }

  const toggleRegion = (r: string) => {
    const regions = activeChannel?.regions ?? []
    updateActive({
      regions: regions.includes(r) ? regions.filter(x => x !== r) : [...regions, r],
    })
  }

  const toggleArtist = (name: string) => {
    const list = activeChannel?.artists ?? []
    updateActive({
      artists: list.includes(name) ? list.filter(x => x !== name) : [...list, name],
    })
  }

  const mergeFactoryChannels = async () => {
    try {
      const r = await fetch('/api/factory-defaults', { credentials: 'same-origin', cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      let incoming: Channel[] = []
      let firstId = ''
      if (d?.ok && Array.isArray(d.channels) && d.channels.length > 0) {
        incoming = d.channels as Channel[]
        firstId = typeof d.activeChannelId === 'string' ? d.activeChannelId : incoming[0]?.id ?? ''
      } else {
        const fb = getBundledFactoryChannelsForReset()
        incoming = fb.channels as Channel[]
        firstId = fb.activeChannelId
      }
      if (!incoming.length) return
      const cur: Channel[] = channels
      const existingIds = new Set(cur.map(c => c.id))
      const toAdd = incoming.filter(c => !existingIds.has(c.id))
      const merged = [...cur, ...toAdd]
      persist(merged)
      const newActive = firstId && merged.find(c => c.id === firstId) ? firstId : (toAdd[0]?.id ?? cur[0]?.id ?? '')
      if (newActive) switchChannel(newActive)
    } catch {}
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col">
        <AppHeader />
      </div>
    )
  }

  const ch = activeChannel
  const genres = ch?.genres ?? []
  const regions = ch?.regions ?? []
  const timePeriods = ch?.timePeriods ?? []
  const artists = ch?.artists ?? []
  const popularity = ch?.popularity ?? 50
  const notes = ch?.notes ?? ''

  const popularityLabel = popularity <= 20 ? 'Hidden gems' : popularity <= 40 ? 'Obscure' : popularity >= 80 ? 'Mainstream' : popularity >= 60 ? 'Popular' : 'Mixed'

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <AppHeader />

      <div className="flex flex-col sm:flex-row gap-0 flex-1 max-w-[800px] mx-auto w-full">
        {/* Channel list sidebar */}
        <div className="sm:w-48 border-b sm:border-b-0 sm:border-r border-zinc-200 p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Channels</span>
            <button
              onClick={createChannel}
              className="text-lg leading-none text-zinc-400 hover:text-black transition-colors"
              title="New channel"
            >
              +
            </button>
          </div>
          {channels.map(c => (
            <div key={c.id} className="flex items-center gap-1 group">
              {editingChannelId === c.id ? (
                <input
                  className="flex-1 bg-transparent outline-none text-xs text-black border-b border-zinc-300 px-1"
                  value={editingChannelName}
                  onChange={e => setEditingChannelName(e.target.value)}
                  onBlur={() => {
                    renameChannel(c.id, editingChannelName)
                    setEditingChannelId(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      renameChannel(c.id, editingChannelName)
                      setEditingChannelId(null)
                    }
                    if (e.key === 'Escape') setEditingChannelId(null)
                  }}
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => {
                    if (c.id === activeChannelId) {
                      if (c.id !== ALL_CHANNEL_ID) {
                        setEditingChannelId(c.id)
                        setEditingChannelName(c.name)
                      }
                    } else {
                      switchChannel(c.id)
                    }
                  }}
                  className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-colors truncate ${
                    c.id === activeChannelId
                      ? 'bg-zinc-100 text-black font-medium'
                      : 'text-zinc-500 hover:text-black hover:bg-zinc-100'
                  }`}
                >
                  {c.name}
                </button>
              )}
              {channels.length > 1 && c.id !== ALL_CHANNEL_ID && (
                <button
                  onClick={() => deleteChannel(c.id)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-all px-1"
                  title="Delete channel"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Main panel */}
        {ch ? (
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">

            {/* Settings */}
            <div className="border-b border-zinc-200 px-4 pt-4 pb-5 flex flex-col gap-5">
              {ch.id === ALL_CHANNEL_ID && channels.length === 1 ? (
                <div className="flex flex-col gap-3 py-2">
                  <p className="text-sm text-zinc-500">No custom channels yet.</p>
                  <button
                    type="button"
                    onClick={() => void mergeFactoryChannels()}
                    className="self-start px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-700 text-white text-sm font-medium transition-colors"
                  >
                    Merge factory channels
                  </button>
                </div>
              ) : ch.id === ALL_CHANNEL_ID ? null : (
                <>
                  {/* Genres */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Genres</label>
                    <div className="flex flex-wrap gap-1.5">
                      {GENRE_OPTIONS.map(g => (
                        <Chip key={g} label={g} active={genres.includes(g)} onClick={() => toggleGenre(g)} />
                      ))}
                    </div>
                  </div>

                  {/* Region */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Region</label>
                    <div className="flex flex-wrap gap-1.5">
                      {REGION_OPTIONS.map(r => (
                        <Chip key={r} label={r} active={regions.includes(r)} onClick={() => toggleRegion(r)} />
                      ))}
                    </div>
                  </div>

                  {/* Time period */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Time period</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TIME_PERIOD_OPTIONS.map(opt => (
                        <Chip
                          key={opt.value}
                          label={opt.label}
                          active={timePeriods.includes(opt.value)}
                          onClick={() => toggleTimePeriod(opt.value)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Artists (options = union from genres + eras + regions) */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Artists</label>
                    {derivedArtistOptions.length === 0 ? (
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        Select genres, eras, or regions to see artist picks matching those choices.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {derivedArtistOptions.map(a => (
                          <Chip
                            key={a}
                            label={a}
                            active={artists.includes(a)}
                            onClick={() => toggleArtist(a)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Popularity */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-zinc-500 uppercase tracking-wide">Popularity</label>
                      <span className="text-xs text-zinc-400">{popularityLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600">Obscure</span>
                      <input
                        type="range" min={0} max={100} value={popularity}
                        onChange={e => updateActive({ popularity: Number(e.target.value) })}
                        className="flex-1 accent-zinc-400"
                      />
                      <span className="text-xs text-zinc-600">Mainstream</span>
                    </div>
                  </div>

                  {/* Notes & freeform hints */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500 uppercase tracking-wide">Notes and hints</label>
                    <textarea
                      value={notes}
                      onChange={e => updateActive({ notes: e.target.value })}
                      placeholder="Anything for the DJ — extra artists, avoid lists, mood, era, lyrics, … e.g. lean Coltrane, no smooth jazz, upbeat only, nothing after 1990."
                      rows={4}
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-3 py-2 text-sm text-black placeholder-zinc-400 resize-none focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <p className="text-xs text-zinc-600 italic">
                    Changes take effect on the next song the DJ picks.
                  </p>
                </>
              )}
            </div>

            {/* Channel History link */}
            <div className="border-t border-zinc-100 py-3 px-4">
              <Link
                href={`/ratings?channel=${activeChannel?.id ?? ''}`}
                className="flex-1 block py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-medium transition-colors text-center"
              >
                Channel History
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-6 flex items-center justify-center">
            <div className="text-center">
              <p className="text-zinc-500 text-sm mb-3">No channels yet.</p>
              <button
                onClick={createChannel}
                className="text-sm px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white transition-colors"
              >
                Create a channel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
