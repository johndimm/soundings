/**
 * Shown on first launch (no existing channels + no legacy history).
 * Gives new users a ready-to-play channel with a profile and queue.
 */
export const DEMO_CHANNEL_IMPORT = {
  earprintExportVersion: 1,
  activeChannelId: 'mnmbqzfz0u4a',
  channels: [
    {
      id: 'mnmbqzfz0u4a',
      name: 'Spotify Demo',
      isAutoNamed: false,
      cardHistory: [],
      sessionHistory: [],
      profile:
        "We're starting fresh across US & Canada—probing acoustic sincerity, rhythmic drive, and improvisational depth. Your first reactions will tell us whether you lean toward lyrical folk warmth, post-punk tension, or jazz's cool complexity.",
      currentCard: {
        track: {
          id: '3ZPLFD6mbw6hhu3g6S4EGl',
          uri: 'spotify:track:3ZPLFD6mbw6hhu3g6S4EGl',
          name: 'Cortez the Killer - 2016 Remaster',
          artist: 'Neil Young',
          album: 'Zuma',
          albumArt: 'https://i.scdn.co/image/ab67616d0000b273adc7646ec2dc90fc12477818',
          durationMs: 449959,
          releaseYear: 1975,
          source: 'spotify',
        },
        reason:
          'Slot 3: WILD CARD — Epic, sprawling guitar rock with a raw, live feel and psychedelic edges from a Canadian-American icon, bridging folk storytelling with electric intensity.',
        category: 'Rock > Folk Rock / Psychedelic',
        coords: { x: 40, y: 60, z: 70 },
      },
      queue: [
        {
          track: {
            id: '1B0rBJadcJeZDyjI7GUwMN',
            uri: 'spotify:track:1B0rBJadcJeZDyjI7GUwMN',
            name: 'Tom Sawyer',
            artist: 'Rush',
            album: 'Moving Pictures (40th Anniversary Super Deluxe)',
            albumArt: 'https://i.scdn.co/image/ab67616d0000b273a8427d1d048d86f11d57fff4',
            durationMs: 278426,
            releaseYear: 2022,
            source: 'spotify',
          },
          reason:
            'Slot 4: Complex, intense progressive rock with synthesizers—bridges rock and electronic, cult following but widely known. High energy and intricate arrangement.',
          category: 'Rock > Progressive Rock',
          coords: { x: 55, y: 80, z: 70 },
        },
        {
          track: {
            id: '1pKYYY0dkg23sQQXi0Q5zN',
            uri: 'spotify:track:1pKYYY0dkg23sQQXi0Q5zN',
            name: 'Around the World',
            artist: 'Daft Punk',
            album: 'Homework',
            albumArt: 'https://i.scdn.co/image/ab67616d0000b2738ac778cc7d88779f74d33311',
            durationMs: 429533,
            releaseYear: 1997,
            source: 'spotify',
          },
          reason:
            'Slot 5: Fully electronic, repetitive, and driving dance music—high energy, synthesized, and mainstream in electronic circles. Maximally distant from acoustic folk.',
          category: 'Electronic > French House',
          coords: { x: 95, y: 75, z: 80 },
        },
        {
          track: {
            id: '2VjV3PRfThNjqmQg2Y8g4j',
            uri: 'spotify:track:2VjV3PRfThNjqmQg2Y8g4j',
            name: 'Ashokan Farewell',
            artist: 'Jay Ungar',
            album: 'The Civil War (Original Soundtrack Recording)',
            albumArt: 'https://i.scdn.co/image/ab67616d0000b273e5938409e3e19e4828671add',
            durationMs: 244693,
            releaseYear: 2005,
            source: 'spotify',
          },
          reason:
            'Slot 6: Pure acoustic folk instrumental, calm and deeply traditional—minimal, live, and cult-following. Represents a quiet, introspective corner of North American music.',
          category: 'Folk > American Folk',
          coords: { x: 5, y: 15, z: 40 },
        },
      ],
      createdAt: Date.now(),
      source: 'spotify',
      genres: [],
      genreText: '',
      timePeriod: '',
      notes: '',
      regions: ['US & Canada'],
      artists: [],
      artistText: '',
      popularity: 50,
      discovery: 50,
    },
  ],
}
