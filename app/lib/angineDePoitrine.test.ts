import { describe, expect, it } from 'vitest'
import { buildUserPrompt } from '@/app/lib/llm'
import { extractArtistHintsFromChannel, channelNameAsArtistHint, findArtistMatchingChannelName, mergeChannelNameArtistMatch } from '@/app/lib/artistHintsFromNotes'
import {
  ANGINE_DE_POITRINE,
  buildCombinedNotes,
  djGenrePrefixes,
  enrichSearchWithFocusArtist,
  resolveDjArtistConstraint,
} from '@/app/lib/djArtistFocus'
import { spotifySearchQueriesForSong, trackMatchesFocusArtist } from '@/app/lib/spotifyArtistSearch'
import { buildYouTubeSearchAlternates } from '@/app/lib/youtube'

describe('Angine de poitrine (artist-focus channel)', () => {
  const selected = [ANGINE_DE_POITRINE]

  it('resolves artist constraint from a single channel artist', () => {
    expect(resolveDjArtistConstraint({ selectedArtists: selected })).toBe(ANGINE_DE_POITRINE)
    expect(resolveDjArtistConstraint({ explicit: '  ', selectedArtists: selected })).toBe(
      ANGINE_DE_POITRINE
    )
    expect(resolveDjArtistConstraint({ explicit: 'Other Act', selectedArtists: selected })).toBe(
      'Other Act'
    )
  })

  it('findArtistMatchingChannelName links channel title to artist chips', () => {
    const candidates = ['Angine de poitrine', 'Trisomie 21', 'The Cure']
    expect(findArtistMatchingChannelName(ANGINE_DE_POITRINE, candidates)).toBe(ANGINE_DE_POITRINE)
    expect(findArtistMatchingChannelName('angine de poitrine', candidates)).toBe(ANGINE_DE_POITRINE)
    expect(findArtistMatchingChannelName('Chamber Music', candidates)).toBeUndefined()
    expect(findArtistMatchingChannelName('Chamber Music', ['Chamber Music', 'Shostakovich'])).toBeUndefined()
  })

  it('mergeChannelNameArtistMatch adds matched artist to config', () => {
    expect(
      mergeChannelNameArtistMatch(ANGINE_DE_POITRINE, [], ['Angine de poitrine', 'Trisomie 21'])
    ).toEqual([ANGINE_DE_POITRINE])
    expect(
      mergeChannelNameArtistMatch('Late-night jazz', [], ['Miles Davis'])
    ).toEqual([])
  })

  it('channelNameAsArtistHint accepts act names, rejects genre-style titles', () => {
    expect(channelNameAsArtistHint(ANGINE_DE_POITRINE)).toBe(ANGINE_DE_POITRINE)
    expect(channelNameAsArtistHint('Chamber Music')).toBeUndefined()
    expect(channelNameAsArtistHint('New Channel')).toBeUndefined()
  })

  it('extractArtistHintsFromChannel reads artist from channel title when it is an act name', () => {
    expect(
      extractArtistHintsFromChannel({
        name: ANGINE_DE_POITRINE,
        notes: 'French coldwave — only Angine de poitrine',
      })
    ).toContain(ANGINE_DE_POITRINE)
    expect(
      extractArtistHintsFromChannel({
        name: ANGINE_DE_POITRINE,
        notes: '',
      })
    ).toContain(ANGINE_DE_POITRINE)
    expect(
      extractArtistHintsFromChannel({
        name: 'Chamber Music',
        notes: '',
      })
    ).not.toContain('Chamber Music')
    expect(
      extractArtistHintsFromChannel({
        name: 'New Channel',
        notes: `Focus on "${ANGINE_DE_POITRINE}" and similar acts`,
      })
    ).toContain(ANGINE_DE_POITRINE)
  })

  it('does not infer artist constraint from channel title', () => {
    expect(
      resolveDjArtistConstraint({
        selectedArtists: [],
      })
    ).toBeUndefined()
    expect(
      resolveDjArtistConstraint({
        selectedArtists: [],
        artistText: ANGINE_DE_POITRINE,
      })
    ).toBe(ANGINE_DE_POITRINE)
  })

  it('does not set focus constraint when multiple artists are selected', () => {
    expect(
      resolveDjArtistConstraint({
        selectedArtists: [ANGINE_DE_POITRINE, 'Trisomie 21'],
      })
    ).toBeUndefined()
  })

  it('buildCombinedNotes requires every batch song by the act', () => {
    const notes = buildCombinedNotes([], '', '', '', 50, [], selected, '', ANGINE_DE_POITRINE)
    expect(notes).toContain('FOCUS:')
    expect(notes).toContain(ANGINE_DE_POITRINE)
    expect(notes).toContain('Multiple tracks by this same act')
    expect(notes).not.toContain('different artists per batch')
  })

  it('buildUserPrompt suspends the 3-different-artists rule for focus mode', () => {
    const prompt = buildUserPrompt([], undefined, ANGINE_DE_POITRINE, undefined, undefined, 50, 3)
    expect(prompt).toContain(`FOCUS ARTIST/BAND: "${ANGINE_DE_POITRINE}"`)
    expect(prompt).toContain('Suspend the 3-different-artists rule')
    expect(prompt).toContain('Do not substitute other artists')
  })

  it('first turn uses artist-focus wording, not maximally distant', () => {
    const prompt = buildUserPrompt([], undefined, ANGINE_DE_POITRINE, undefined, undefined, 50, 3)
    expect(prompt).toContain('FIRST TURN — artist-focus')
    expect(prompt).not.toContain('maximally distant parts of the space')
  })

  it('djGenrePrefixes merges chips and free text', () => {
    expect(djGenrePrefixes(['Cool Jazz'], 'bebop, hard bop')).toEqual(
      expect.arrayContaining(['Cool Jazz', 'bebop', 'hard bop'])
    )
  })

  it('enrichSearchWithFocusArtist strips genre prefix and parentheticals', () => {
    expect(enrichSearchWithFocusArtist('Cool Jazz - Le Baiser', undefined, ['Cool Jazz'])).toBe(
      'Le Baiser'
    )
    expect(
      enrichSearchWithFocusArtist('Cool Jazz - Le Baiser (live)', undefined, ['Cool Jazz'])
    ).toBe('Le Baiser')
  })

  it('spotifySearchQueriesForSong includes artist fielded search', () => {
    const queries = spotifySearchQueriesForSong('Le Baiser', { focusArtist: ANGINE_DE_POITRINE })
    expect(queries).toContain(`artist:"${ANGINE_DE_POITRINE}" Le Baiser`)
    expect(queries.some(q => q.includes('Angine'))).toBe(true)
  })

  it('spotifySearchQueriesForSong strips genre labels from LLM search rows', () => {
    const queries = spotifySearchQueriesForSong(
      'Cool Jazz - Concierto de Aranjuez (Adagio) Miles Davis',
      { genrePrefixes: ['Cool Jazz'], focusArtist: 'Miles Davis' }
    )
    expect(queries.some(q => !/^cool jazz/i.test(q))).toBe(true)
    expect(queries.some(q => q.includes('Miles Davis'))).toBe(true)
  })

  it('trackMatchesFocusArtist accepts the act name on credits', () => {
    expect(
      trackMatchesFocusArtist(
        { id: '1', uri: 'spotify:track:1', name: 'Le Baiser', artist: 'Angine de poitrine', album: '', albumArt: null, durationMs: 0, source: 'spotify' },
        ANGINE_DE_POITRINE
      )
    ).toBe(true)
    expect(
      trackMatchesFocusArtist(
        { id: '1', uri: 'spotify:track:1', name: 'X', artist: 'Common', album: '', albumArt: null, durationMs: 0, source: 'spotify' },
        ANGINE_DE_POITRINE
      )
    ).toBe(false)
  })

  it('buildYouTubeSearchAlternates adds artist-qualified queries', () => {
    const alts = buildYouTubeSearchAlternates('Le Baiser', {
      artistConstraint: ANGINE_DE_POITRINE,
    })
    expect(alts).toContain(`${ANGINE_DE_POITRINE} - Le Baiser`)
    expect(alts).toContain(`${ANGINE_DE_POITRINE} Le Baiser`)
  })
})
