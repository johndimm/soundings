import { callLLMRaw } from '@/app/lib/llmChat'
import type { LLMProvider } from '@/app/lib/llm'

export interface CategorySuper {
  id: string
  label: string
  leaves: string[]
}

export interface CategoryDimension {
  id: string
  label: string
  supers: CategorySuper[]
}

export interface CategoryTree {
  dimensions: CategoryDimension[]
}

export interface CategoryPath {
  dimension: string
  super: string
  leaf?: string | null
}

function stripMarkdownJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function slugId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

function normalizePath(raw: unknown): CategoryPath | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const dimension = typeof o.dimension === 'string' ? slugId(o.dimension) : ''
  const superId = typeof o.super === 'string' ? slugId(o.super) : ''
  if (!dimension || !superId) return null
  const leaf =
    typeof o.leaf === 'string' && o.leaf.trim() ? o.leaf.trim().toLowerCase() : null
  return { dimension, super: superId, leaf }
}

export function normalizeCategoryTree(raw: unknown): CategoryTree | null {
  if (!raw || typeof raw !== 'object') return null
  const dims = (raw as { dimensions?: unknown }).dimensions
  if (!Array.isArray(dims)) return null

  const dimensions: CategoryDimension[] = []
  for (const d of dims) {
    if (!d || typeof d !== 'object') continue
    const dim = d as Record<string, unknown>
    const id = typeof dim.id === 'string' ? slugId(dim.id) : ''
    const label = typeof dim.label === 'string' ? dim.label.trim() : ''
    const supersRaw = dim.supers
    if (!id || !label || !Array.isArray(supersRaw)) continue

    const supers: CategorySuper[] = []
    for (const s of supersRaw) {
      if (!s || typeof s !== 'object') continue
      const sup = s as Record<string, unknown>
      const supId = typeof sup.id === 'string' ? slugId(sup.id) : ''
      const supLabel = typeof sup.label === 'string' ? sup.label.trim() : ''
      const leavesRaw = sup.leaves
      if (!supId || !supLabel || !Array.isArray(leavesRaw)) continue
      const leaves = leavesRaw
        .filter((l): l is string => typeof l === 'string' && !!l.trim())
        .map((l) => l.trim().toLowerCase())
      if (!leaves.length) continue
      supers.push({ id: supId, label: supLabel, leaves })
    }
    if (!supers.length) continue
    dimensions.push({ id, label, supers })
  }

  return dimensions.length ? { dimensions } : null
}

/** When channel notes are set: require tree paths for tagging, not 20Q exploration. */
export function buildChannelTreeTaggingSection(tree: CategoryTree): string {
  return `${formatTreeForPrompt(tree)}

CHANNEL TAGGING (constraints are fixed — do NOT wander outside the channel):
Tag every song with category_paths from this tree. Pick songs that genuinely fit the user constraints AND the tree paths.`
}

export function formatTreeForPrompt(tree: CategoryTree): string {
  const lines: string[] = [
    'SESSION CATEGORY TREE (tag every song with category_paths from this taxonomy):',
  ]
  for (const dim of tree.dimensions) {
    lines.push(`\n${dim.label} [${dim.id}]:`)
    for (const sup of dim.supers) {
      lines.push(`  · ${sup.label} [${dim.id}/${sup.id}] — leaves: ${sup.leaves.join(', ')}`)
    }
  }
  return lines.join('\n')
}

export function superKey(p: CategoryPath): string {
  return `${p.dimension}:${p.super}`
}

export function leafKey(p: CategoryPath): string {
  return p.leaf ? `${p.dimension}:${p.super}:${p.leaf}` : superKey(p)
}

export function parseCategoryPathsFromRaw(raw: unknown): CategoryPath[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizePath).filter((p): p is CategoryPath => p !== null)
}

export function pathToCategoryLabel(p: CategoryPath): string {
  const superLabel = p.super.replace(/_/g, ' ')
  return p.leaf ? `${superLabel} > ${p.leaf}` : superLabel
}

export function pathsToCategoryLabel(paths: CategoryPath[]): string | undefined {
  const primary = paths[0]
  return primary ? pathToCategoryLabel(primary) : undefined
}

/** Deterministic map position from category path or label (no hard-coded genre table). */
export function hashCoordsFromSeed(seed: string): { x: number; y: number; z: number } {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  const x = 8 + (Math.abs(h) % 84)
  const y = 8 + (Math.abs(h >> 8) % 84)
  const z = 8 + (Math.abs(h >> 16) % 84)
  return { x, y, z }
}

export function coordsSeedFromEntry(entry: {
  category?: string
  categoryPaths?: CategoryPath[]
}): string {
  const p = entry.categoryPaths?.[0]
  if (p) return superKey(p) + (p.leaf ? `:${p.leaf}` : '')
  return entry.category?.trim() || 'unknown'
}

function untriedSupersForDimension(
  dim: CategoryDimension,
  tried: Set<string>,
): CategorySuper[] {
  const untried = dim.supers.filter((s) => !tried.has(`${dim.id}:${s.id}`))
  return untried.length ? untried : dim.supers
}

function findSupersForLeaf(
  tree: CategoryTree,
  leaf: string,
): Array<{ dimension: string; super: string; superLabel: string; dimLabel: string }> {
  const key = leaf.trim().toLowerCase()
  const out: Array<{ dimension: string; super: string; superLabel: string; dimLabel: string }> = []
  for (const dim of tree.dimensions) {
    for (const sup of dim.supers) {
      if (sup.leaves.some((l) => l.toLowerCase() === key)) {
        out.push({ dimension: dim.id, super: sup.id, superLabel: sup.label, dimLabel: dim.label })
      }
    }
  }
  return out
}

function leafBridgeCount(tree: CategoryTree, leaf: string): number {
  return findSupersForLeaf(tree, leaf).length
}

function pickSuperAndLeaf(
  dim: CategoryDimension,
  pool: CategorySuper[],
  slotIndex: number,
  tree: CategoryTree,
): { super: CategorySuper; leaf: string } | null {
  if (!pool.length) return null
  const ranked = [...pool].sort((a, b) => {
    const aBridge = Math.max(...a.leaves.map((l) => leafBridgeCount(tree, l)), 0)
    const bBridge = Math.max(...b.leaves.map((l) => leafBridgeCount(tree, l)), 0)
    return bBridge - aBridge
  })
  const pick = ranked[slotIndex % ranked.length] ?? ranked[0]!
  const rankedLeaves = [...pick.leaves].sort(
    (a, b) => leafBridgeCount(tree, b) - leafBridgeCount(tree, a),
  )
  const leaf = rankedLeaves[slotIndex % rankedLeaves.length] ?? rankedLeaves[0] ?? pick.leaves[0]
  if (!leaf) return null
  return { super: pick, leaf }
}

export interface ExplorationSlot {
  slot: number
  dimension: string
  dimensionLabel: string
  super: string
  superLabel: string
  requiredLeaf: string
}

export function buildRoundOneSlots(
  tree: CategoryTree,
  batchCount: number,
  triedSuperKeys: string[],
): ExplorationSlot[] {
  const tried = new Set(triedSuperKeys)
  const dims = tree.dimensions
  if (!dims.length) return []

  const slots: ExplorationSlot[] = []
  for (let i = 0; i < batchCount; i++) {
    const dim = dims[i % dims.length]!
    const pool = untriedSupersForDimension(dim, tried)
    const picked = pickSuperAndLeaf(dim, pool, i, tree)
    if (!picked) continue
    slots.push({
      slot: i + 1,
      dimension: dim.id,
      dimensionLabel: dim.label,
      super: picked.super.id,
      superLabel: picked.super.label,
      requiredLeaf: picked.leaf,
    })
  }
  return slots
}

function formatRoundOneSlotRequirements(slots: ExplorationSlot[]): string {
  if (!slots.length) return ''
  const lines = slots.map(
    (s) =>
      `Song ${s.slot}: category_paths MUST include {"dimension":"${s.dimension}","super":"${s.super}","leaf":"${s.requiredLeaf}"} — choose a real, well-known track that genuinely fits ${s.dimensionLabel} → ${s.superLabel} → ${s.requiredLeaf}`,
  )
  return `MANDATORY ROUND-1 SLOT ASSIGNMENTS (${slots.length} songs — one per slot, in order):
${lines.join('\n')}

CRITICAL: songs[0] fulfills slot 1, songs[1] slot 2, etc. Each song's category_paths must include its slot's dimension+super+leaf exactly.
Also add 1–2 extra category_paths when they genuinely fit (era + genre + region helps niche discovery).`
}

function dimensionWithMostUntriedSupers(
  tree: CategoryTree,
  tried: Set<string>,
): CategoryDimension | null {
  let best: CategoryDimension | null = null
  let bestCount = -1
  for (const dim of tree.dimensions) {
    const n = untriedSupersForDimension(dim, tried).length
    if (n > bestCount) {
      bestCount = n
      best = dim
    }
  }
  return best
}

function buildLeafNearMissSection(
  tree: CategoryTree,
  history: Array<{ stars?: number | null; categoryPaths?: CategoryPath[] }>,
  tried: Set<string>,
): string {
  const leafRatings = new Map<string, number[]>()
  for (const entry of history) {
    const stars = entry.stars ?? 0
    if (stars < 2 || stars > 4) continue
    for (const p of entry.categoryPaths ?? []) {
      if (!p.leaf) continue
      const k = p.leaf.toLowerCase()
      if (!leafRatings.has(k)) leafRatings.set(k, [])
      leafRatings.get(k)!.push(stars)
    }
  }

  const hints: string[] = []
  for (const [leaf, ratings] of leafRatings) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length
    if (avg < 2 || avg > 3.5) continue
    const supers = findSupersForLeaf(tree, leaf).filter((s) => !tried.has(`${s.dimension}:${s.super}`))
    if (!supers.length) continue
    hints.push(
      `Leaf "${leaf}" got ~${avg.toFixed(1)}★ — try untried supers sharing this leaf: ${supers.map((s) => `${s.dimLabel}/${s.superLabel}`).join('; ')}`,
    )
  }
  if (!hints.length) return ''
  return `LEAF NEAR-MISS DRILL-DOWN:\n${hints.join('\n')}\n`
}

export function buildMusicTreeExplorationSection(
  tree: CategoryTree,
  history: Array<{ stars?: number | null; categoryPaths?: CategoryPath[] }>,
  batchCount: number,
  triedSuperKeys: string[],
): string {
  const treeBlock = formatTreeForPrompt(tree)
  if (!tree.dimensions.length) return treeBlock

  const tried = new Set(triedSuperKeys)
  const lovedSupers = new Map<string, number[]>()
  const weakSupers = new Map<string, number[]>()

  for (const entry of history) {
    const stars = entry.stars ?? 0
    for (const p of entry.categoryPaths ?? []) {
      const k = superKey(p)
      const leafK = leafKey(p)
      if (stars >= 4) {
        if (!lovedSupers.has(k)) lovedSupers.set(k, [])
        lovedSupers.get(k)!.push(stars)
      } else if (stars >= 3) {
        if (!weakSupers.has(k)) weakSupers.set(k, [])
        weakSupers.get(k)!.push(stars)
        if (p.leaf) {
          if (!weakSupers.has(leafK)) weakSupers.set(leafK, [])
          weakSupers.get(leafK)!.push(stars)
        }
      }
    }
  }

  if (history.length === 0) {
    const plan = formatRoundOneSlotRequirements(buildRoundOneSlots(tree, batchCount, triedSuperKeys))
    return `${treeBlock}

20Q ROUND 1 — MULTI-DIMENSION TOP-LEVEL SAMPLING (no ratings yet):
Spread this batch across DIFFERENT dimensions — not only region. Niche tastes (era + genre combos) must be reachable in round 1.
${plan}
The "category" field should echo super > leaf for display.`
  }

  const topLoved = [...lovedSupers.entries()]
    .sort((a, b) => {
      const avgA = a[1].reduce((x, y) => x + y, 0) / a[1].length
      const avgB = b[1].reduce((x, y) => x + y, 0) / b[1].length
      return avgB - avgA
    })
    .slice(0, 3)
    .map(([k]) => k)

  if (topLoved.length > 0) {
    return `${treeBlock}

20Q DRILL-DOWN — listener loves these super-categories: ${topLoved.join(', ')}.
Most picks should explore untried LEAVES within those supers.
Include 1 sibling super (same dimension, different super) to confirm the branch.
Tag every song with category_paths from the tree.`
  }

  const topWeak = [...weakSupers.entries()]
    .sort((a, b) => {
      const avgA = a[1].reduce((x, y) => x + y, 0) / a[1].length
      const avgB = b[1].reduce((x, y) => x + y, 0) / b[1].length
      return avgB - avgA
    })
    .slice(0, 3)
    .map(([k]) => k)

  if (topWeak.length > 0) {
    const leafNearMiss = buildLeafNearMissSection(tree, history, tried)
    return `${treeBlock}

20Q WARM-SIGNAL DRILL-DOWN — partial matches on: ${topWeak.join(', ')}.
Double down on those branches — especially untried leaves within the same supers and cross-dimension combos (era + genre).
${leafNearMiss}Tag every song with category_paths from the tree.`
  }

  const focusDim = dimensionWithMostUntriedSupers(tree, tried)
  const freshSupers = focusDim
    ? untriedSupersForDimension(focusDim, tried).map((s) => `${focusDim.label} → ${s.label}`)
    : []
  const leafNearMiss = buildLeafNearMissSection(tree, history, tried)

  return `${treeBlock}

20Q EXPLORATION (${history.length} ratings): No strong loves yet. ${leafNearMiss}Rotate into less-sampled dimensions — prioritize: ${
    freshSupers.length ? freshSupers.join('; ') : 'any fresh supers across all dimensions'
  }.
Each batch should span multiple dimensions when possible. Tag every song with category_paths from the tree.`
}

function normalizeLeafToken(leaf: string): string {
  return leaf.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function leavesAlign(targetLeaf: string, filmLeaf: string): boolean {
  const a = normalizeLeafToken(targetLeaf)
  const b = normalizeLeafToken(filmLeaf)
  return a === b || a.includes(b) || b.includes(a)
}

function yearMatchesEraSuper(superId: string, year: number): boolean {
  const m = superId.match(/(\d{4})/)
  if (m) {
    const decade = parseInt(m[1]!, 10)
    return year >= decade && year < decade + 10
  }
  if (superId.includes('late_20th') || superId.includes('1990')) {
    return year >= 1990 && year <= 1999
  }
  if (superId.includes('2000') || superId.includes('contemporary')) {
    return year >= 2000
  }
  return false
}

function scoreTargetPathAgainstItem(
  target: CategoryPath,
  itemPaths: CategoryPath[],
  composedYear?: number | null,
): { stars: number; reason: string } {
  let bestStars = 1
  let bestReason = `No overlap on dimension ${target.dimension}`

  for (const item of itemPaths) {
    if (target.dimension !== item.dimension) continue

    if (
      target.leaf &&
      item.leaf &&
      leavesAlign(target.leaf, item.leaf) &&
      target.super !== item.super
    ) {
      if (bestStars < 4) {
        bestStars = 4
        bestReason = `Leaf match on ${target.dimension} (target super ${target.super}, tagged ${item.super}, leaf "${item.leaf}")`
      }
    }

    if (target.super === item.super) {
      if (target.leaf && item.leaf) {
        if (leavesAlign(target.leaf, item.leaf)) {
          return {
            stars: 5,
            reason: `Exact leaf: ${target.dimension}/${target.super}/${target.leaf}`,
          }
        }
        if (bestStars < 3) {
          bestStars = 3
          bestReason = `Same super, different leaf: target "${target.leaf}", got "${item.leaf}" (${target.dimension}/${target.super})`
        }
      } else if (target.leaf && !item.leaf) {
        if (bestStars < 3) {
          bestStars = 3
          bestReason = `Same super but missing leaf tag (target "${target.leaf}" on ${target.dimension}/${target.super})`
        }
      } else if (bestStars < 4) {
        bestStars = 4
        bestReason = `Same super-category: ${target.dimension}/${target.super}`
      }
    } else if (
      target.dimension === 'era' &&
      composedYear != null &&
      yearMatchesEraSuper(target.super, composedYear) &&
      bestStars < 4
    ) {
      bestStars = 4
      bestReason = `Composition year ${composedYear} fits target era ${target.super} (tagged under ${item.super})`
    } else if (bestStars < 2) {
      bestStars = 2
      bestReason = `Sibling super on ${target.dimension}: target ${target.super}, got ${item.super}`
    }
  }

  if (
    target.dimension === 'era' &&
    composedYear != null &&
    yearMatchesEraSuper(target.super, composedYear) &&
    bestStars < 4
  ) {
    bestStars = 4
    bestReason = `Composition year ${composedYear} fits target era ${target.super} (no era path tagged)`
  }

  return { stars: bestStars, reason: bestReason }
}

/** Does the song's tags/category read as fitting the target preference (channel-hint oracle boost). */
export function preferenceDisplayFitScore(
  preference: string,
  targetPaths: CategoryPath[],
  song: { category?: string; categoryPaths?: CategoryPath[]; composed?: number | null },
): { stars: number; reason: string } {
  const targetLeaves = targetPaths.map((p) => p.leaf).filter((l): l is string => !!l)
  const hayParts = [
    song.category?.toLowerCase() ?? '',
    ...(song.categoryPaths ?? []).flatMap((p) => [p.super, p.leaf ?? ''].map((x) => x.toLowerCase())),
  ]
  const hay = normalizeLeafToken(hayParts.join(' '))
  const prefNorm = normalizeLeafToken(preference)

  let leafHits = 0
  for (const leaf of targetLeaves) {
    const n = normalizeLeafToken(leaf)
    if (n && (hay.includes(n) || prefNorm.includes(n) || n.includes(prefNorm))) leafHits++
  }

  if (leafHits >= 2) {
    return { stars: 5, reason: `Category/tags match preference leaves (${targetLeaves.join(', ')})` }
  }
  if (leafHits === 1) {
    return { stars: 4, reason: `Partial leaf match for "${preference}"` }
  }

  const eraTarget = targetPaths.find((p) => p.dimension === 'era')
  if (
    eraTarget &&
    song.composed != null &&
    yearMatchesEraSuper(eraTarget.super, song.composed) &&
    hay.includes(normalizeLeafToken(targetLeaves[0] ?? preference))
  ) {
    return { stars: 4, reason: `Era + style match (${song.composed}, ${preference})` }
  }

  if (prefNorm.length >= 4 && hay.includes(prefNorm)) {
    return { stars: 4, reason: `Category contains preference phrase` }
  }

  return { stars: 1, reason: 'Category/tags do not read as matching preference' }
}

/** Best of tree fit and display fit — channel hints should score what listeners actually get. */
export function tasteTestStarScore(
  preference: string,
  targetPaths: CategoryPath[],
  song: { category?: string; categoryPaths?: CategoryPath[]; composed?: number | null },
  opts?: { channelHint?: boolean },
): { stars: number; reason: string } {
  const paths = song.categoryPaths ?? []
  const tree =
    paths.length > 0
      ? hierarchicalStarScore(targetPaths, paths, song.composed)
      : { stars: 3, reason: 'No category_paths — neutral tree score' }

  if (!opts?.channelHint) return tree

  const display = preferenceDisplayFitScore(preference, targetPaths, song)
  const stars = Math.max(tree.stars, display.stars)
  const reason =
    stars === tree.stars
      ? tree.reason
      : stars === display.stars
        ? display.reason
        : `${display.reason} (tree: ${tree.stars}★)`
  return { stars, reason }
}

/** Hierarchical fit for taste-test oracle. Compound preferences average per-dimension scores. */
export function hierarchicalStarScore(
  targetPaths: CategoryPath[],
  itemPaths: CategoryPath[],
  composedYear?: number | null,
): { stars: number; reason: string } {
  if (!targetPaths.length || !itemPaths.length) {
    return { stars: 3, reason: 'Missing tree paths — neutral score' }
  }

  const perTarget = targetPaths.map((t) => scoreTargetPathAgainstItem(t, itemPaths, composedYear))

  if (targetPaths.length > 1) {
    const avg = perTarget.reduce((sum, p) => sum + p.stars, 0) / perTarget.length
    const stars = Math.max(1, Math.min(5, Math.round(avg)))
    const reason = perTarget.map((p) => p.reason).join(' | ')
    return { stars, reason }
  }

  return perTarget[0]!
}

function mergeTreeLeaves(existing: string[], added: string[]): string[] {
  const seen = new Set(existing.map((l) => l.toLowerCase()))
  const out = [...existing]
  for (const leaf of added) {
    const k = leaf.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

export function mergeTreeAdditions(tree: CategoryTree, additions: CategoryDimension[]): CategoryTree {
  const dimById = new Map(tree.dimensions.map((d) => [d.id, { ...d, supers: [...d.supers] }]))

  for (const addDim of additions) {
    const existing = dimById.get(addDim.id)
    if (!existing) {
      dimById.set(addDim.id, addDim)
      continue
    }
    const supById = new Map(existing.supers.map((s) => [s.id, { ...s, leaves: [...s.leaves] }]))
    for (const addSup of addDim.supers) {
      const exSup = supById.get(addSup.id)
      if (!exSup) {
        supById.set(addSup.id, addSup)
        continue
      }
      exSup.leaves = mergeTreeLeaves(exSup.leaves, addSup.leaves)
      supById.set(addSup.id, exSup)
    }
    existing.supers = [...supById.values()]
    dimById.set(addDim.id, existing)
  }

  return { dimensions: [...dimById.values()] }
}

export async function augmentTreeForPreference(
  tree: CategoryTree,
  preference: string,
  provider: LLMProvider,
): Promise<CategoryTree> {
  const systemPrompt = `You extend a music category tree so a specific taste preference has a clear home.

Add or extend dimensions/supers/leaves using lowercase snake_case ids. Do not remove existing content.
Prefer splitting compound tastes across dimensions (e.g. era + genre) when natural.

Reply ONLY with JSON:
{"dimensions":[{"id":"era","label":"Era","supers":[{"id":"1990s","label":"1990s","leaves":["90s r&b","90s grunge"]}]}]}`

  const userMessage = `Existing tree:
${formatTreeForPrompt(tree)}

Preference that MUST be representable as at least one exact leaf: "${preference}"

Return only NEW or EXTENDED branches needed (merge-friendly). Include era and genre splits when the preference implies them.`

  const text = await callLLMRaw(provider, systemPrompt, userMessage, 800)
  const cleaned = stripMarkdownJsonFence(text)
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return tree

  const parsed = normalizeCategoryTree(JSON.parse(match[0]))
  if (!parsed) return tree
  return mergeTreeAdditions(tree, parsed.dimensions)
}

function pathsMatchTreeLeaves(tree: CategoryTree, paths: CategoryPath[]): boolean {
  if (!paths.length) return false
  for (const p of paths) {
    const dim = tree.dimensions.find((d) => d.id === p.dimension)
    const sup = dim?.supers.find((s) => s.id === p.super)
    if (!dim || !sup) return false
    if (p.leaf && !sup.leaves.includes(p.leaf)) return false
  }
  return true
}

export async function mapPreferenceToTreePaths(
  tree: CategoryTree,
  preference: string,
  provider: LLMProvider,
): Promise<CategoryPath[]> {
  const systemPrompt = `You map a listener's taste preference to paths in a fixed music category tree.
Pick 1–3 best-matching paths using ONLY dimension/super/leaf values that exist in the tree.
Compound tastes (era + genre) should use multiple paths.
Use the tree's id fields for dimension and super; use an exact leaf string from that super's leaves list.

Reply ONLY with JSON:
{"targetPaths":[{"dimension":"era","super":"1990s","leaf":"motown"},{"dimension":"genre","super":"soul","leaf":"motown"}]}`

  const userMessage = `Category tree:
${formatTreeForPrompt(tree)}

Target preference: "${preference}"

Return targetPaths (1–3 entries) for where this preference lives in the tree.`

  const text = await callLLMRaw(provider, systemPrompt, userMessage, 400)
  const cleaned = stripMarkdownJsonFence(text)
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return []

  const parsed = JSON.parse(match[0]) as { targetPaths?: unknown }
  if (!Array.isArray(parsed.targetPaths)) return []

  return parsed.targetPaths.map(normalizePath).filter((p): p is CategoryPath => p !== null)
}

export async function resolveTreeForPreference(
  tree: CategoryTree,
  preference: string,
  provider: LLMProvider,
): Promise<{ tree: CategoryTree; targetPaths: CategoryPath[] }> {
  let working = tree
  let targetPaths = await mapPreferenceToTreePaths(working, preference, provider)
  if (!targetPaths.length || !pathsMatchTreeLeaves(working, targetPaths)) {
    working = await augmentTreeForPreference(working, preference, provider)
    targetPaths = await mapPreferenceToTreePaths(working, preference, provider)
  }
  return { tree: working, targetPaths }
}

export async function generateCategoryTree(
  provider: LLMProvider,
  opts?: { anchorPreference?: string; anchorPreferences?: string[] },
): Promise<CategoryTree> {
  const anchors = [
    ...(opts?.anchorPreference?.trim() ? [opts.anchorPreference.trim()] : []),
    ...(opts?.anchorPreferences ?? []).map((p) => p.trim()).filter(Boolean),
  ]

  const systemPrompt = `You design a music taxonomy for a 20-questions taste-discovery system.

The tree has 4 dimensions in this order (important for round-1 sampling):
1. era — decades/movements (e.g. 1990s, golden age, contemporary)
2. genre — genre families (e.g. soul, jazz, hip-hop, classical)
3. region — cultural/national traditions
4. sonic — mood/texture (optional fourth)

Each dimension has 4–6 super-categories. Each super has 3–5 leaf subcategories (specific tags).
Niche combos (e.g. "90s trip-hop") must appear as a leaf under the right era AND/OR genre super.

Use lowercase snake_case for "id" fields. Labels are human-readable. Leaves are short phrases.

Reply ONLY with valid JSON — no markdown:
{"dimensions":[{"id":"era","label":"Era","supers":[{"id":"1990s","label":"1990s","leaves":["trip-hop","grunge"]}]}]}`

  const anchorNote =
    anchors.length > 0
      ? `\n\nEach of these taste profiles MUST be representable as at least one exact leaf somewhere in the tree (you choose where): ${anchors.map((a) => `"${a}"`).join(', ')}.`
      : ''

  const userMessage = `Generate a diverse music category tree for global taste discovery.
Put era first, then genre, then region. Cover many regions, genre families, eras, and sonic styles. At least 4 dimensions, 4+ supers each.${anchorNote}`

  const text = await callLLMRaw(provider, systemPrompt, userMessage, 2500)
  const cleaned = stripMarkdownJsonFence(text)
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('category tree: no JSON object in LLM response')

  const tree = normalizeCategoryTree(JSON.parse(match[0]))
  if (!tree) throw new Error('category tree: invalid structure from LLM')
  return tree
}
