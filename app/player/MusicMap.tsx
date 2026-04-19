'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { HistoryEntry } from './SessionPanel'

const CATEGORY_FALLBACK: Record<string, { x: number; y: number; z: number }> = {
  Classical: { x: 12, y: 35, z: 45 },
  'Ambient/New Age': { x: 88, y: 18, z: 25 },
  Jazz: { x: 20, y: 48, z: 35 },
  'Folk/Country': { x: 15, y: 32, z: 50 },
  'Soul/Blues': { x: 38, y: 58, z: 55 },
  'World/Latin': { x: 30, y: 65, z: 30 },
  Pop: { x: 62, y: 52, z: 85 },
  'Hip-Hop/R&B': { x: 72, y: 62, z: 78 },
  Rock: { x: 58, y: 72, z: 72 },
  Electronic: { x: 90, y: 65, z: 40 },
  'Punk/Indie': { x: 52, y: 78, z: 45 },
  Metal: { x: 65, y: 88, z: 60 },
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
  if (!entry.stars) return '#71717a'
  if (entry.stars >= 3.5) return '#22c55e'
  return '#ef4444'
}

/** Player-only: the track now playing before it is rated (then it appears as a normal history dot). */
export type MusicMapCurrentPlaying = {
  uri: string | null
  track: string
  artist: string
  coords?: { x: number; y: number; z?: number }
  category?: string
}

function entryMatchesCurrentPlay(e: HistoryEntry, cur: MusicMapCurrentPlaying): boolean {
  if (cur.uri && e.uri && cur.uri === e.uri) return true
  return e.track === cur.track && e.artist === cur.artist
}

function toLiveHistoryEntry(cur: MusicMapCurrentPlaying): HistoryEntry {
  return {
    track: cur.track,
    artist: cur.artist,
    stars: null,
    uri: cur.uri,
    albumArt: null,
    category: cur.category,
    coords: cur.coords,
  }
}

function drawNowPlayingDot(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  embedded: boolean,
  hasCoords: boolean
) {
  const r = embedded ? 5.5 : 7.5
  ctx.save()
  ctx.beginPath()
  ctx.arc(sx, sy, r + 4, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(250, 250, 250, 0.75)'
  ctx.lineWidth = 2
  ctx.stroke()
  if (!hasCoords) {
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.globalAlpha = hasCoords ? 0.95 : 0.6
  if (hasCoords) {
    ctx.fillStyle = '#fbbf24'
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

function project(
  px: number,
  py: number,
  pz: number,
  rotX: number,
  rotY: number,
  w: number,
  h: number
) {
  const x = ((px - 50) / 50) * w * 0.36
  const y = ((py - 50) / 50) * h * 0.36
  const z = ((pz - 50) / 50) * w * 0.36
  const x1 = x * Math.cos(rotY) + z * Math.sin(rotY)
  const z1 = -x * Math.sin(rotY) + z * Math.cos(rotY)
  const y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX)
  const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX)
  const fov = 900
  const scale = fov / (fov + z2)
  return { sx: w / 2 + x1 * scale, sy: h / 2 + y2 * scale, z: z2 }
}

interface Dart {
  id: number
  toX: number
  toY: number
  startedAt: number
}
const DART_MS = 900

export interface MusicMapProps {
  history: HistoryEntry[]
  width?: number
  height?: number
  /** Compact footer / smaller chrome (sidebar on player) */
  embedded?: boolean
  className?: string
  /** Current deck — shown as a distinct “now playing” marker until rated. */
  currentPlaying?: MusicMapCurrentPlaying | null
  /** When true, the current track is committed to history; use normal dots only. */
  hasRatedCurrent?: boolean
}

export default function MusicMap({
  history,
  width = 800,
  height = 520,
  embedded = false,
  className = '',
  currentPlaying = null,
  hasRatedCurrent = true,
}: MusicMapProps) {
  const [tooltip, setTooltip] = useState<{
    entry: HistoryEntry
    sx: number
    sy: number
    isLive?: boolean
  } | null>(null)
  const [darts, setDarts] = useState<Dart[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotRef = useRef({ x: 0.35, y: -0.55 })
  const draggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const historyRef = useRef<HistoryEntry[]>([])
  const dartsRef = useRef<Dart[]>([])
  const projRef = useRef<{ entry: HistoryEntry; sx: number; sy: number; isLive?: boolean }[]>([])
  const rafRef = useRef<number | null>(null)
  const dartIdRef = useRef(0)
  /** null = not initialized — skip darts on first sync (avoid animating full history on mount). */
  const prevLengthRef = useRef<number | null>(null)
  const wRef = useRef(width)
  const hRef = useRef(height)
  const currentPlayingRef = useRef<MusicMapCurrentPlaying | null>(null)
  const hasRatedCurrentRef = useRef(true)
  wRef.current = width
  hRef.current = height
  currentPlayingRef.current = currentPlaying
  hasRatedCurrentRef.current = hasRatedCurrent

  historyRef.current = history
  dartsRef.current = darts

  const draw = useCallback((now = Date.now()) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = wRef.current
    const H = hRef.current
    const { x: rX, y: rY } = rotRef.current
    const hList = historyRef.current
    const curPlay = currentPlayingRef.current
    const rated = hasRatedCurrentRef.current
    const hForDots =
      curPlay && !rated ? hList.filter(e => !entryMatchesCurrentPlay(e, curPlay)) : hList

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#09090b'
    ctx.roundRect(0, 0, W, H, 12)
    ctx.fill()

    const face = (pz: number, alpha: number) => {
      const fc = [
        project(0, 0, pz, rX, rY, W, H),
        project(100, 0, pz, rX, rY, W, H),
        project(100, 100, pz, rX, rY, W, H),
        project(0, 100, pz, rX, rY, W, H),
      ]
      ctx.globalAlpha = alpha
      ctx.strokeStyle = '#71717a'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      fc.forEach((c, i) => (i === 0 ? ctx.moveTo(c.sx, c.sy) : ctx.lineTo(c.sx, c.sy)))
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
      return fc
    }
    const front = face(0, 0.5)
    const back = face(100, 0.9)

    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 1.5
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo(front[i].sx, front[i].sy)
      ctx.lineTo(back[i].sx, back[i].sy)
      ctx.stroke()
    }

    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 1
    const vm = [project(50, 0, 50, rX, rY, W, H), project(50, 100, 50, rX, rY, W, H)]
    const hm = [project(0, 50, 50, rX, rY, W, H), project(100, 50, 50, rX, rY, W, H)]
    ctx.beginPath()
    ctx.moveTo(vm[0].sx, vm[0].sy)
    ctx.lineTo(vm[1].sx, vm[1].sy)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(hm[0].sx, hm[0].sy)
    ctx.lineTo(hm[1].sx, hm[1].sy)
    ctx.stroke()

    const labelFont = embedded ? '7px monospace' : '9px monospace'
    ctx.font = labelFont
    ctx.fillStyle = '#71717a'
    const labelPad = embedded ? 3 : 6
    const [tl, tr, br, bl] = back
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText('acoustic · calm', tl.sx + labelPad, tl.sy - labelPad)
    ctx.textAlign = 'right'
    ctx.fillText('electronic · calm', tr.sx - labelPad, tr.sy - labelPad)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('electronic · intense', br.sx - labelPad, br.sy + labelPad)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('acoustic · intense', bl.sx + labelPad, bl.sy + labelPad)

    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#71717a'
    ctx.fillText('← underground  mainstream →', front[0].sx - 4, (front[0].sy + back[0].sy) / 2)

    if (!embedded) {
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const [name, pos] of Object.entries(CATEGORY_FALLBACK)) {
        const p = project(pos.x, pos.y, pos.z, rX, rY, W, H)
        const label = name.split('/')[0]
        ctx.strokeStyle = '#09090b'
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.strokeText(label, p.sx, p.sy)
        ctx.fillStyle = '#a1a1aa'
        ctx.fillText(label, p.sx, p.sy)
      }
    }

    const projected = hForDots.map(entry => {
      const { x, y, z } = resolveCoords(entry)
      const p = project(x + jitter(entry.track, 6), y + jitter(entry.artist, 6), z, rX, rY, W, H)
      return { entry, sx: p.sx, sy: p.sy, z: p.z }
    })
    projected.sort((a, b) => b.z - a.z)

    const rows: { entry: HistoryEntry; sx: number; sy: number; isLive?: boolean }[] = projected.map(
      ({ entry, sx, sy }) => ({ entry, sx, sy })
    )
    let liveSx: number | null = null
    let liveSy: number | null = null
    let liveEntry: HistoryEntry | null = null
    if (curPlay && !rated) {
      liveEntry = toLiveHistoryEntry(curPlay)
      const { x, y, z } = resolveCoords(liveEntry)
      const p = project(
        x + jitter(liveEntry.track, 6),
        y + jitter(liveEntry.artist, 6),
        z,
        rX,
        rY,
        W,
        H
      )
      liveSx = p.sx
      liveSy = p.sy
      rows.push({ entry: liveEntry, sx: p.sx, sy: p.sy, isLive: true })
    }
    projRef.current = rows

    for (const { entry, sx, sy } of projected) {
      const color = dotColor(entry)
      const hasCoords = !!entry.coords
      ctx.globalAlpha = hasCoords ? 0.85 : 0.45
      if (!hasCoords) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(sx, sy, embedded ? 3 : 4, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(sx, sy, embedded ? 4 : 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    if (liveEntry != null && liveSx != null && liveSy != null) {
      drawNowPlayingDot(ctx, liveSx, liveSy, embedded, !!liveEntry.coords)
    }

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
      ctx.strokeStyle = '#facc15'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(cx, cy)
      ctx.stroke()
      ctx.fillStyle = '#facc15'
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(cx, cy, embedded ? 4 : 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }, [embedded])

  useEffect(() => {
    if (darts.length === 0) return
    const tick = () => {
      draw(Date.now())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [darts.length, draw])

  useEffect(() => {
    if (darts.length === 0) draw()
  }, [history, darts.length, draw, currentPlaying?.uri, currentPlaying?.track, hasRatedCurrent])

  useEffect(() => {
    draw()
  }, [width, height, draw])

  useEffect(() => {
    if (prevLengthRef.current === null) {
      prevLengthRef.current = history.length
      return
    }
    if (history.length > prevLengthRef.current) {
      const newEntries = history.slice(prevLengthRef.current)
      const launchTime = Date.now()
      const W = wRef.current
      const H = hRef.current
      newEntries.forEach((entry, i) => {
        const { x, y, z } = resolveCoords(entry)
        const { sx: toX, sy: toY } = project(
          x + jitter(entry.track, 6),
          y + jitter(entry.artist, 6),
          z,
          rotRef.current.x,
          rotRef.current.y,
          W,
          H
        )
        const dart: Dart = { id: ++dartIdRef.current, toX, toY, startedAt: launchTime + i * 150 }
        setDarts(d => [...d, dart])
        setTimeout(() => setDarts(d => d.filter(dd => dd.id !== dart.id)), DART_MS + 400)
      })
    }
    prevLengthRef.current = history.length
  }, [history])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true
    lastMouseRef.current = { x: e.clientX, y: e.clientY }
    setTooltip(null)
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const W = wRef.current
      const H = hRef.current
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
        let minDist = Infinity
        for (const row of projRef.current) {
          const { entry, sx, sy, isLive } = row
          const hitR = isLive ? (embedded ? 22 : 28) : embedded ? 10 : 14
          const d = Math.hypot(mx - sx, my - sy)
          if (d < hitR && d < minDist) {
            minDist = d
            nearest = { entry, sx, sy, isLive }
          }
        }
        setTooltip(nearest)
      }
    },
    [draw, embedded]
  )

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }, [])

  const lastTouchRef = useRef({ x: 0, y: 0 })

  // Attach touch handlers with { passive: false } so preventDefault() actually works.
  // React registers touch listeners as passive by default, which silently ignores preventDefault().
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1)
        lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
    const onTouchMove = (e: TouchEvent) => {
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
    }
    const onTouchEnd = () => { draggingRef.current = false }
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [draw])

  return (
    <div className={`relative ${className}`}>
      <div className="relative inline-block w-full">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full rounded-xl border border-zinc-800 cursor-grab block"
          style={{ maxHeight: embedded ? 280 : undefined }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {tooltip &&
          (() => {
            const { entry, sx, sy, isLive } = tooltip
            const { x, y, estimated } = resolveCoords(entry)
            const left = (sx / width) * 100
            const top = (sy / height) * 100
            const alignRight = left > 65
            return (
              <div
                className="absolute z-10 pointer-events-none rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-[11px] whitespace-nowrap"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  transform: alignRight ? 'translate(-100%, -120%)' : 'translate(8px, -120%)',
                }}
              >
                <div className="text-zinc-200">
                  {entry.track} — {entry.artist}
                </div>
                {isLive ? (
                  <div className="text-amber-400">Now playing · rate to save</div>
                ) : (
                  <div style={{ color: dotColor(entry) }}>
                    {entry.stars !== null && entry.stars !== undefined ? `★${entry.stars}` : '(skipped)'}
                    {estimated ? ' · est. pos' : ` · (${Math.round(x)}, ${Math.round(y)})`}
                  </div>
                )}
                {entry.category && <div className="text-zinc-500 text-[10px]">{entry.category}</div>}
              </div>
            )
          })()}
      </div>

      {!embedded && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-zinc-500">
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
            <span
              className="w-3 h-3 rounded-full border-2 border-white/70 bg-amber-400 inline-block"
              title="Current track before you rate"
            />{' '}
            now playing
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" /> dart = new pick
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden>
              <circle cx="6" cy="6" r="5" fill="none" stroke="#22c55e" strokeWidth="1.5" opacity="0.5" />
            </svg>
            estimated position
          </span>
        </div>
      )}

      {history.length === 0 && (
        <p className="text-zinc-600 text-xs mt-2 font-mono">No history yet.</p>
      )}
    </div>
  )
}
