import { describe, expect, it } from 'vitest'
import { buildUserPrompt } from '@/app/lib/llm'
import {
  extractArtistHintsFromChannel,
  channelNameAsArtistHint,
  findArtistMatchingChannelName,
  mergeChannelNameArtistMatch,
} from '@/app/lib/artistHintsFromNotes'
import { buildCombinedNotes } from '@/app/lib/djArtistFocus'
import { spotifySearchQueriesForSong } from '@/app/lib/spotifyArtistSearch'
import { buildYouTubeSearchAlternates, parseSearchHintForYouTube, youtubeTrackFromVideoId } from '@/app/lib/youtube'

/** Example act name used as a fixture — not special-cased in production code. */
const ANGINE_DE_POITRINE = 'Angine de poitrine'

describe('Artist hints and DJ notes (no app-side genre vs act classification)', () => {
  const selected = [ANGINE_DE_POITRINE]

  it('findArtistMatchingChannelName links channel title to artist chips', () => {
    const candidates = ['Angine de poitrine', 'Trisomie 21', 'The Cure']
    expect(findArtistMatchingChannelName(ANGINE_DE_POITRINE, candidates)).toBe(ANGINE_DE_POITRINE)
    expect(findArtistMatchingChannelName('angine de poitrine', candidates)).toBe(ANGINE_DE_POITRINE)
    expect(findArtistMatchingChannelName('Chamber Music', candidates)).toBe('Chamber Music')
  })

  it('mergeChannelNameArtistMatch adds matched artist to config', () => {
    expect(
      mergeChannelNameArtistMatch(ANGINE_DE_POITRINE, [], ['Angine de poitrine', 'Trisomie 21'])
    ).toEqual([ANGINE_DE_POITRINE])
    expect(
      mergeChannelNameArtistMatch('Deep House', [], ['Kaskade'])
    ).toEqual([])
  })

  it('channelNameAsArtistHint accepts any non-generic channel title', () => {
    expect(channelNameAsArtistHint(ANGINE_DE_POITRINE)).toBe(ANGINE_DE_POITRINE)
    expect(channelNameAsArtistHint('Chamber Music')).toBe('Chamber Music')
    expect(channelNameAsArtistHint('Deep House')).toBe('Deep House')
    expect(channelNameAsArtistHint('New Channel')).toBeUndefined()
  })

  it('extractArtistHintsFromChannel reads hints from channel title and notes', () => {
    expect(
      extractArtistHintsFromChannel({
        name: ANGINE_DE_POITRINE,
        notes: 'French coldwave — only Angine de poitrine',
      })
    ).toContain(ANGINE_DE_POITRINE)
    expect(
      extractArtistHintsFromChannel({
        name: 'Deep House',
        notes: '',
      })
    ).toContain('Deep House')
    expect(
      extractArtistHintsFromChannel({
        name: 'New Channel',
        notes: `Focus on "${ANGINE_DE_POITRINE}" and similar acts`,
      })
    ).toContain(ANGINE_DE_POITRINE)
  })

  it('buildCombinedNotes lists artists as soft hints, not hard constraints', () => {
    const notes = buildCombinedNotes([], '', '', '', 50, [], selected, '')
    expect(notes).toContain('Artists to lean toward')
    expect(notes).toContain(ANGINE_DE_POITRINE)
    expect(notes).not.toContain('FOCUS:')
    expect(notes).not.toContain('must be by')
  })

  it('buildUserPrompt does not inject artist-focus blocks', () => {
    const prompt = buildUserPrompt([], undefined, `Artists to lean toward: ${ANGINE_DE_POITRINE}`, undefined, 50, 3)
    expect(prompt).not.toContain('FOCUS ARTIST/BAND')
    expect(prompt).not.toContain('Suspend the 3-different-artists rule')
  })

  it('spotifySearchQueriesForSong uses the LLM search string as-is', () => {
    const queries = spotifySearchQueriesForSong('Le Baiser — Angine de poitrine')
    expect(queries[0]).toBe('Le Baiser — Angine de poitrine')
    expect(queries.some(q => q.includes('Angine'))).toBe(true)
  })

  it('buildYouTubeSearchAlternates adds artist-qualified queries when chips are set', () => {
    const alts = buildYouTubeSearchAlternates('Le Baiser', {
      preferredArtists: [ANGINE_DE_POITRINE],
    })
    expect(alts).toContain(`${ANGINE_DE_POITRINE} - Le Baiser`)
    expect(alts).toContain(`${ANGINE_DE_POITRINE} Le Baiser`)
  })

  it('parseSearchHintForYouTube uses LLM search text for id-only resolve metadata', () => {
    expect(parseSearchHintForYouTube('Nightmares on Wax - You Wish')).toEqual({
      artist: 'Nightmares on Wax',
      name: 'You Wish',
    })
    expect(parseSearchHintForYouTube('Music Sounds Better With You Stardust')).toEqual({
      name: 'Music Sounds Better With You',
      artist: 'Stardust',
    })
    const track = youtubeTrackFromVideoId('TwDOa-lvizM', 'Nightmares on Wax - You Wish')
    expect(track?.name).toBe('You Wish')
    expect(track?.artist).toBe('Nightmares on Wax')
  })
})
