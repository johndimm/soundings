import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const QUOTA_FILE = join(process.cwd(), '.youtube-quota.json')

export type QuotaDisk = {
  ptDate: string
  searchesUsed: number
  quotaExceededUntil: number
}

function pacificDateKey(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

export function loadQuotaState(): QuotaDisk {
  const today = pacificDateKey()
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

export function persistQuotaState(state: QuotaDisk): void {
  try {
    writeFileSync(QUOTA_FILE, JSON.stringify(state))
  } catch {}
}
