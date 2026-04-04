'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { GUIDE_DEMO_MAP_HISTORY } from '@/app/lib/guideDemo'

interface HistoryEntry {
  track: string
  artist: string
  percentListened: number
  reaction: string
  albumArt: string | null
  uri: string | null
  category?: string
  coords?: { x: number; y: number; z?: number }
}

const CATEGORY_FALLBACK: Record<string, { x: number; y: number; z: number }> = {
  'Classical':       { x: 12, y: 35, z: 45 },
  'Ambient/New Age': { x: 88, y: 18, z: 25 },
  'Jazz':            { x: 20, y: 48, z: 35 },
  'Folk/Country':    { x: 15, y: 32, z: 50 },
  'Soul/Blues':      { x: 38, y: 58, z: 55 },
  'World/Latin':     { x: 30, y: 65, z: 30 },
  'Pop':             { x: 62, y: 52, z: 85 },
  'Hip-Hop/R&B':     { x: 72, y: 62, z: 78 },
  'Rock':            { x: 58, y: 72, z: 72 },
  'Electronic':      { x: 90, y: 65, z: 40 },
  'Punk/Indie':      { x: 52, y: 78, z: 45 },
  'Metal':           { x: 65, y: 88, z: 60 },
}

function categoryFallback(category: string | undefined): { x: number; y: number; z: number } | null {
  if (!category) return null
  for (const [key, val] of Object.entries(CATEGORY_FALLBACK)) {
    if (category.startsWith(key) || category.toLowerCase().includes(key.toLowerCase())) return val
  }
  return null
}

function resolveCoords(entry: HistoryEntry): { x: number; y: number; z: number; estimated: boolean } {
  if (entry.coords) {
    // When z is missing (old data), fall back to category z so tracks spread in depth
    const z = entry.coords.z ?? categoryFallback(entry.category)?.z ?? 50
    return { x: entry.coords.x, y: entry.coords.y, z, estimated: false }
  }
  const fb = categoryFallback(entry.category)
  if (fb) return { ...fb, estimated: true }
  return { x: 50, y: 50, z: 50, estimated: true }
}

function jitter(seed: string, range: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return ((h & 0xffff) / 0xffff - 0.5) * range
}

function dotColor(entry: HistoryEntry): string {
  if (entry.reaction === 'not-now') return '#71717a'
  if (entry.percentListened >= 50) return '#22c55e'
  return '#ef4444'
}

const W = 800
const H = 520

// Project a point in [0,100]³ space into canvas 2D with 3D rotation
// x=acoustic/electronic  y=calm/intense  z=obscure/mainstream
function project(px: number, py: number, pz: number, rotX: number, rotY: number) {
  const x = (px - 50) / 50 * W * 0.36
  const y = (py - 50) / 50 * H * 0.36
  const z = (pz - 50) / 50 * W * 0.36   // z mapped same scale as x

  // Rotate around Y axis (spins left/right, moves x into z)
  const x1 = x * Math.cos(rotY) + z * Math.sin(rotY)
  const z1 = -x * Math.sin(rotY) + z * Math.cos(rotY)

  // Rotate around X axis (tilts up/down, moves y into z)
  const y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX)
  const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX)

  const fov = 900
  const scale = fov / (fov + z2)
  return { sx: W / 2 + x1 * scale, sy: H / 2 + y2 * scale, z: z2 }
}

interface Dart {
  id: number
  toX: number; toY: number
  startedAt: number
}
const DART_MS = 900

export default function MapPage() {
  const [guideDemo, setGuideDemo] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [tooltip, setTooltip] = useState<{ entry: HistoryEntry; sx: number; sy: number } | null>(null)
  const [darts, setDarts] = useState<Dart[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotRef = useRef({ x: 0.35, y: -0.55 })   // default tilt — shows depth
  const draggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const historyRef = useRef<HistoryEntry[]>([])
  const dartsRef = useRef<Dart[]>([])
  const projRef = useRef<{ entry: HistoryEntry; sx: number; sy: number }[]>([])
  const rafRef = useRef<number | null>(null)
  const dartIdRef = useRef(0)
  const prevLengthRef = useRef(0)

  historyRef.current = history
  dartsRef.current = darts

  // ── Core draw function — reads refs, no React state ──────────────────────
  const draw = useCallback((now = Date.now()) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { x: rX, y: rY } = rotRef.current
    const h = historyRef.current

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#09090b'
    ctx.roundRect(0, 0, W, H, 12)
    ctx.fill()

    // Draw a wireframe box to show the 3D volume
    // Front face (z=0, underground) and back face (z=100, mainstream)
    const face = (pz: number, alpha: number) => {
      const fc = [project(0,0,pz,rX,rY), project(100,0,pz,rX,rY), project(100,100,pz,rX,rY), project(0,100,pz,rX,rY)]
      ctx.globalAlpha = alpha
      ctx.strokeStyle = '#27272a'
      ctx.lineWidth = 1
      ctx.beginPath()
      fc.forEach((c, i) => i === 0 ? ctx.moveTo(c.sx, c.sy) : ctx.lineTo(c.sx, c.sy))
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
      return fc
    }
    const front = face(0, 0.4)    // underground face
    const back  = face(100, 0.7)  // mainstream face

    // Connecting edges at corners
    ctx.strokeStyle = '#1c1c1e'
    ctx.lineWidth = 1
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(front[i].sx, front[i].sy); ctx.lineTo(back[i].sx, back[i].sy); ctx.stroke()
    }

    // Quadrant dividers on the mid-z slice (z=50)
    ctx.strokeStyle = '#1c1c1e'
    ctx.lineWidth = 0.5
    const vm = [project(50, 0, 50, rX, rY), project(50, 100, 50, rX, rY)]
    const hm = [project(0, 50, 50, rX, rY), project(100, 50, 50, rX, rY)]
    ctx.beginPath(); ctx.moveTo(vm[0].sx, vm[0].sy); ctx.lineTo(vm[1].sx, vm[1].sy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(hm[0].sx, hm[0].sy); ctx.lineTo(hm[1].sx, hm[1].sy); ctx.stroke()

    // Axis labels on the back face corners
    ctx.font = '9px monospace'
    ctx.fillStyle = '#3f3f46'
    const labelPad = 6
    const [tl, tr, br, bl] = back
    ctx.textAlign = 'left';  ctx.textBaseline = 'bottom'; ctx.fillText('acoustic · calm',     tl.sx + labelPad, tl.sy - labelPad)
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('electronic · calm',   tr.sx - labelPad, tr.sy - labelPad)
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';    ctx.fillText('electronic · intense', br.sx - labelPad, br.sy + labelPad)
    ctx.textAlign = 'left';  ctx.textBaseline = 'top';    ctx.fillText('acoustic · intense',  bl.sx + labelPad, bl.sy + labelPad)

    // Z axis label (popularity depth)
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillStyle = '#52525b'
    ctx.fillText('← underground  mainstream →', front[0].sx - 4, (front[0].sy + back[0].sy) / 2)

    // Category zone labels at their z positions
    ctx.font = 'bold 11px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [name, pos] of Object.entries(CATEGORY_FALLBACK)) {
      const p = project(pos.x, pos.y, pos.z, rX, rY)
      const label = name.split('/')[0]
      // Dark halo for readability
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeText(label, p.sx, p.sy)
      ctx.fillStyle = '#a1a1aa'
      ctx.fillText(label, p.sx, p.sy)
    }

    // Project dots, sort back-to-front
    const projected = h.map(entry => {
      const { x, y, z } = resolveCoords(entry)
      const p = project(x + jitter(entry.track, 6), y + jitter(entry.artist, 6), z, rX, rY)
      return { entry, sx: p.sx, sy: p.sy, z: p.z }
    })
    projected.sort((a, b) => b.z - a.z)
    projRef.current = projected.map(({ entry, sx, sy }) => ({ entry, sx, sy }))

    for (const { entry, sx, sy } of projected) {
      const color = dotColor(entry)
      const hasCoords = !!entry.coords
      ctx.globalAlpha = hasCoords ? 0.85 : 0.45
      if (!hasCoords) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    // Darts
    for (const dart of dartsRef.current) {
      const elapsed = Math.max(0, now - dart.startedAt)
      const t = Math.min(1, elapsed / DART_MS)
      const ease = 1 - Math.pow(1 - t, 3)
      const fromX = W / 2
      const fromY = -24
      const cx = fromX + (dart.toX - fromX) * ease
      const cy = fromY + (dart.toY - fromY) * ease
      const tailEase = Math.max(0, ease - 0.2)
      const tx = fromX + (dart.toX - fromX) * tailEase
      const ty = fromY + (dart.toY - fromY) * tailEase
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(cx, cy); ctx.stroke()
      ctx.fillStyle = '#facc15'; ctx.globalAlpha = 0.9
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    }
  }, [])

  // Animate darts via RAF
  useEffect(() => {
    if (darts.length === 0) return
    const tick = () => {
      draw(Date.now())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [darts.length, draw])

  // Redraw when history changes (no darts active)
  useEffect(() => {
    if (darts.length === 0) draw()
  }, [history, darts.length, draw])

  // ── Load history from localStorage ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    setGuideDemo(new URLSearchParams(window.location.search).get('guide-demo') === '1')
  }, [])

  useEffect(() => {
    if (guideDemo) {
      prevLengthRef.current = GUIDE_DEMO_MAP_HISTORY.length
      setHistory(GUIDE_DEMO_MAP_HISTORY as HistoryEntry[])
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
            const { x, y, z } = resolveCoords(entry)
            const { sx: toX, sy: toY } = project(
              x + jitter(entry.track, 6),
              y + jitter(entry.artist, 6),
              z,
              rotRef.current.x, rotRef.current.y
            )
            const dart: Dart = { id: ++dartIdRef.current, toX, toY, startedAt: launchTime + i * 150 }
            setDarts(d => [...d, dart])
            setTimeout(() => setDarts(d => d.filter(dd => dd.id !== dart.id)), DART_MS + 400)
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

  // ── Mouse / touch drag ────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true
    lastMouseRef.current = { x: e.clientX, y: e.clientY }
    setTooltip(null)
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) {
      const dx = e.clientX - lastMouseRef.current.x
      const dy = e.clientY - lastMouseRef.current.y
      lastMouseRef.current = { x: e.clientX, y: e.clientY }
      rotRef.current = {
        x: Math.max(-1.2, Math.min(1.2, rotRef.current.x + dy * 0.006)),
        y: rotRef.current.y + dx * 0.006,
      }
      draw()
    } else {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = (e.clientX - rect.left) * (W / rect.width)
      const my = (e.clientY - rect.top) * (H / rect.height)
      let nearest: typeof tooltip = null
      let minDist = 14
      for (const { entry, sx, sy } of projRef.current) {
        const d = Math.hypot(mx - sx, my - sy)
        if (d < minDist) { minDist = d; nearest = { entry, sx, sy } }
      }
      setTooltip(nearest)
    }
  }, [draw])

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }, [])

  const lastTouchRef = useRef({ x: 0, y: 0 })
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length !== 1) return
    const dx = e.touches[0].clientX - lastTouchRef.current.x
    const dy = e.touches[0].clientY - lastTouchRef.current.y
    lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    rotRef.current = {
      x: Math.max(-1.2, Math.min(1.2, rotRef.current.x + dy * 0.006)),
      y: rotRef.current.y + dx * 0.006,
    }
    draw()
  }, [draw])

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
        <span className="text-zinc-700 text-xs ml-auto">drag to rotate</span>
      </div>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ borderRadius: 12, border: '1px solid #27272a', cursor: 'grab', maxWidth: '100%', display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => { draggingRef.current = false }}
        />

        {/* Tooltip as HTML overlay */}
        {tooltip && (() => {
          const { entry, sx, sy } = tooltip
          const { x, y, estimated } = resolveCoords(entry)
          const left = (sx / W) * 100
          const top = (sy / H) * 100
          const alignRight = left > 65
          return (
            <div
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                transform: alignRight ? 'translate(-100%, -120%)' : 'translate(8px, -120%)',
                pointerEvents: 'none',
                background: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                padding: '5px 8px',
                fontSize: 11,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                zIndex: 10,
              }}
            >
              <div style={{ color: '#e4e4e7' }}>{entry.track} — {entry.artist}</div>
              <div style={{ color: dotColor(entry) }}>
                {Math.round(entry.percentListened)}%
                {estimated ? ' · est. pos' : ` · (${Math.round(x)}, ${Math.round(y)})`}
              </div>
              {entry.category && <div style={{ color: '#71717a', fontSize: 10 }}>{entry.category}</div>}
            </div>
          )
        })()}
      </div>

      <div className="flex gap-6 mt-3 text-xs text-zinc-500">
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
          estimated position
        </span>
        <span className="ml-auto text-zinc-700">updates every 2s</span>
      </div>

      {history.length === 0 && (
        <p className="text-zinc-600 text-xs mt-4">No history yet — go listen to some songs in the player.</p>
      )}
    </div>
  )
}
