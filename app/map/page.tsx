'use client'

import { useEffect, useRef, useState } from 'react'
import { GUIDE_DEMO_MAP_HISTORY } from '@/app/lib/guideDemo'

interface HistoryEntry {
  track: string
  artist: string
  percentListened: number
  reaction: string
  albumArt: string | null
  uri: string | null
  category?: string
  coords?: { x: number; y: number }
}

// Fallback category positions (used only if entry has no LLM-assigned coords)
// X: acoustic(0) → electronic(100)
// Y: calm(0) → intense(100)
const CATEGORY_FALLBACK: Record<string, { x: number; y: number }> = {
  'Classical':       { x: 12, y: 35 },
  'Ambient/New Age': { x: 88, y: 18 },
  'Jazz':            { x: 20, y: 48 },
  'Folk/Country':    { x: 15, y: 32 },
  'Soul/Blues':      { x: 38, y: 58 },
  'World/Latin':     { x: 30, y: 65 },
  'Pop':             { x: 62, y: 52 },
  'Hip-Hop/R&B':     { x: 72, y: 62 },
  'Rock':            { x: 58, y: 72 },
  'Electronic':      { x: 90, y: 65 },
  'Punk/Indie':      { x: 52, y: 78 },
  'Metal':           { x: 65, y: 88 },
}

const CENTER = { x: 50, y: 50 }

function resolveCoords(entry: HistoryEntry): { x: number; y: number; estimated: boolean } {
  // Tier 1: LLM-assigned coords
  if (entry.coords) return { ...entry.coords, estimated: false }
  // Tier 2: category fallback
  if (entry.category) {
    for (const [key, val] of Object.entries(CATEGORY_FALLBACK)) {
      if (entry.category.startsWith(key) || entry.category.toLowerCase().includes(key.toLowerCase())) {
        return { ...val, estimated: true }
      }
    }
  }
  // Tier 3: center
  return { ...CENTER, estimated: true }
}

// Deterministic jitter so dots in the same region don't stack exactly
function jitter(seed: string, range: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  }
  return ((h & 0xffff) / 0xffff - 0.5) * range
}

function dotColor(entry: HistoryEntry): string {
  if (entry.reaction === 'not-now') return '#71717a'
  if (entry.percentListened >= 50) return '#22c55e'
  return '#ef4444'
}

interface Dart {
  id: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  startedAt: number
}

const DART_DURATION_MS = 900

const SVG_W = 800
const SVG_H = 520
const PAD = 48

function toSvgX(pct: number) { return PAD + (pct / 100) * (SVG_W - PAD * 2) }
function toSvgY(pct: number) { return PAD + (pct / 100) * (SVG_H - PAD * 2) }

export default function MapPage() {
  const [guideDemo, setGuideDemo] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('guide-demo') === '1'
  })
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [darts, setDarts] = useState<Dart[]>([])
  const [now, setNow] = useState(Date.now())
  const [tooltip, setTooltip] = useState<{ entry: HistoryEntry; svgX: number; svgY: number } | null>(null)
  const dartIdRef = useRef(0)
  const prevLengthRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setGuideDemo(new URLSearchParams(window.location.search).get('guide-demo') === '1')
  }, [])

  // Drive dart animation
  useEffect(() => {
    if (darts.length === 0) return
    const tick = () => {
      setNow(Date.now())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [darts.length])

  // Load history from localStorage every 2s, launch darts for new entries
  useEffect(() => {
    if (guideDemo) {
      prevLengthRef.current = GUIDE_DEMO_MAP_HISTORY.length
      setHistory(GUIDE_DEMO_MAP_HISTORY)
      return
    }

    function load() {
      try {
        const raw = localStorage.getItem('earprint-history')
        if (!raw) { setHistory([]); prevLengthRef.current = 0; return }
        const entries: HistoryEntry[] = JSON.parse(raw)
        if (entries.length > prevLengthRef.current) {
          const newEntries = entries.slice(prevLengthRef.current)
          const launchTime = Date.now()
          newEntries.forEach((entry, i) => {
            const { x, y } = resolveCoords(entry)
            const toX = toSvgX(x + jitter(entry.track, 6))
            const toY = toSvgY(y + jitter(entry.artist, 6))
            const dart: Dart = {
              id: ++dartIdRef.current,
              fromX: SVG_W / 2,
              fromY: -24,
              toX,
              toY,
              startedAt: launchTime + i * 150, // stagger multiple darts
            }
            setDarts(d => [...d, dart])
            setTimeout(() => setDarts(d => d.filter(dd => dd.id !== dart.id)), DART_DURATION_MS + 400)
          })
        }
        prevLengthRef.current = entries.length
        setHistory(entries)
      } catch {}
    }
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [guideDemo])

  const estimatedCount = history.filter(e => !e.coords).length

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono">
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => { if (window.opener) window.close(); else window.location.href = '/player' }}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
        >← Player</button>
        <h1 className="text-base font-bold">Music Map</h1>
        <span className="text-zinc-600 text-xs">{history.length} songs heard</span>
        {estimatedCount > 0 && (
          <span className="text-zinc-700 text-xs">{estimatedCount} with estimated position</span>
        )}
      </div>

      {/* Axis labels */}
      <div className="flex gap-2 items-start">
        <div
          className="text-[10px] text-zinc-600 flex-shrink-0 select-none"
          style={{ writingMode: 'vertical-lr' as const, transform: 'rotate(180deg)', height: SVG_H, lineHeight: 1 }}
        >
          calm ↑ · intense ↓
        </div>

        <div>
          <div className="text-[10px] text-zinc-600 mb-1 select-none" style={{ marginLeft: 0 }}>
            ← acoustic · electronic →
          </div>
          <svg
            data-guide="music-map"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            width={SVG_W}
            height={SVG_H}
            className="block"
            style={{ background: '#09090b', borderRadius: 12, border: '1px solid #27272a' }}
          >
            {/* Category zone landmarks */}
            {Object.entries(CATEGORY_FALLBACK).map(([name, { x, y }]) => (
              <text
                key={name}
                x={toSvgX(x)}
                y={toSvgY(y)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fill="#52525b"
                fontFamily="monospace"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {name.split('/')[0]}
              </text>
            ))}

            {/* Quadrant dividers */}
            <line x1={SVG_W / 2} y1={PAD} x2={SVG_W / 2} y2={SVG_H - PAD} stroke="#1c1c1e" strokeWidth="1" />
            <line x1={PAD} y1={SVG_H / 2} x2={SVG_W - PAD} y2={SVG_H / 2} stroke="#1c1c1e" strokeWidth="1" />

            {/* Quadrant labels */}
            <text x={PAD + 8} y={PAD + 16} fontSize="9" fill="#27272a" fontFamily="monospace">acoustic · calm</text>
            <text x={SVG_W - PAD - 8} y={PAD + 16} fontSize="9" fill="#27272a" fontFamily="monospace" textAnchor="end">electronic · calm</text>
            <text x={PAD + 8} y={SVG_H - PAD - 8} fontSize="9" fill="#27272a" fontFamily="monospace">acoustic · intense</text>
            <text x={SVG_W - PAD - 8} y={SVG_H - PAD - 8} fontSize="9" fill="#27272a" fontFamily="monospace" textAnchor="end">electronic · intense</text>

            {/* Estimated-position dots (dimmer, dashed border) */}
            {history.map((entry, i) => {
              if (!entry.coords) return null  // drawn in next pass
              const { x, y } = resolveCoords(entry)
              const cx = toSvgX(x + jitter(entry.track, 6))
              const cy = toSvgY(y + jitter(entry.artist, 6))
              return (
                <circle
                  key={`est-${i}`}
                  cx={cx} cy={cy} r={4}
                  fill="none"
                  stroke={dotColor(entry)}
                  strokeWidth="1.5"
                  opacity={0.45}
                />
              )
            })}

            {/* Confirmed-position dots (solid) */}
            {history.map((entry, i) => {
              if (!entry.coords) return null
              const { x, y } = resolveCoords(entry)
              const cx = toSvgX(x + jitter(entry.track, 6))
              const cy = toSvgY(y + jitter(entry.artist, 6))
              const color = dotColor(entry)
              return (
                <circle
                  key={`confirmed-${i}`}
                  cx={cx} cy={cy} r={5}
                  fill={color}
                  opacity={0.85}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setTooltip({ entry, svgX: cx, svgY: cy })}
                  onMouseLeave={() => setTooltip(null)}
                />
              )
            })}

            {/* Estimated dots (rendered on top of the circles above for entries without coords) */}
            {history.map((entry, i) => {
              if (entry.coords) return null
              const { x, y } = resolveCoords(entry)
              const cx = toSvgX(x + jitter(entry.track, 6))
              const cy = toSvgY(y + jitter(entry.artist, 6))
              const color = dotColor(entry)
              return (
                <circle
                  key={`est2-${i}`}
                  cx={cx} cy={cy} r={4}
                  fill={color}
                  opacity={0.45}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setTooltip({ entry, svgX: cx, svgY: cy })}
                  onMouseLeave={() => setTooltip(null)}
                />
              )
            })}

            {/* Darts */}
            {darts.map(dart => {
              const elapsed = Math.max(0, now - dart.startedAt)
              const t = Math.min(1, elapsed / DART_DURATION_MS)
              // ease out cubic
              const ease = 1 - Math.pow(1 - t, 3)
              const cx = dart.fromX + (dart.toX - dart.fromX) * ease
              const cy = dart.fromY + (dart.toY - dart.fromY) * ease
              const tailT = Math.max(0, ease - 0.2)
              const tailX = dart.fromX + (dart.toX - dart.fromX) * tailT
              const tailY = dart.fromY + (dart.toY - dart.fromY) * tailT
              return (
                <g key={dart.id}>
                  <line x1={tailX} y1={tailY} x2={cx} y2={cy} stroke="#facc15" strokeWidth={2} opacity={0.4} />
                  <circle cx={cx} cy={cy} r={6} fill="#facc15" opacity={0.9} />
                </g>
              )
            })}

            {/* Tooltip */}
            {tooltip && (() => {
              const { entry, svgX, svgY } = tooltip
              const { x, y, estimated } = resolveCoords(entry)
              const line1 = `${entry.track} — ${entry.artist}`
              const line2 = `${Math.round(entry.percentListened)}%${estimated ? ' · est. pos' : ` · (${Math.round(x)}, ${Math.round(y)})`}`
              const line3 = entry.category ?? ''
              const w = Math.max(line1.length, line2.length, line3.length) * 6.2 + 16
              const h = line3 ? 46 : 32
              const tx = Math.min(svgX + 10, SVG_W - w - 4)
              const ty = Math.max(svgY - h - 4, 4)
              return (
                <g>
                  <rect x={tx - 4} y={ty - 2} width={w} height={h} rx={4} fill="#18181b" stroke="#3f3f46" />
                  <text x={tx} y={ty + 10} fontSize="10" fill="#e4e4e7" fontFamily="monospace">{line1}</text>
                  <text x={tx} y={ty + 23} fontSize="10" fill={dotColor(entry)} fontFamily="monospace">{line2}</text>
                  {line3 && <text x={tx} y={ty + 36} fontSize="9" fill="#71717a" fontFamily="monospace">{line3}</text>}
                </g>
              )
            })()}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-6 mt-3 text-xs text-zinc-500 ml-6">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> liked (≥50%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> disliked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-zinc-500 inline-block" /> not-now
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" /> dart = new pick
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke="#22c55e" strokeWidth="1.5" opacity="0.5" /></svg>
          estimated position (no coords yet)
        </span>
        <span className="ml-auto text-zinc-700">updates every 2s</span>
      </div>

      {history.length === 0 && (
        <p className="text-zinc-600 text-xs mt-4 ml-6">No history yet — go listen to some songs in the player.</p>
      )}
    </div>
  )
}
