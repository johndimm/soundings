import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const QUOTA_FILE = join(process.cwd(), '.youtube-quota.json')
const QUOTA_KV_KEY = 'yt-quota'

export type QuotaDisk = {
  ptDate: string
  searchesUsed: number
  quotaExceededUntil: number
}

function pacificDateKey(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

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

export async function loadQuotaState(): Promise<QuotaDisk> {
  const today = pacificDateKey()

  // Try KV first (Vercel production)
  const kv = await getKvClient()
  if (kv) {
    try {
      const raw = await kv.get<Partial<QuotaDisk & { creditsUsed?: number }>>(QUOTA_KV_KEY)
      if (raw && raw.ptDate === today) {
        return { ptDate: today, searchesUsed: raw.searchesUsed ?? (raw.creditsUsed ? Math.round(raw.creditsUsed / 100) : 0), quotaExceededUntil: raw.quotaExceededUntil ?? 0 }
      }
      return { ptDate: today, searchesUsed: 0, quotaExceededUntil: 0 }
    } catch {
      // Fall through to local file
    }
  }

  // Fallback to local file (development)
  try {
    if (existsSync(QUOTA_FILE)) {
      const raw = JSON.parse(readFileSync(QUOTA_FILE, 'utf-8')) as Partial<
        QuotaDisk & { creditsUsed?: number }
      >
      if (raw.ptDate === today) {
        return { ptDate: today, searchesUsed: raw.searchesUsed ?? (raw.creditsUsed ? Math.round(raw.creditsUsed / 100) : 0), quotaExceededUntil: raw.quotaExceededUntil ?? 0 }
      }
      return { ptDate: today, searchesUsed: 0, quotaExceededUntil: 0 }
    }
  } catch {}
  return { ptDate: today, searchesUsed: 0, quotaExceededUntil: 0 }
}

export async function persistQuotaState(state: QuotaDisk): Promise<void> {
  // Try KV first (Vercel production)
  const kv = await getKvClient()
  if (kv) {
    try {
      await kv.set(QUOTA_KV_KEY, state)
      return
    } catch {
      // Fall through to local file
    }
  }

  // Fallback to local file (development)
  try {
    writeFileSync(QUOTA_FILE, JSON.stringify(state))
  } catch {}
}
