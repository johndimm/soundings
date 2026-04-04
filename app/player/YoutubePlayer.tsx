'use client'
import { useEffect, useRef } from 'react'

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

interface YTPlayer {
  loadVideoById(videoId: string): void
  destroy(): void
  pauseVideo(): void
  playVideo(): void
}

interface Props {
  videoId: string
  /** Called when video finishes (auto-advance). */
  onEnded?: () => void
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

export default function YoutubePlayer({ videoId, onEnded }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const currentVideoIdRef = useRef(videoId)

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
          onStateChange: (e) => {
            if (e.data === window.YT?.PlayerState?.ENDED) {
              onEndedRef.current?.()
            }
          },
        },
      })
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
}
