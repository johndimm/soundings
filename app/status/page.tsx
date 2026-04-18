'use client'

import { useEffect, useState } from 'react'
import { readStats, clearStats, type CallStats } from '@/app/lib/callTracker'

type PingResult = { ok: boolean; status: number; latencyMs: number; message: string; retryAfterMs?: number }
type YTPingResult = { ok: boolean; quotaExceeded: boolean; searchesRemaining: number; retryAfterMs?: number; message: string }

const WINDOW_MS = 30_000
const SPOTIFY_SAFE_LIMIT = 90
const VIEW_DURATION_MS = 10 * 60_000  // show last 10 minutes on x-axis
const SAMPLE_STEP_MS = 5_000          // green line sampled every 5s

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function relTime(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ${s % 60}s ago`
}

// Rolling 30s window sum at time t
function rollingSum(log: CallStats['log'], t: number) {
  const wStart = t - WINDOW_MS
  return log.filter(e => e.t >= wStart && e.t <= t).reduce((s, e) => s + e.n, 0)
}

interface ChartProps {
  log: CallStats['log']
  safeLimit: number
}

function RateChart({ log, safeLimit }: ChartProps) {
  const now = Date.now()
  const tEnd = now
  const tStart = now - VIEW_DURATION_MS

  // SVG layout
  const W = 800, H = 180
  const padL = 36, padR = 12, padT = 12, padB = 28
  const cW = W - padL - padR
  const cH = H - padT - padB

  const xOf = (t: number) => padL + ((t - tStart) / VIEW_DURATION_MS) * cW

  // Sample green line across the view window
  const samples: { t: number; v: number }[] = []
  for (let t = tStart; t <= tEnd; t += SAMPLE_STEP_MS) {
    samples.push({ t, v: rollingSum(log, t) })
  }
  samples.push({ t: tEnd, v: rollingSum(log, tEnd) })

  const maxY = Math.max(safeLimit * 1.4, ...samples.map(s => s.v), 1)
  const yOf = (v: number) => padT + cH - (v / maxY) * cH

  const linePts = samples.map(s => `${xOf(s.t).toFixed(1)},${yOf(s.v).toFixed(1)}`).join(' ')

  // Visible log entries
  const visible = log.filter(e => e.t >= tStart)
  const barMaxN = Math.max(...visible.map(e => e.n), 1)
  const barW = Math.max(2, cW / (VIEW_DURATION_MS / 1000) * 2) // ~2px per second

  // X-axis tick marks (every 2 minutes)
  const tickEvery = 2 * 60_000
  const ticks: number[] = []
  for (let t = Math.ceil(tStart / tickEvery) * tickEvery; t <= tEnd; t += tickEvery) {
    ticks.push(t)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map(frac => {
        const y = yOf(maxY * frac)
        return (
          <g key={frac}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#27272a" strokeWidth="1" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#52525b">
              {Math.round(maxY * frac)}
            </text>
          </g>
        )
      })}

      {/* Rate limit line (red) */}
      <line
        x1={padL} y1={yOf(safeLimit)}
        x2={W - padR} y2={yOf(safeLimit)}
        stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3"
      />

      {/* Blue bars — individual requests */}
      {visible.map((e, i) => {
        const x = xOf(e.t)
        const barH = (e.n / barMaxN) * (cH * 0.4)
        return (
          <rect
            key={i}
            x={x - barW / 2} y={padT + cH - barH}
            width={barW} height={barH}
            fill="#3b82f6" opacity="0.7"
          />
        )
      })}

      {/* Green rolling window line */}
      <polyline
        points={linePts}
        fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round"
      />

      {/* X axis */}
      <line x1={padL} y1={padT + cH} x2={W - padR} y2={padT + cH} stroke="#3f3f46" strokeWidth="1" />
      {ticks.map(t => (
        <g key={t}>
          <line x1={xOf(t)} y1={padT + cH} x2={xOf(t)} y2={padT + cH + 4} stroke="#3f3f46" strokeWidth="1" />
          <text x={xOf(t)} y={H - 6} textAnchor="middle" fontSize="9" fill="#52525b">
            {new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </text>
        </g>
      ))}

      {/* Legend */}
      <rect x={padL} y={4} width={8} height={8} fill="#3b82f6" opacity="0.7" />
      <text x={padL + 12} y={11} fontSize="9" fill="#a1a1aa">API requests</text>
      <line x1={padL + 80} y1={8} x2={padL + 94} y2={8} stroke="#22c55e" strokeWidth="1.5" />
      <text x={padL + 98} y={11} fontSize="9" fill="#a1a1aa">30s window</text>
      <line x1={padL + 166} y1={8} x2={padL + 180} y2={8} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={padL + 184} y={11} fontSize="9" fill="#a1a1aa">Rate limit (~{safeLimit})</text>
    </svg>
  )
}

export default function StatusPage() {
  const [stats, setStats] = useState<CallStats | null>(null)
  const [pinging, setPinging] = useState(false)
  const [pingResult, setPingResult] = useState<PingResult | null>(null)
  const [ytPinging, setYtPinging] = useState(false)
  const [ytPingResult, setYtPingResult] = useState<YTPingResult | null>(null)

  useEffect(() => {
    setStats(readStats())
    const interval = setInterval(() => setStats(readStats()), 2000)
    return () => clearInterval(interval)
  }, [])

  const ping = async () => {
    setPinging(true)
    setPingResult(null)
    try {
      const res = await fetch('/api/spotify/ping')
      const data: PingResult = await res.json()
      setPingResult(data)
      if (data.ok) {
        // Spotify is responding — clear the stored ban
        try { localStorage.removeItem('spotifyRateLimitUntil') } catch {}
        setStats(readStats())
      } else if (data.retryAfterMs) {
        // Update ban expiry with fresh value from Spotify
        const until = Date.now() + data.retryAfterMs
        try { localStorage.setItem('spotifyRateLimitUntil', String(until)) } catch {}
        setStats(readStats())
      }
    } catch {
      setPingResult({ ok: false, status: 0, latencyMs: 0, message: 'Request failed (network error)' })
    } finally {
      setPinging(false)
    }
  }

  const pingYouTube = async () => {
    setYtPinging(true)
    setYtPingResult(null)
    try {
      const res = await fetch('/api/youtube/ping')
      const data: YTPingResult = await res.json()
      setYtPingResult(data)
    } catch {
      setYtPingResult({ ok: false, quotaExceeded: false, searchesRemaining: 0, message: 'Request failed (network error)' })
    } finally {
      setYtPinging(false)
    }
  }

  if (!stats) return null

  const now = Date.now()
  const callsLastWindow = stats.log
    .filter(e => e.t >= now - WINDOW_MS)
    .reduce((s, e) => s + e.n, 0)

  const peakPct = Math.min(100, Math.round((stats.peakWindow / SPOTIFY_SAFE_LIMIT) * 100))
  const peakColor = peakPct >= 80 ? 'text-red-400' : peakPct >= 50 ? 'text-yellow-400' : 'text-green-400'

  return (
    <div className="min-h-screen bg-white text-black font-mono text-sm">
    <div className="p-8 max-w-[800px] mx-auto">
      <a href="/player" className="text-zinc-400 hover:text-black text-xs mb-6 inline-block transition-colors">← Back to player</a>
      <h1 className="text-lg font-bold mb-6">Spotify call tracker</h1>

      {/* Chart */}
      <section className="mb-8">
        <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Request rate — last 10 minutes</h2>
        <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-200">
          <RateChart log={stats.log} safeLimit={SPOTIFY_SAFE_LIMIT} />
        </div>
        {stats.log.length === 0 && (
          <p className="text-zinc-600 text-xs mt-2">No data yet — use the player to generate calls.</p>
        )}
      </section>

      {/* Ping */}
      <section className="mb-8">
        <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Live Spotify check</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={ping}
            disabled={pinging}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded px-4 py-2 transition-colors"
          >
            {pinging ? 'Testing…' : 'Test /v1/search now'}
          </button>
          {pingResult && (
            <div className={`text-xs px-3 py-2 rounded border ${pingResult.ok ? 'border-green-800 bg-green-950 text-green-300' : 'border-red-900 bg-red-950 text-red-300'}`}>
              <span className="font-bold">{pingResult.ok ? '✓' : '✗'} HTTP {pingResult.status}</span>
              {' · '}
              {pingResult.latencyMs}ms
              {' · '}
              {pingResult.retryAfterMs
                ? `Rate limited until ${new Date(Date.now() + pingResult.retryAfterMs).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                : pingResult.message}
              {pingResult.ok && (
                <span className="text-green-500 ml-2">— ban cleared from storage</span>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Sends a real <code className="text-zinc-500">GET /v1/search?q=test&amp;limit=1</code> to Spotify.
          If it returns 200, the stored ban is cleared and the player can resume.
        </p>
      </section>

      {/* YouTube ping */}
      <section className="mb-8">
        <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Live YouTube check</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={pingYouTube}
            disabled={ytPinging}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded px-4 py-2 transition-colors"
          >
            {ytPinging ? 'Testing…' : 'Test YouTube search now'}
          </button>
          {ytPingResult && (
            <div className={`text-xs px-3 py-2 rounded border ${ytPingResult.ok ? 'border-green-800 bg-green-950 text-green-300' : 'border-red-900 bg-red-950 text-red-300'}`}>
              <span className="font-bold">{ytPingResult.ok ? '✓' : '✗'}</span>
              {' · '}
              {ytPingResult.searchesRemaining} searches remaining today
              {' · '}
              {ytPingResult.quotaExceeded
                ? `Quota exceeded — resets ${ytPingResult.retryAfterMs ? new Date(Date.now() + ytPingResult.retryAfterMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'soon'}`
                : ytPingResult.message}
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Sends a real YouTube Data API <code className="text-zinc-500">search.list</code> call (costs 100 quota units — free tier is 10,000/day).
        </p>
      </section>

      {/* Stats row */}
      <section className="mb-6 flex gap-8">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Now (last 30s)</p>
          <p className="text-xl font-bold text-zinc-200">{callsLastWindow}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Peak (any 30s)</p>
          <p className={`text-xl font-bold ${peakColor}`}>{stats.peakWindow}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Total (10 min)</p>
          <p className="text-xl font-bold text-zinc-200">{stats.totalCalls}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Rate limit</p>
          {stats.rateLimitUntil ? (
            <p className="text-yellow-400 text-sm">
              Blocked until {fmt(stats.rateLimitUntil)}
              <span className="text-zinc-500 ml-1">({Math.ceil((stats.rateLimitUntil - now) / 60_000)} min)</span>
            </p>
          ) : (
            <p className="text-green-400 text-sm">Clear</p>
          )}
        </div>
      </section>

      {/* Call log */}
      <section className="mb-6">
        <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
          Recent fetches ({stats.log.length} in last 10 min)
        </h2>
        {stats.log.length === 0 ? (
          <p className="text-zinc-600">No calls recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {[...stats.log].reverse().map((e, i) => (
              <div key={i} className="flex gap-4 text-xs">
                <span className="text-zinc-400 w-24">{fmt(e.t)}</span>
                <span className="text-zinc-600 w-20">{relTime(e.t)}</span>
                <span className="text-zinc-300">~{e.n} Spotify calls</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        onClick={() => { clearStats(); setStats(readStats()) }}
        className="text-xs text-red-500 hover:text-red-400 border border-red-900 rounded px-3 py-1"
      >
        Clear all stats
      </button>
    </div>
    </div>
  )
}
