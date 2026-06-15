/**
 * Track accuracy of YouTube IDs provided by the LLM.
 * Persisted to Vercel KV for multi-instance visibility.
 */

export type LLMIdOutcome = {
  provider: string
  modelId: string
  provided: number
  validated: number
  invalid: number
  timestamp: number
}

const KV_KEY = 'llm-youtube-id-stats'

async function getKvClient() {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import('@vercel/kv')
      return kv
    } catch {
      return null
    }
  }
  return null
}

async function loadStats(): Promise<LLMIdOutcome[]> {
  const kv = await getKvClient()
  if (!kv) return []
  try {
    const data = await kv.get<LLMIdOutcome[]>(KV_KEY)
    return data ?? []
  } catch {
    return []
  }
}

async function saveStats(stats: LLMIdOutcome[]): Promise<void> {
  const kv = await getKvClient()
  if (!kv) return
  try {
    await kv.set(KV_KEY, stats)
  } catch (err) {
    console.warn('[llm-youtube-id] save error:', err)
  }
}

export async function trackLlmYouTubeIdOutcome(
  provider: string,
  modelId: string,
  isValid: boolean
): Promise<void> {
  const stats = await loadStats()
  let entry = stats.find(o => o.modelId === modelId && o.provider === provider)

  if (!entry) {
    entry = {
      provider,
      modelId,
      provided: 0,
      validated: 0,
      invalid: 0,
      timestamp: Date.now(),
    }
    stats.push(entry)
  }

  entry.provided += 1
  if (isValid) {
    entry.validated += 1
  } else {
    entry.invalid += 1
  }

  await saveStats(stats)
}

export async function getLlmYouTubeIdStats() {
  const stats = await loadStats()
  return stats.map(o => ({
    ...o,
    accuracy: o.provided > 0 ? (o.validated / o.provided * 100).toFixed(1) + '%' : 'N/A',
  }))
}
