import fs from 'fs'
import path from 'path'

import type { LLMProvider } from '@/app/lib/llm'

const LOG_DIR = process.env.VERCEL ? '/tmp/logs' : path.join(process.cwd(), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'llm-spotify-ids.jsonl')

function appendLine(obj: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, line, 'utf8')
  } catch (e) {
    console.warn('[llm-spotify-ids] append failed', e)
  }
  console.info('[llm-spotify-ids]', obj)
}

/** One LLM completion (next-song) with how many rows included a spotifyId string after normalize. */
export function logLlmCallWithModel(params: {
  provider: LLMProvider
  modelId: string
  songCount: number
  idsFromLlm: number
  profileOnly?: boolean
}) {
  appendLine({
    type: 'llm_call',
    provider: params.provider,
    modelId: params.modelId,
    songCount: params.songCount,
    idsFromLlm: params.idsFromLlm,
    profileOnly: params.profileOnly ?? false,
  })
}

/**
 * After GET /v1/tracks?ids= for LLM-supplied ids (only when forceTextSearch is false).
 * verifiedBySpotify = Spotify returned a non-null track for that slot; null = unknown/wrong id.
 */
export function logSpotifyBatchIdOutcome(params: {
  provider: LLMProvider
  modelId: string
  requestedIds: number
  verifiedBySpotify: number
  spotifyReturnedNull: number
}) {
  appendLine({
    type: 'spotify_batch_ids',
    ...params,
  })
}

/** Batch id lookup was not run (e.g. forceTextSearch defaults true — all songs go to Search). */
export function logSpotifyBatchIdsSkipped(params: {
  provider: LLMProvider
  modelId: string
  reason: 'forceTextSearch' | 'no_ids' | 'rate_limited' | 'unauthorized' | 'error'
  idsThatWouldHaveBeenChecked?: number
}) {
  appendLine({
    type: 'spotify_batch_ids_skipped',
    ...params,
  })
}
