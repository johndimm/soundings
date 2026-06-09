#!/usr/bin/env npx tsx
/**
 * Run dual-mode taste tests for a batch of music preferences.
 *
 * Each profile: All channel (discovery) then Channel hint (answer given).
 *
 * Usage:
 *   npx tsx scripts/taste-test-all.ts [base-url|provider] [max-rounds] [count]
 *   ./scripts/taste-test-all.sh [base-url] [max-rounds] [count]
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import type { LLMProvider } from '../app/lib/llm'
import { callLLMRaw } from '../app/lib/llmChat'
import { parseTasteTestAllArgs } from './taste-test-args'
import { runTasteTestDual } from './taste-test'

const { baseUrl, provider, maxRounds: MAX_ROUNDS, count: COUNT } = parseTasteTestAllArgs(process.argv)
const PROVIDER = provider

function stripMarkdownJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

async function fetchTestCategories(): Promise<string[]> {
  if (baseUrl) {
    const res = await fetch(`${baseUrl}/api/taste-test-categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: COUNT, provider: PROVIDER }),
    })
    if (!res.ok) throw new Error(`taste-test-categories HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { categories?: string[] }
    const categories = data.categories ?? []
    if (!categories.length) throw new Error('taste-test-categories returned empty list')
    return categories
  }

  const systemPrompt = `You propose taste profiles for testing a music recommendation discovery system.

Each profile is a short phrase (roughly 2–6 words) describing one coherent listening preference.

Profiles should be diverse across regions, eras, genres, moods, and traditions. No two should overlap heavily.`

  const userMessage = `Suggest exactly ${COUNT} distinct music taste profiles.

Reply ONLY with JSON:
{"categories":["profile one","profile two",...]}`

  const text = await callLLMRaw(PROVIDER, systemPrompt, userMessage, 400)
  const cleaned = stripMarkdownJsonFence(text)
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('taste-test-categories: no JSON in response')
  const parsed = JSON.parse(match[0]) as { categories?: unknown }
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, COUNT)
    : []
  if (!categories.length) throw new Error('taste-test-categories: empty list')
  return categories
}

async function main() {
  console.log(
    `Soundings taste tests — backend: ${baseUrl ?? 'direct LLM'}, provider: ${PROVIDER}, max ${MAX_ROUNDS} rounds/phase`,
  )
  console.log(`Fetching ${COUNT} test profiles…\n`)

  const categories = await fetchTestCategories()
  console.log('Profiles:')
  for (const c of categories) console.log(`  · ${c}`)
  console.log('')

  type Summary = {
    preference: string
    allConverged: boolean
    allRound: number | null
    allRatings: number
    channelConverged: boolean
    channelRound: number | null
    channelRatings: number
  }

  const summaries: Summary[] = []

  for (let i = 0; i < categories.length; i++) {
    const preference = categories[i]!
    console.log(`\n${'#'.repeat(72)}`)
    console.log(`Test ${i + 1}/${categories.length}: "${preference}"`)
    console.log('#'.repeat(72))

    const result = await runTasteTestDual({
      preference,
      provider: PROVIDER,
      baseUrl,
      maxRounds: MAX_ROUNDS,
    })
    summaries.push({
      preference,
      allConverged: result.all.converged,
      allRound: result.all.convergeRound,
      allRatings: result.all.totalRated,
      channelConverged: result.channel.converged,
      channelRound: result.channel.convergeRound,
      channelRatings: result.channel.totalRated,
    })
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log('SUMMARY — convergence time (round / ratings)')
  console.log('='.repeat(72))
  console.log('Preference'.padEnd(36) + 'All channel'.padEnd(22) + 'Channel hint')
  console.log('-'.repeat(72))

  let allOk = 0
  let chOk = 0
  let allRounds = 0
  let chRounds = 0
  let allCount = 0
  let chCount = 0

  for (const s of summaries) {
    const allStr = s.allConverged
      ? `✓ r${s.allRound} (${s.allRatings}★)`
      : `✗ — (${s.allRatings}★)`
    const chStr = s.channelConverged
      ? `✓ r${s.channelRound} (${s.channelRatings}★)`
      : `✗ — (${s.channelRatings}★)`
    console.log(s.preference.slice(0, 35).padEnd(36) + allStr.padEnd(22) + chStr)
    if (s.allConverged) {
      allOk++
      if (s.allRound != null) {
        allRounds += s.allRound
        allCount++
      }
    }
    if (s.channelConverged) {
      chOk++
      if (s.channelRound != null) {
        chRounds += s.channelRound
        chCount++
      }
    }
  }

  console.log('-'.repeat(72))
  console.log(
    `All channel:  ${allOk}/${summaries.length} converged` +
      (allCount ? `, avg round ${(allRounds / allCount).toFixed(1)}` : ''),
  )
  console.log(
    `Channel hint: ${chOk}/${summaries.length} converged` +
      (chCount ? `, avg round ${(chRounds / chCount).toFixed(1)}` : ''),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
