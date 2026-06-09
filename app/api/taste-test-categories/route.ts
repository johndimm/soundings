import { NextRequest } from 'next/server'
import { DEFAULT_LLM_PROVIDER, type LLMProvider } from '@/app/lib/llm'
import { callLLMRaw } from '@/app/lib/llmChat'

function stripMarkdownJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export async function POST(req: NextRequest) {
  const raw = (await req.json()) as { count?: number; provider?: LLMProvider }
  const count = Math.min(20, Math.max(1, Math.floor(Number(raw.count) || 7)))
  const provider = raw.provider ?? DEFAULT_LLM_PROVIDER

  const systemPrompt = `You propose taste profiles for testing a music recommendation discovery system.

Each profile is a short phrase (roughly 2–6 words) describing one coherent listening preference the system must infer from ratings alone — without being told the profile upfront.

Profiles should be diverse across regions, eras, genres, moods, and traditions. Invent them freely; do not copy a fixed checklist. No two profiles in one batch should overlap heavily.`

  const userMessage = `Suggest exactly ${count} distinct music taste profiles for separate test runs.

Reply ONLY with JSON:
{"categories":["profile one","profile two",...]}`

  try {
    const text = await callLLMRaw(provider, systemPrompt, userMessage, 400)
    const cleaned = stripMarkdownJsonFence(text)
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) {
      return Response.json({ error: 'invalid LLM response', raw: text }, { status: 502 })
    }
    const parsed = JSON.parse(match[0]) as { categories?: unknown }
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim())
          .slice(0, count)
      : []
    if (!categories.length) {
      return Response.json({ error: 'no categories in response', raw: text }, { status: 502 })
    }
    return Response.json({ categories })
  } catch (err) {
    console.error('[taste-test-categories]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'category list failed' },
      { status: 500 },
    )
  }
}
