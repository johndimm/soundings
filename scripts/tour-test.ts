#!/usr/bin/env npx tsx
/**
 * Simulates a listener who dislikes every song.
 * Reports the 20 tracks the DJ selects — should tour the world of music.
 *
 * Usage:
 *   npx tsx scripts/tour-test.ts [provider]
 *   npx tsx scripts/tour-test.ts deepseek
 *   npx tsx scripts/tour-test.ts anthropic
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { getNextSongQuery, type ListenEvent, type LLMProvider, type ExploreMode } from '../app/lib/llm'

const ROUNDS = 20
const PROVIDER = (process.argv[2] as LLMProvider) ?? 'deepseek'

async function run() {
  console.log(`\n🎵 Tour test — provider: ${PROVIDER}, rounds: ${ROUNDS}`)
  console.log('Each song is given a low rating (5% listened)\n')

  const sessionHistory: ListenEvent[] = []
  let priorProfile: string | undefined
  const played: string[] = []
  let mode: ExploreMode = 50

  for (let round = 1; round <= ROUNDS; round++) {
    process.stdout.write(`Round ${round}/${ROUNDS} [${mode}]... `)

    let result
    try {
      result = await getNextSongQuery(
        sessionHistory,
        PROVIDER,
        undefined,
        undefined,
        priorProfile,
        played.map(raw => JSON.parse(raw).search),
        mode
      )
    } catch (err) {
      console.error(`\nFailed on round ${round}:`, err)
      break
    }

    const { songs, profile } = result
    if (profile) priorProfile = profile
    mode = mode < 50 ? 75 : 25
    if (!songs.length) { console.log('no songs returned, stopping.'); break }

    const picked = songs[0]
    played.push(JSON.stringify({ search: picked.search, category: picked.category, spotifyId: picked.spotifyId }))

    // Record as a hard skip
    sessionHistory.push({
      track: picked.search,
      artist: '',
      stars: null,
    })

    console.log(`✗  ${picked.search}  [${picked.category ?? 'uncategorized'}]`)
    console.log(`   ${picked.reason}`)
  }

  console.log('\n══════════════════════════════════════════════')
  console.log('TOUR — 20 songs, all disliked')
  console.log('══════════════════════════════════════════════')
  // Build category tree
  const tree = new Map<string, string[]>()
  played.forEach((raw, i) => {
    const { search, category, spotifyId } = JSON.parse(raw)
    const link = spotifyId ? `https://open.spotify.com/track/${spotifyId}` : ''
    const cat = category ?? 'Uncategorized'
    const [broad] = cat.split('>').map((s: string) => s.trim())
    if (!tree.has(broad)) tree.set(broad, [])
    tree.get(broad)!.push(cat)
    console.log(`${String(i + 1).padStart(2)}. [${cat}] ${search}`)
    if (link) console.log(`    ${link}`)
  })

  console.log('\n══════════════════════════════════════════════')
  console.log('CATEGORY TREE')
  console.log('══════════════════════════════════════════════')
  for (const [broad, subs] of [...tree.entries()].sort()) {
    console.log(`${broad} (${subs.length})`)
    const subCounts = new Map<string, number>()
    for (const s of subs) { subCounts.set(s, (subCounts.get(s) ?? 0) + 1) }
    for (const [sub, count] of [...subCounts.entries()].sort()) {
      if (sub !== broad) console.log(`  └ ${sub}${count > 1 ? ` ×${count}` : ''}`)
    }
  }

  if (priorProfile) {
    console.log('\n──────────────────────────────────────────────')
    console.log('FINAL PROFILE:\n' + priorProfile)
  }
}

run().catch(err => { console.error(err); process.exit(1) })
