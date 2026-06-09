#!/usr/bin/env npx tsx
/**
 * Taste discovery test for Soundings — measures how well the DJ learns a hidden
 * preference through exploration, then compares against giving the answer as channel notes.
 *
 * Each profile runs two phases:
 *   1. All channel — empty notes, mode 100, 20Q category tree (discovery)
 *   2. Channel hint — preference as channel notes, mode 50 (answer given)
 *
 * Oracle scores each song by hierarchical tree paths — NOT keyword search in titles.
 *
 * Usage:
 *   npx tsx scripts/taste-test.ts <preference> [base-url|provider] [max-rounds]
 *   npx tsx scripts/taste-test-all.ts [base-url|provider] [max-rounds] [count]
 *   ./scripts/taste-test-all.sh [base-url] [max-rounds] [count]
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { buildCombinedNotes } from '../app/lib/djArtistFocus'
import {
  buildChannelTreeTaggingSection,
  buildMusicTreeExplorationSection,
  generateCategoryTree,
  resolveTreeForPreference,
  tasteTestStarScore,
  superKey,
  type CategoryPath,
  type CategoryTree,
} from '../app/lib/categoryTree'
import {
  getNextSongQuery,
  type ExploreMode,
  type ListenEvent,
  type LLMProvider,
  type SongSuggestion,
} from '../app/lib/llm'
import { parseTasteTestArgs } from './taste-test-args'

export type TasteTestChannelMode = 'all' | 'channel'

export type TasteTestPhaseResult = {
  mode: TasteTestChannelMode
  label: string
  converged: boolean
  roundsRun: number
  totalRated: number
  convergeRound: number | null
  stats: Array<{ round: number; avgRating: number; maxRating: number; minRating: number; total: number }>
}

export type TasteTestDualResult = {
  preference: string
  targetPaths: CategoryPath[]
  all: TasteTestPhaseResult
  channel: TasteTestPhaseResult
}

const NUM_SONGS = 3
const ALL_CHANNEL_MODE: ExploreMode = 100
/** Bounded channel — stay in the lane, don't adventure away from constraints */
const CHANNEL_MODE: ExploreMode = 0

function extractDecadeHint(preference: string): string {
  const m = preference.match(/\b(19\d0s|20\d0s)\b/i)
  return m ? m[0]! : ''
}

function buildChannelNotesFromPreference(preference: string): string {
  const decade = extractDecadeHint(preference)
  return buildCombinedNotes(
    [],
    preference,
    decade,
    `Channel focus: every song must clearly fit "${preference}".`,
    60,
    [],
    [],
    '',
  )
}

async function resolveSessionTree(
  preference: string,
  provider: LLMProvider,
  baseUrl?: string,
): Promise<{ tree: CategoryTree; targetPaths: CategoryPath[] }> {
  if (baseUrl) {
    const res = await fetch(`${baseUrl}/api/category-tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, preference }),
    })
    if (!res.ok) throw new Error(`category-tree HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { tree?: CategoryTree; targetPaths?: CategoryPath[] }
    if (!data.tree) throw new Error('category-tree returned no tree')
    return { tree: data.tree, targetPaths: data.targetPaths ?? [] }
  }
  const base = await generateCategoryTree(provider, { anchorPreference: preference })
  return resolveTreeForPreference(base, preference, provider)
}

async function fetchSongBatch(opts: {
  baseUrl?: string
  provider: LLMProvider
  sessionHistory: ListenEvent[]
  priorProfile?: string
  alreadyHeard: string[]
  notes?: string
  exploreMode: ExploreMode
  categoryTree: CategoryTree | null
  treeSection?: string
}): Promise<{ songs: SongSuggestion[]; profile?: string; categoryTree?: CategoryTree }> {
  const {
    baseUrl,
    provider,
    sessionHistory,
    priorProfile,
    alreadyHeard,
    notes,
    exploreMode,
    categoryTree,
  } = opts

  if (baseUrl) {
    const res = await fetch(`${baseUrl}/api/next-song`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionHistory,
        priorProfile,
        notes,
        mode: exploreMode,
        numSongs: NUM_SONGS,
        profileOnly: true,
        source: 'youtube',
        tasteTest: true,
        provider,
        alreadyHeard,
        categoryTree: categoryTree ?? undefined,
      }),
    })
    if (!res.ok) throw new Error(`next-song HTTP ${res.status}: ${await res.text()}`)
    return (await res.json()) as { songs: SongSuggestion[]; profile?: string; categoryTree?: CategoryTree }
  }

  const result = await getNextSongQuery(
    sessionHistory,
    provider,
    notes,
    priorProfile,
    alreadyHeard,
    exploreMode,
    NUM_SONGS,
    opts.treeSection,
  )
  return result
}

function scoreSongs(
  songs: SongSuggestion[],
  preference: string,
  targetPaths: CategoryPath[],
  channelHint: boolean,
): Array<{ search: string; stars: number; reason: string }> {
  return songs.map((s) => {
    const { stars, reason } = tasteTestStarScore(preference, targetPaths, s, { channelHint })
    return { search: s.search, stars, reason }
  })
}

async function runPhase(opts: {
  preference: string
  provider: LLMProvider
  baseUrl?: string
  maxRounds: number
  mode: TasteTestChannelMode
  categoryTree: CategoryTree | null
  targetPaths: CategoryPath[]
}): Promise<TasteTestPhaseResult> {
  const { preference, provider, baseUrl, maxRounds, mode, categoryTree, targetPaths } = opts
  const isAll = mode === 'all'
  const label = isAll ? 'All channel (discovery)' : `Channel hint ("${preference}")`
  const notes = isAll ? undefined : buildChannelNotesFromPreference(preference)
  const exploreMode: ExploreMode = isAll ? ALL_CHANNEL_MODE : CHANNEL_MODE

  console.log(`\n${'─'.repeat(72)}`)
  console.log(`Phase: ${label}`)
  console.log(`  notes: ${notes ? notes.slice(0, 80) + (notes.length > 80 ? '…' : '') : '(empty — 20Q tree)'}`)
  console.log(`  mode: ${exploreMode}   batch: ${NUM_SONGS} songs/round`)
  console.log('─'.repeat(72))

  const sessionHistory: ListenEvent[] = []
  const alreadyHeard: string[] = []
  let priorProfile: string | undefined
  let activeTree = categoryTree

  type RoundStat = { round: number; avgRating: number; maxRating: number; minRating: number; total: number }
  const stats: RoundStat[] = []
  let converged = false
  let roundsRun = 0
  let convergeRound: number | null = null

  for (let round = 1; round <= maxRounds; round++) {
    roundsRun = round
    console.log(`\n  Round ${round}  (${sessionHistory.length} rated) ${'·'.repeat(24)}`)

    const triedSuperKeys = [
      ...new Set(sessionHistory.flatMap((e) => (e.categoryPaths ?? []).map(superKey))),
    ]
    const treeSection =
      !baseUrl && activeTree
        ? isAll
          ? buildMusicTreeExplorationSection(activeTree, sessionHistory, NUM_SONGS, triedSuperKeys)
          : buildChannelTreeTaggingSection(activeTree)
        : undefined

    let result: { songs: SongSuggestion[]; profile?: string; categoryTree?: CategoryTree }
    try {
      result = await fetchSongBatch({
        baseUrl,
        provider,
        sessionHistory,
        priorProfile,
        alreadyHeard,
        notes,
        exploreMode,
        categoryTree: activeTree,
        treeSection,
      })
    } catch (e) {
      console.error('    ✗ Fetch failed:', e)
      break
    }

    if (result.categoryTree) activeTree = result.categoryTree

    if (result.profile) priorProfile = result.profile

    const novel = result.songs.filter((s) => !alreadyHeard.includes(s.search))
    for (const s of result.songs) {
      if (!alreadyHeard.includes(s.search)) alreadyHeard.push(s.search)
    }

    if (!novel.length) {
      console.error('    ✗ No novel songs')
      break
    }

    const scored = scoreSongs(novel, preference, targetPaths, !isAll)
    let totalRating = 0
    let maxRating = 0
    let minRating = 5

    for (const s of scored) {
      totalRating += s.stars
      maxRating = Math.max(maxRating, s.stars)
      minRating = Math.min(minRating, s.stars)

      const song = novel.find((x) => x.search === s.search)
      const starStr = '★'.repeat(Math.round(s.stars)) + '☆'.repeat(5 - Math.round(s.stars))
      const pathStr = song?.categoryPaths?.length
        ? ` {${song.categoryPaths.map((p) => `${p.dimension}/${p.super}${p.leaf ? `/${p.leaf}` : ''}`).join(', ')}}`
        : ''
      const catStr = song?.category ? ` [${song.category}]` : ' [no category]'
      console.log(`    ${starStr}  ${s.search}${catStr}${pathStr}`)
      console.log(`             ${s.reason}`)

      sessionHistory.push({
        track: s.search,
        artist: '',
        stars: s.stars,
        categoryPaths: song?.categoryPaths,
        coords: song?.coords,
      })
    }

    const avgRating = novel.length > 0 ? totalRating / novel.length : 0
    console.log(`\n    Avg: ${avgRating.toFixed(1)}★  Range: ${minRating}-${maxRating}★`)
    if (priorProfile) console.log(`    Profile: "${priorProfile.slice(0, 120)}${priorProfile.length > 120 ? '…' : ''}"`)

    stats.push({ round, avgRating, maxRating, minRating, total: novel.length })

    if (avgRating >= 4.0 && novel.length > 0) {
      converged = true
      convergeRound = round
      console.log(`\n    ✓ CONVERGED — round ${round}, avg ${avgRating.toFixed(1)}★`)
      break
    }
    if (round === maxRounds) console.log(`\n    ✗ Did not converge within ${maxRounds} rounds`)
  }

  printPhaseSummary(label, stats, converged, convergeRound, sessionHistory.length, maxRounds)

  return {
    mode,
    label,
    converged,
    roundsRun,
    totalRated: sessionHistory.length,
    convergeRound,
    stats,
  }
}

function printPhaseSummary(
  label: string,
  stats: TasteTestPhaseResult['stats'],
  converged: boolean,
  convergeRound: number | null,
  totalRated: number,
  maxRounds: number,
) {
  console.log(`\n  ${label} — ${totalRated} ratings`)
  console.log('  Rnd  Avg★  Range         Progress')
  for (const d of stats) {
    const bar = '▓'.repeat(Math.round(d.avgRating)) + '░'.repeat(5 - Math.round(d.avgRating))
    console.log(`   ${String(d.round).padStart(2)}  ${d.avgRating.toFixed(1)}  [${d.minRating}-${d.maxRating}]  ${bar}`)
  }
  console.log(
    converged
      ? `  → Converged: round ${convergeRound} (${totalRated} ratings)`
      : `  → Did not converge within ${maxRounds} rounds`,
  )
}

export async function runTasteTestDual(opts: {
  preference: string
  provider?: LLMProvider
  baseUrl?: string
  maxRounds?: number
}): Promise<TasteTestDualResult> {
  const preference = opts.preference.trim()
  const provider = opts.provider ?? 'deepseek'
  const baseUrl = opts.baseUrl
  const maxRounds = opts.maxRounds ?? 20

  console.log(`\n${'='.repeat(72)}`)
  console.log(`Soundings taste test — "${preference}"`)
  console.log(`Oracle: hierarchical tree (exact leaf = 5★, compound paths averaged)`)
  console.log(
    `Backend: ${baseUrl ?? 'direct LLM'}   Provider: ${provider}   Max rounds/phase: ${maxRounds}`,
  )
  console.log(`Success: batch averages ≥4★`)
  console.log('='.repeat(72))

  const { tree, targetPaths } = await resolveSessionTree(preference, provider, baseUrl)
  console.log(`Category tree: ${tree.dimensions.length} dimensions`)
  if (targetPaths.length) {
    console.log(
      `Target paths: ${targetPaths.map((p) => `${p.dimension}/${p.super}${p.leaf ? `/${p.leaf}` : ''}`).join(', ')}`,
    )
  }

  const all = await runPhase({
    preference,
    provider,
    baseUrl,
    maxRounds,
    mode: 'all',
    categoryTree: tree,
    targetPaths,
  })

  const channel = await runPhase({
    preference,
    provider,
    baseUrl,
    maxRounds,
    mode: 'channel',
    categoryTree: tree,
    targetPaths,
  })

  console.log(`\n${'='.repeat(72)}`)
  console.log('COMPARISON')
  console.log('='.repeat(72))
  const allTime = all.converged ? `round ${all.convergeRound} (${all.totalRated} ratings)` : `no convergence in ${maxRounds} rounds`
  const chTime = channel.converged
    ? `round ${channel.convergeRound} (${channel.totalRated} ratings)`
    : `no convergence in ${maxRounds} rounds`
  console.log(`  All channel (discovery):  ${all.converged ? '✓' : '✗'}  ${allTime}`)
  console.log(`  Channel hint (answer):    ${channel.converged ? '✓' : '✗'}  ${chTime}`)
  if (all.converged && channel.converged && all.convergeRound != null && channel.convergeRound != null) {
    const delta = all.convergeRound - channel.convergeRound
    console.log(
      delta > 0
        ? `  Channel hint converged ${delta} round(s) faster`
        : delta < 0
          ? `  All channel converged ${-delta} round(s) faster (unexpected)`
          : '  Both converged in the same round',
    )
  }

  return { preference, targetPaths, all, channel }
}

const isMain = process.argv[1]?.includes('taste-test.ts')
if (isMain) {
  const { preference, baseUrl, provider, maxRounds } = parseTasteTestArgs(process.argv)

  if (!preference) {
    console.error('Usage: npx tsx scripts/taste-test.ts <preference> [base-url|provider] [max-rounds]')
    console.error('       npx tsx scripts/taste-test-all.ts [base-url|provider] [max-rounds] [count]')
    console.error('       ./scripts/taste-test-all.sh [base-url] [max-rounds] [count]')
    process.exit(1)
  }

  runTasteTestDual({ preference, baseUrl, provider, maxRounds }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
