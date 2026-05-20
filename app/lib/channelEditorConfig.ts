import type { ChannelEditorConfig, ChannelEditorValues } from '@/app/components/ChannelEditorForm'
import type { Channel } from '@/app/lib/channelsImportExport'

const SETTINGS_STORAGE_KEY = 'earprint-settings'

export const GENRE_OPTIONS = [
  'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Folk', 'Metal', 'Soul', 'Blues', 'Reggae', 'Latin', 'Punk',
]

export const TIME_PERIOD_VALUES = [
  '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', 'after 2020',
  'medieval era', 'Renaissance era', 'Baroque era', 'Classical era', 'Romantic era',
  '20th century classical',
]

export const REGION_OPTIONS = [
  'US & Canada', 'UK & Ireland', 'Western Europe', 'Scandinavia',
  'Eastern Europe', 'Latin America', 'Brazil', 'Caribbean',
  'Africa', 'Middle East', 'India', 'East Asia', 'Southeast Asia',
]

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

function deriveStaticArtistOptions(form: ChannelEditorValues): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(name)
  }
  for (const g of form.genres) {
    for (const a of ARTISTS_BY_GENRE[g] ?? []) push(a)
  }
  for (const tp of form.timePeriods) {
    for (const a of ARTISTS_BY_TIME_PERIOD[tp] ?? []) push(a)
  }
  for (const r of form.regions) {
    for (const a of ARTISTS_BY_REGION[r] ?? []) push(a)
  }
  return out
}

function readLlmProviderFromSettings(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return 'deepseek'
    const p = JSON.parse(raw)?.provider
    return typeof p === 'string' ? p : 'deepseek'
  } catch {
    return 'deepseek'
  }
}

export const SOUNDINGS_CHANNEL_EDITOR_CONFIG: ChannelEditorConfig = {
  freeTextTitle: 'What you want',
  freeTextHelp:
    'Describe the music for this channel—mood, artists, eras, genres, or examples. The app uses this as the main signal; the chips below refine it.',
  nameLabel: 'Channel name',
  nameHelp: 'Short label on the player. Give it a clear title—you do not need to repeat it in the description above.',
  namePlaceholder: 'e.g. Late-night jazz, French coldwave, baroque keyboard',
  freeTextPlaceholder:
    'E.g. intense minor-key baroque keyboard, no smooth jazz, focus on Scarlatti and contemporaries…',
  refineHelp:
    'Use the chips to match the description, or set them by hand. You can add more in the text above if needed.',
  artistsLabel: 'Artists',
  artistsEmptyHint:
    'No suggestions yet — add more in the description or try genres, era, or region.',
  artistsNeedInputHint:
    'Add a channel name, description, or a filter chip to see artist ideas.',
  genreOptions: GENRE_OPTIONS,
  timePeriodOptions: TIME_PERIOD_VALUES,
  showRegions: true,
  regionOptions: REGION_OPTIONS,
  readLlm: readLlmProviderFromSettings,
  buildSuggestBody: (form, llm) => ({
    name: form.name,
    genres: form.genres,
    genreText: '',
    timePeriods: form.timePeriods,
    regions: form.regions,
    notes: form.freeText,
    popularity: form.popularity,
    provider: llm,
  }),
  getStaticArtistOptions: deriveStaticArtistOptions,
}

export function channelToEditorValues(ch: Channel): ChannelEditorValues {
  return {
    name: ch.name,
    freeText: ch.notes ?? '',
    genres: ch.genres ?? [],
    timePeriods: ch.timePeriods ?? [],
    regions: ch.regions ?? [],
    language: '',
    mediums: [],
    artists: ch.artists ?? [],
    popularity: ch.popularity ?? 50,
  }
}

export function editorValuesToChannel(
  existing: Channel,
  values: ChannelEditorValues
): Channel {
  return {
    ...existing,
    name: values.name.trim(),
    isAutoNamed: false,
    notes: values.freeText.trim(),
    genres: values.genres,
    timePeriods: values.timePeriods,
    regions: values.regions,
    artists: values.artists,
    popularity: values.popularity,
  }
}

export function emptySoundingsEditorValues(): ChannelEditorValues {
  return {
    name: '',
    freeText: '',
    genres: [],
    timePeriods: [],
    regions: [],
    language: '',
    mediums: [],
    artists: [],
    popularity: 50,
  }
}

export const NEW_CHANNEL_PREFILL_KEY = 'earprint-new-channel-prefill'

/** Hydrate the new-channel form from sessionStorage (Constellations graph, etc.). */
export function prefillToEditorValues(partial: unknown): ChannelEditorValues {
  if (!partial || typeof partial !== 'object') return emptySoundingsEditorValues()
  const p = partial as Record<string, unknown>
  const freeText =
    typeof p.freeText === 'string'
      ? p.freeText
      : typeof p.notes === 'string'
        ? p.notes
        : ''
  return {
    ...emptySoundingsEditorValues(),
    name: typeof p.name === 'string' ? p.name : '',
    freeText,
    genres: Array.isArray(p.genres) ? p.genres.filter((g): g is string => typeof g === 'string') : [],
    timePeriods: Array.isArray(p.timePeriods)
      ? p.timePeriods.filter((g): g is string => typeof g === 'string')
      : [],
    regions: Array.isArray(p.regions) ? p.regions.filter((g): g is string => typeof g === 'string') : [],
    artists: Array.isArray(p.artists)
      ? p.artists.filter((a): a is string => typeof a === 'string')
      : [],
    popularity:
      typeof p.popularity === 'number' && !Number.isNaN(p.popularity) ? p.popularity : 50,
  }
}
