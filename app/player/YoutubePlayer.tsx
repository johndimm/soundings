'use client'
import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react'
import { extractYoutubeVideoIdLoose } from '@/app/lib/youtubeVideoId'

// ── Minimal YT IFrame API types ──────────────────────────────────────────────
interface YTPlayer {
  getCurrentTime(): number
  getDuration(): number
  pauseVideo(): void
  playVideo(): void
  destroy(): void
}
interface YTPlayerOptions {
  events?: {
    onStateChange?: (e: { data: number }) => void
    onError?: (e: { data: number }) => void
  }
}
interface YTNamespace {
  Player: new (el: HTMLIFrameElement, opts?: YTPlayerOptions) => YTPlayer
  PlayerState: { ENDED: number }
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

// ── Singleton YT API loader ───────────────────────────────────────────────────
let ytApiReady = false
const ytQueue: (() => void)[] = []

function loadYtApi() {
  if (typeof window === 'undefined') return
  if (window.YT?.Player) { ytApiReady = true; return }
  const prev = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => {
    prev?.()
    ytApiReady = true
    ytQueue.forEach(cb => cb())
    ytQueue.length = 0
  }
  if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  }
}

function whenYtReady(cb: () => void) {
  if (ytApiReady && window.YT?.Player) { cb(); return }
  ytQueue.push(cb)
  loadYtApi()
}

// ─────────────────────────────────────────────────────────────────────────────
const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

interface Props {
  videoId: string
  onEnded?: () => void
  onPlayerError?: (errorCode: number) => void
}

export type YoutubePlayerHandle = {
  fadeOut: () => Promise<void>
  getCurrentTime: () => number
  getDuration: () => number
}

function buildEmbedSrc(videoId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` +
    `?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`
  )
}

const YoutubePlayer = forwardRef<YoutubePlayerHandle, Props>(function YoutubePlayer(
  { videoId, onEnded, onPlayerError },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const ytPlayerRef = useRef<YTPlayer | null>(null)
  const onEndedRef = useRef(onEnded)
  const onErrorRef = useRef(onPlayerError)
  onEndedRef.current = onEnded
  onErrorRef.current = onPlayerError

  const normalizedId = useMemo(() => extractYoutubeVideoIdLoose(videoId) ?? null, [videoId])
  const embedSrc = useMemo(() => (normalizedId ? buildEmbedSrc(normalizedId) : ''), [normalizedId])

  useEffect(() => {
    if (!normalizedId) return
    let destroyed = false

    whenYtReady(() => {
      if (destroyed || !iframeRef.current || !window.YT?.Player) return
      const player = new window.YT.Player(iframeRef.current, {
        events: {
          onStateChange: (e) => {
            // 0 = ENDED
            if (e.data === 0) onEndedRef.current?.()
          },
          onError: (e) => {
            onErrorRef.current?.(e.data)
          },
        },
      })
      ytPlayerRef.current = player
    })

    return () => {
      destroyed = true
      try { ytPlayerRef.current?.destroy() } catch {}
      ytPlayerRef.current = null
    }
  }, [normalizedId])

  useImperativeHandle(ref, () => ({
    fadeOut: async () => {},
    getCurrentTime: () => {
      try { return ytPlayerRef.current?.getCurrentTime() ?? 0 } catch { return 0 }
    },
    getDuration: () => {
      try { return ytPlayerRef.current?.getDuration() ?? 0 } catch { return 0 }
    },
  }), [])

  if (!normalizedId) {
    return (
      <div className="absolute inset-0 z-[6] flex items-center justify-center bg-zinc-950 text-zinc-500 text-sm px-4 text-center">
        Invalid or missing YouTube video id
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-[6]">
      <iframe
        key={embedSrc}
        ref={iframeRef}
        title="YouTube video player"
        src={embedSrc}
        allow={IFRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  )
})

export default YoutubePlayer
