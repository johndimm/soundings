/**
 * Minimal Vercel KV REST client with an in-memory fallback.
 *
 * Production (Vercel with a KV / Upstash store linked): reads `KV_REST_API_URL`
 * and `KV_REST_API_TOKEN` (auto-provisioned by Vercel) and talks to the REST API.
 *
 * Local dev without KV env vars: falls back to a process-local `Map`. Values
 * survive until the dev server restarts, which is good enough for testing share
 * links on one machine. (Same pattern used in johndimm/movie-recs.)
 *
 * We do not depend on `@vercel/kv` — the REST API is trivial to call directly
 * and keeps the bundle small. This module is used by app/api/share/route.ts.
 */

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 90 // 90 days

function getKvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  return { url: url.replace(/\/+$/, ''), token }
}

/**
 * Process-local fallback for `next dev`. Expiry is tracked explicitly so keys
 * time out even without Redis. Survives only until the server restarts.
 */
type MemEntry = { value: string; expiresAt: number }
const memStore: Map<string, MemEntry> = new Map()

function memSet(key: string, value: string, ttlSeconds: number) {
  const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Number.POSITIVE_INFINITY
  memStore.set(key, { value, expiresAt })
}

function memGet(key: string): string | null {
  const entry = memStore.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memStore.delete(key)
    return null
  }
  return entry.value
}

/** True when the backing store is a real (durable) KV; false while falling back to memory. */
export function isKvConfigured(): boolean {
  return getKvConfig() !== null
}

/**
 * Store a JSON-serialisable value under `key`. Returns true on success.
 *
 * Upstash REST accepts commands as a JSON array in the body. The JSON-array
 * form keeps binary-safe values (arbitrary strings, including slashes and
 * spaces) clean, so we use it.
 */
export async function kvSet(
  key: string,
  value: unknown,
  ttlSeconds: number = DEFAULT_TTL_SEC
): Promise<boolean> {
  const serialized = JSON.stringify(value)
  const cfg = getKvConfig()
  if (!cfg) {
    memSet(key, serialized, ttlSeconds)
    return true
  }
  const cmd: (string | number)[] = ['SET', key, serialized]
  if (ttlSeconds > 0) cmd.push('EX', ttlSeconds)
  try {
    const r = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([cmd]),
      cache: 'no-store',
    })
    if (!r.ok) {
      console.warn('[kv] SET failed', r.status, await r.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.warn('[kv] SET threw', e)
    return false
  }
}

/** Fetch a previously-stored JSON value, or null when missing. */
export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const cfg = getKvConfig()
  if (!cfg) {
    const raw = memGet(key)
    if (raw == null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as unknown as T
    }
  }
  try {
    const r = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: 'no-store',
    })
    if (!r.ok) {
      if (r.status === 404) return null
      console.warn('[kv] GET failed', r.status)
      return null
    }
    const body = (await r.json()) as { result?: string | null }
    const raw = body?.result
    if (raw == null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      // Legacy non-JSON value — return the raw string.
      return raw as unknown as T
    }
  } catch (e) {
    console.warn('[kv] GET threw', e)
    return null
  }
}
