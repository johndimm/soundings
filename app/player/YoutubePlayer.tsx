'use client'
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'

declare global {
  interface Window {
    YT: {
      Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

interface YTPlayerOptions {
  videoId: string
  playerVars?: Record<string, number | string>
  events?: {
    onReady?: () => void
    onStateChange?: (e: { data: number }) => void
    onError?: (e: { data: number }) => void
  }
}

/** iframe API player — volume control used for channel-switch fades */
interface YTPlayer {
  loadVideoById(videoId: string): void
  destroy(): void
  pauseVideo(): void
  playVideo(): void
  setVolume(volume: number): void
  getVolume(): number
}

const FADE_DURATION_MS = 700
const FADE_STEPS = 20

async function fadeYoutubeVolume(player: YTPlayer, fromPct: number, toPct: number) {
  const stepMs = FADE_DURATION_MS / FADE_STEPS
  for (let i = 1; i <= FADE_STEPS; i++) {
    const v = fromPct + (toPct - fromPct) * (i / FADE_STEPS)
    try {
      player.setVolume(Math.max(0, Math.min(100, Math.round(v))))
    } catch {
      /* ignore */
    }
    await new Promise(r => setTimeout(r, stepMs))
  }
}

interface Props {
  videoId: string
  /** Called when video finishes (auto-advance). */
  onEnded?: () => void
}

export type YoutubePlayerHandle = {
  /** Animate volume to 0 then pause (e.g. before switching channel). */
  fadeOut: () => Promise<void>
}

let apiLoading = false

function loadYTApi(onReady: () => void) {
  if (window.YT?.Player) {
    onReady()
    return
  }
  const prev = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => {
    prev?.()
    onReady()
  }
  if (!apiLoading) {
    apiLoading = true
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  }
}

const YoutubePlayer = forwardRef<YoutubePlayerHandle, Props>(function YoutubePlayer(
  { videoId, onEnded },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const currentVideoIdRef = useRef(videoId)

  useImperativeHandle(
    ref,
    () => ({
      fadeOut: async () => {
        const p = playerRef.current
        if (!p) return
        try {
          let start = 100
          try {
            start = p.getVolume()
          } catch {
            start = 100
          }
          await fadeYoutubeVolume(p, start, 0)
          p.pauseVideo()
        } catch {
          try {
            p.pauseVideo()
          } catch {
            /* ignore */
          }
        }
      },
    }),
    []
  )

  // When videoId changes while player is alive, load the new video
  useEffect(() => {
    currentVideoIdRef.current = videoId
    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId)
    }
  }, [videoId])

  // Mount / unmount: create the YT.Player once
  useEffect(() => {
    let destroyed = false

    loadYTApi(() => {
      if (destroyed || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: currentVideoIdRef.current,
        playerVars: {
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onStateChange: e => {
            if (e.data === window.YT?.PlayerState?.ENDED) {
              onEndedRef.current?.()
            }
          },
        },
      }) as unknown as YTPlayer
    })

    return () => {
      destroyed = true
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 z-0">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
})

export default YoutubePlayer
