import { NextRequest } from 'next/server'
import { DEFAULT_LLM_PROVIDER, type LLMProvider } from '@/app/lib/llm'
import { callLLMRaw } from '@/app/lib/llmChat'
import {
  mapPreferenceToTreePaths,
  normalizeCategoryTree,
  parseCategoryPathsFromRaw,
  tasteTestStarScore,
  type CategoryPath,
  type CategoryTree,
} from '@/app/lib/categoryTree'

interface ScoreSongInput {
  search: string
  category?: string
  categoryPaths?: CategoryPath[]
  composed?: number | null
}

function stripMarkdownJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export async function POST(req: NextRequest) {
  const raw = (await req.json()) as {
    preference?: string
    songs?: ScoreSongInput[]
    provider?: LLMProvider
    categoryTree?: CategoryTree
    targetPaths?: CategoryPath[]
    channelHint?: boolean
  }

  const preference = raw.preference?.trim()
  const songs = Array.isArray(raw.songs) ? raw.songs : []
  const provider = raw.provider ?? DEFAULT_LLM_PROVIDER
  const categoryTree = raw.categoryTree ? normalizeCategoryTree(raw.categoryTree) : null

  if (!preference) {
    return Response.json({ error: 'preference required' }, { status: 400 })
  }
  if (!songs.length) {
    return Response.json({ scores: [] })
  }

  let targetPaths = raw.targetPaths ?? []
  if (categoryTree && !targetPaths.length) {
    targetPaths = await mapPreferenceToTreePaths(categoryTree, preference, provider)
  }

  const useTreeScoring = categoryTree && targetPaths.length > 0

  if (useTreeScoring) {
    const scores = songs.map((s) => {
      const itemPaths = s.categoryPaths?.length
        ? s.categoryPaths
        : parseCategoryPathsFromRaw(s.categoryPaths)
      const { stars, reason } = tasteTestStarScore(
        preference,
        targetPaths,
        { category: s.category, categoryPaths: itemPaths, composed: s.composed },
        { channelHint: raw.channelHint === true },
      )
      return { search: s.search, stars, reason }
    })
    return Response.json({ scores, targetPaths })
  }

  const songLines = songs
    .map((s, i) => {
      const cats = s.category?.trim() || '(no category tag — score cautiously from search text only)'
      return `${i + 1}. "${s.search}" — Category: ${cats}`
    })
    .join('\n')

  const systemPrompt = `You are a taste-test oracle scoring how well songs match a target music preference.

The PRIMARY signal is each song's category tags (assigned by the recommendation LLM). Do NOT keyword-match artist/title text — judge whether the category tags indicate a genuine fit.

Reply with ONLY a JSON array, one object per song IN ORDER:
[{"search":"...","stars":4,"reason":"short explanation citing category tags"}]

stars must be an integer 1–5.`

  const userMessage = `Target preference: "${preference}"

Rate each song 1–5 by how well its CATEGORY TAGS fit that preference:
- 5★: category tags are a clear, strong match
- 4★: several tags align well
- 3★: partial overlap
- 2★: weak or misleading overlap
- 1★: category tags do not match the preference

Songs:
${songLines}`

  try {
    const text = await callLLMRaw(provider, systemPrompt, userMessage, 1200)
    const cleaned = stripMarkdownJsonFence(text)
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) {
      return Response.json({ error: 'invalid LLM response', raw: text }, { status: 502 })
    }
    const parsed = JSON.parse(match[0]) as Array<{ search?: string; stars?: number; reason?: string }>
    const scores = songs.map((s, i) => {
      const row = parsed[i]
      const starsRaw = Number(row?.stars)
      const stars = Number.isFinite(starsRaw)
        ? Math.max(1, Math.min(5, Math.round(starsRaw)))
        : 3
      const reason =
        typeof row?.reason === 'string' && row.reason.trim()
          ? row.reason.trim()
          : s.category
            ? `Category: ${s.category}`
            : 'No category tag'
      return { search: s.search, stars, reason }
    })
    return Response.json({ scores })
  } catch (err) {
    console.error('[taste-test-score]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'scoring failed' },
      { status: 500 },
    )
  }
}
