import { NextRequest } from 'next/server'
import { DEFAULT_LLM_PROVIDER, type LLMProvider } from '@/app/lib/llm'
import {
  generateCategoryTree,
  normalizeCategoryTree,
  resolveTreeForPreference,
  type CategoryPath,
  type CategoryTree,
} from '@/app/lib/categoryTree'

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider?: LLMProvider
    preference?: string
    tree?: unknown
    anchorPreferences?: string[]
  }

  const provider = body.provider ?? DEFAULT_LLM_PROVIDER
  const preference = body.preference?.trim()

  try {
    let tree: CategoryTree
    if (body.tree) {
      const normalized = normalizeCategoryTree(body.tree)
      if (!normalized) {
        return Response.json({ error: 'invalid tree payload' }, { status: 400 })
      }
      tree = normalized
    } else if (preference) {
      tree = await generateCategoryTree(provider, { anchorPreference: preference })
    } else if (body.anchorPreferences?.length) {
      tree = await generateCategoryTree(provider, { anchorPreferences: body.anchorPreferences })
    } else {
      tree = await generateCategoryTree(provider)
    }

    let targetPaths: CategoryPath[] | undefined
    if (preference) {
      const resolved = await resolveTreeForPreference(tree, preference, provider)
      tree = resolved.tree
      targetPaths = resolved.targetPaths
    }

    return Response.json({ tree, targetPaths })
  } catch (err) {
    console.error('[category-tree]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'category tree failed' },
      { status: 500 },
    )
  }
}
